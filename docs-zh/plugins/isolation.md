# 服务隔离与拦截机制

> **历史章节映射：** 原 `docs-zh/03-plugin-system.md §4 – §5`。

## 4. 服务

服务是稳定键背后的一项能力。其**接口**通过模块增强（module augmentation）在
`@BBeBee/protocol` 中声明一次，任意数量的插件都可以实现它。

```ts
// packages/protocol/src/services/fs.ts
export interface FsService { /* … 见 services/contracts.md … */ }

declare module 'cordis' {
  interface Context {
    fs: FsService
  }
}
```

消费方书写 `ctx.fs.readFile(uri)` 即可获得完整的类型安全，且无需知道挂载的是哪份实现。把
`core-fs-expo` 换成 `core-fs-node` 只是启动插件清单（bootstrap 列表）的一处改动
（[architecture/layers.md §3](../architecture/layers.md#引导插件集)），仅此而已。

Cordis 通过追踪代理（tracing proxy）分发服务，因此它知道插件持有的某个值来自服务、必须在该
服务被替换时失效。由此带来两个后果：

- **不要把服务引用缓存进存活期跨越 await 边界的长期变量。** 每次都读取 `this.ctx.fs`；
  这是属性访问，不是查找。
- 对服务对象做同一性比较不可靠。请按 `name` 比较。

### 唯一例外：为清理（teardown）而捕获

插件的 disposer 运行时，它自己的 fiber 已经处于 `UNLOADING`，此时再经上下文取服务会抛出
`cannot get required service in inactive context`。因此，必须在关机时做收尾工作的插件
—— 冲刷日志缓冲、给下载做检查点 —— **必须在加载时就把所需的东西捕获下来**：

```ts
export async function apply(ctx: Context) {
  const fs = ctx.fs                     // captured deliberately, see below
  return async () => {
    try { await fs.writeFile(uri, tail) } catch { /* teardown is best-effort */ }
  }
}
```

只有同时满足以下全部三个条件才允许这样做，且捕获处必须有注释说明：

1. 被捕获的是**核心服务**，由于拆除按逆序进行，其 fiber 的寿命长于每个功能插件
   （[architecture/layers.md §3](../architecture/layers.md#3-启动顺序)）。
2. 该引用**只在 disposer 中使用**，绝不出现在热路径上 —— 在热路径上，拦截或隔离自加载以来
   可能已经合法地替换过该服务。
3. 失败被吞掉。抛错的 disposer 会中断其余的拆除工作
   （[workflow/testing.md §6](../workflow/testing.md#6-测试策略)），丢掉最后一行日志远好于
   泄漏排在它后面的每一个监听器。

除此之外的任何地方，都请经由 `ctx` 读取 —— 否则运行在隔离作用域里的插件会悄无声息地继续
与未隔离的服务对话。

---

## 5. 隔离与拦截

两种机制让同一个服务键在插件树的不同部分有不同含义。BBeBee 对二者都重度依赖。

### `ctx.isolate(key)` —— 服务的私有实例

```ts
// Each imported source gets its own HTTP stack: its own cookie jar, its own
// rate limiter, its own host allowlist. They cannot see each other's.
const scoped = ctx.isolate('http')
scoped.plugin(HttpWithCookieJar, { jar: sourceId, rateLimit, allowedHosts })
scoped.plugin(SourceInstance, { record })
```

在 `scoped` 之内，`ctx.http` 是该音源专属的 HTTP 栈；在其他任何地方，它仍是共享的那份。
其余所有服务 —— `fs`、`db`、`logger` —— 依旧共享，因为被隔离的只有被点名的那个键。这正是
想要的语义：一个慢速音源的限流不会卡住另一个的请求，cookie 也绝不会跨过音源边界
（[sources/runtime.md §4.1](../sources/runtime.md#41-一个源的生命周期)）。

### `ctx.intercept(key, config)` —— 同一实例，不同配置

```ts
// Same fs service, but this subtree is confined to the plugin's own data directory.
const confined = ctx.intercept('fs', { root: `plugins/${pluginId}`, mode: 'rw' })
```

[能力门](./capabilities.md#7-能力模型)正是用拦截实现的；每个插件专属的 `store` 与 `fs` 命名空间也由此生效，插件无需
自己记得给键加前缀。

---

