# 能力门控与安全授权模型

> **历史章节映射：** 原 `docs-zh/03-plugin-system.md §7 – §9`。

## 7. 能力模型

插件声明自己想触碰什么，由内核居中裁定。随着
[ADR-1 修订](../architecture/overview.md#adr-1--插件在所有目标平台上都静态打包)落地，
每个插件都是第一方的，因此这扇门如今是一项**让意图保持可审计的纪律**，而不是防范陌生包的
边界 —— 而确实存在的陌生代码，即音源字符串，则由另一套强得多的机制来遏制
（[06 §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。

### 能力语法

| 能力 | 授予 |
|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | 在命名作用域内的文件系统访问：`own`、`media`、`cache`、`downloads`、`logs` 或 `all` |
| `net:host/<pattern>` | 到匹配 glob 的主机的出站 HTTP **与 WebSocket** —— 一个授权同时管辖 `ctx.http` 与 `ctx.ws`。`net:host/*` 是一项宽泛授权，在授权提示中会被明确标注。包含一个**限定于本插件实例的持久化 cookie 罐**（[services/overview.md §2.1](../services/overview.md#21-cookie-罐)）—— 存储由核心服务持有，因此无需为此授予 `db` 或 `secrets`。匹配仅针对主机名（小写）；端口无法单独授权 |
| `db:own` | 完全归属自己的命名空间表 —— 读、写与建表（schema）皆可。索引、触发器与视图也算在内：它们按名称归属，因此一个插件的索引和它的表一样叫 `{{ns}}_…` |
| `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>` | 按动词访问其他命名空间：`read` 是 `SELECT`，`write` 是 `INSERT`/`UPDATE`/`DELETE`，`*` 是二者再加 `CREATE`/`DROP`/`ALTER`。各动词**不**相互蕴含 —— 一个既要读又要写曲库的插件必须同时声明 `db:read:core` *和* `db:write:core`，这样安装时的授权提示才能准确说出它到底在请求什么。语句按其所作所为中要求最高的一档归类，因此 `DROP` 不可能躲在 `SELECT` 身后蒙混过关 |
| `secrets:own` | 自己的凭据命名空间。不存在 `secrets:all`。仅需要登录态得以保存的插件并不需要它 —— `net:` 下的 cookie 罐已经覆盖了这一点 |
| `js` | 可以在 `ctx.js` 中执行不受信任的脚本（[services/contracts.md §19](../services/contracts.md#19-ctxjs--沙箱化求值器)）。仅由 `plugin-source-runtime` 持有，别无他者。这项授权并不扩大被评估代码能触达的范围 —— 那由宿主 API 与每次求值的白名单固定 —— 它让*谁被允许运行它*变得可审计 |
| `audio` | 可以向音频图贡献节点 |
| `mediaSession` | 可以发布正在播放元数据并接收传输控制命令 |
| `notify`、`shell`、`background` | 用户可见或操作系统级别的动作 |

`store` 同样受中介，尽管它没有自己的能力项：拦截配置承载的是插件的**存储命名空间**，
`ctx.store`、`ctx.secrets` 与 cookie 罐都以它为键，使一个插件在这三者中获得相同的命名空间
（内核中的 `storageNamespace(config)`）。

#### SQL 防护与拒绝策略

无论授予了什么，以下三种拒绝一概生效，因为每一种都曾是绕过上表的一条路：

- **门无法归属的变更。** 按表逐项检查*就是*这扇门本身，所以一条没有点名任何它看得见的表的
  语句 —— `DROP INDEX idx_tracks_album`、`VACUUM`、`ANALYZE` —— 过去会未经审查地放行。
  凡是高于 `read` 且无法归属的操作，一律拒绝，而不是靠猜。
- **带 schema 限定的名称。** `SELECT * FROM main.plugin_other_secrets` 过去被读作一个名叫
  `main` 的表，它不带 `plugin_` 前缀，于是落进了 `core` 兜底 —— 普普通通的 SQL 就这样读写
  了另一个插件的行。带限定的名称一律直接拒绝。
- **`PRAGMA`。** pragma 并不局限于它的调用者：`foreign_keys = OFF` 会重新配置所有插件共享的
  那一个连接，而在桌面端这个连接活在 `main` 里。只有 `defer_foreign_keys`（迁移运行器需要
  它）和只读的自省 pragma 被允许；其余情况下 `sqlite_master` 仍可读。

> ⚠️ 以上全部都是针对 SQLite 实际形态的正则匹配，不是解析器。它失败即关闭（fail closed）——
> 无法归属的标识符一律视为外来的 —— 而且它防的是寻常失误与顺手越界，不是防一个存心尝试的
> 作者，反正他与运行时共享同一空间。

> **`plugin-source-runtime` 上的 `net:host/*` 不是它看起来的样子。** 运行时持有这项宽泛授权，
> 是因为在音源被导入之前无从得知主机名；随后它会**收窄**授权：每个音源被隔离的 `ctx.http`
> 作用域都携带该音源自己的白名单 —— 其 `sourceUrl` 主机加上它声明的 `allowedHosts` —— 并由
> `core-http-*` 执行二者中较窄的那个。计算出的 URL 指向未声明主机的规则会被拒绝，而且这份
> 清单会在导入时展示给用户
> （[runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。

### 执行

内核通过拦截派生每个插件的上下文：

```ts
// @BBeBee/kernel — simplified
function scopeContext(ctx: Context, opts: GrantOptions) {
  const config = {
    pluginId: opts.pluginId,
    scopeId: opts.scopeId ?? opts.pluginId,   // a source id, or the plugin id
    granted: opts.granted ?? opts.requested,
  }
  let scoped = ctx
  for (const key of MEDIATED_SERVICES) {
    scoped = scoped.intercept(key, config)
  }
  return scoped
}
```

每个受中介的核心服务读取自己的拦截配置，对越界操作以 `CapabilityError` 拒绝。由于服务都是
经 Cordis 的代理触达的，插件无法从拿到的引用出发遍历对象图来获得未加约束的引用。

**授权只有在服务检查它的地方才是真的。** 在 `ctx.db` 调用门之前，`db:own` 只是一个没有含义
的 manifest 字符串；在 `ctx.http` 这么做之前，`net:host/…` 也一样。当前各核心服务的执行状态如下：

| 能力 | 由谁执行 | 状态 |
|---|---|---|
| `fs:read:<scope>` / `fs:write:<scope>` | `core-fs-node`、`core-fs-expo`、桥宿主 | ✅ |
| `db:own`、`db:read:<ns>`、`db:write:<ns>`、`db:*:<ns>` | `core-db-node`、`core-db-expo`、桥宿主 | ✅ |
| `net:host/<glob>` | `core-http-node`、`core-http-rn`，在 `http/request` 瀑布之前*和*之后各检查一次 | ✅ |
| `audio` | `core-audio-webaudio`、`core-audio-mpv` 在 `load` 与各变更器上 | ✅ |
| `mediaSession`、`background` | `core-media-session-*`、`core-background-*` | ✅ |
| `secrets:own` | `core-secrets-node`、`core-secrets-expo`、内核 `assertOwnNamespace` | ✅ |
| `js`，以及 `net:host/…` 的按音源收窄 | `core-js-quickjs-node`、`core-http-*`、`plugin-source-runtime` | ✅ |
| `notify`、`shell` | 平台宿主中介（`core-device-*`、桌面 bridge） | ✅ |

### 门默认关闭（fail closed）

插件的 manifest 是*请求*，永远不是授权。加载器只为标记了 `builtin` 的插件采信 manifest
—— 即随应用打包的第一方包。其余一切必须在 `capability_grants` 中有一条对应的记录；没有就
拒绝并标记为 `ungranted` 而非加载。桌面端通过 `bbebee-plugin://` 动态加载的外部第三方插件均严格受此检查约束。
拒绝加载并记为 `ungranted`，而不是放行。如今每个插件都是 `builtin`，所以这个分支只有测试
会走到 —— 这恰恰是保留它的原因。

这一点很重要，因为失败方式是无声的：如果宿主只是忘了传 grants，一个非 builtin 插件就会恰好
拿到它为自己声明的一切 —— 包括 `net:host/*` —— 把审批变成一纸空文。

### 门实际运行的位置

移动端上，门与它守卫的服务处于同一进程，插件只能穿过其被拦截的上下文触达 `ctx.fs`。

**桌面端则不然。** ADR-3 把内核放进渲染进程，而真正的 `fs` 与 `db` 活在 `main` 中，于是门
运行在*渲染进程一侧*，而承载跨进程调用的桥对渲染进程中的任何代码都是可达的 ——
`window.BBeBeeBridge.call('fs', 'writeFile', …)` 一行就能绕过它。因此，每插件粒度的门在
桌面上约束的是**愿意配合**的插件，而不是拒绝配合的插件。

无论调用者是谁、`main` 都一概执行的限制（因为这些限制无需知道是谁在调用）：

| 限制 | 效果 |
|---|---|
| 方法白名单 | 只有列名的服务方法可达；`constructor` 与继承成员不可达 |
| 路径封闭 | 每一个 `fs` 操作数都必须落在应用目录之内 —— 桥既触不到 `/etc`，也触不到用户家目录的其余部分 |
| 拒绝 `ATTACH`/`DETACH`/`VACUUM INTO` | 否则数据库句柄就成了任意文件读写原语，上面的路径封闭也就形同虚设。三者都出自内核中同一个共享的 `assertSqlAllowed`，受门约束的路径与 `main` 都用它：桥过去维护自己的清单，而且逐渐漂移到只剩 `ATTACH`/`DETACH`，于是 `VACUUM INTO '/any/path'` 直接绕过这张表写出了一个文件 |
| 每次调用一条语句 | 驱动只编译字符串中的第一条语句并静默丢弃其余的，所以 `SELECT 1; DROP …` 既不会完整执行也不会执行一半 —— 它会被拒绝（[04 §5](../services/contracts.md#5-ctxdb--sql)） |
| 流句柄有界 | 循环调用 `streamOpen` 无法耗尽 `main` 的文件描述符 |
| 事务生命周期 | 被遗弃的事务会在渲染进程销毁或空闲超时时回滚，刷新不再能楔死数据库 |

要真正补上每插件粒度的缺口，需要插件不再共享渲染进程的 realm —— 与下文真正的沙箱是同一个
前提。如今这个仓库之外已没有任何东西被当作插件加载，所以门的每插件一半是设计使然的第一方
纪律，而非无心之失。**在任何第三方被当作插件加载之前，必须先解决这个问题**
（[10 §M5](../roadmap/roadmap.md#m5--沙箱上的第三方扩展)）。

### 它不是什么

> ⚠️ **这是纵深防御，不是沙箱。** 插件与应用运行在同一个 JS realm 中。一个蓄意的插件可以
> 触及全局对象、篡改原型，原则上能做渲染进程能做的一切。能力模型抬高的是*意外*越界的成本，
> 并让意图可审计、可撤销 —— 它拦不住恶意插件。也没有人要求它这么做：每个插件都是第一方，
> 随构建一起交付。

真正的遏制需要独立的 realm。**一个现在已经存在** —— `ctx.js`，一个带可枚举宿主 API 的
QuickJS realm，它的诞生是因为导入的音源是不受信任的代码、必须被遏制
（[04 §19](../services/contracts.md#19-ctxjs--沙箱化求值器)、
[06 §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。把它从
"执行音源规则"推广到"承载一整个插件"，意味着把上面能力语法早已描述为协议的服务桥交给它。
这正是 [M5](../roadmap/roadmap.md#m5--沙箱上的第三方扩展) 的形态，而且如今它是
对已交付之物的扩展，而不是一个要从零发明的子系统。

---

## 8. 编写插件：检查清单

- [ ] 已设置 `name`，且与包名后缀一致。
- [ ] `inject` 恰好列出所需内容 —— 可选依赖用对象形式。
- [ ] 未导入任何平台 SDK（[02 §1](../architecture/layers.md#不变量)）。核心插件是例外，而且是
      *唯一*的例外。
- [ ] 未从内核的引导表面导入任何东西 —— 功能插件是被交给一个现成 context 的，它并不自己
      构建一个（[02 §1](../architecture/layers.md#不变量)）。
- [ ] 未导入任何 `core-*` 包。对 Layer 2 的依赖写作 `inject: ['fs']`。
- [ ] 每个监听器、定时器、套接字与音频节点都通过 `ctx.effect()` 注册，或以释放器
      （disposer）形式返回。
- [ ] 长耗时的异步工作接受 `AbortSignal`，并在释放时中止。
- [ ] 没有模块级可变状态。
- [ ] 若可配置，提供 `Config` 校验模式；默认值已给出。
- [ ] `BBeBee.plugin.json` 声明了能正常工作的最小能力集合。
- [ ] 它确实是一个插件。新的音乐后端是一个**音源字符串**，而不是一个包
      （[06](../sources/spec.md)）；插件是为运行时无法表达的行为准备的 —— 一个效果器、
      一个 scrobbler、一种传输控制、一个 UI 表面。
- [ ] 自有 DB 表通过 `ctx.db.defineSchema('plugin:<id>', …)` 声明
      （[07 §6](../data-model/migrations.md#6-迁移)）。
- [ ] 停用、再启用，并用 `fiber.getEffects()` 确认没有任何泄漏。

---

## 9. 下一步

[04 —— 核心服务](../services/contracts.md) 规定了这些插件所依赖的平台抽象。
