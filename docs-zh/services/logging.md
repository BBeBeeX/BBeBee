# 日志传输架构体系（Layer 3）

> **历史章节映射：** 原 `docs-zh/04-core-services.md §16`。

## 16. `ctx.logger` —— 以传输插件形式实现的日志

`ctx.logger` 本身由 Cordis 提供，且已按插件划分作用域，因此 BBeBee 不再定义日志服务。BBeBee
增加的是**传输端（transport）**，每一个都是普通插件 —— 它们合在一起，就是
[architecture/layers.md §1](../architecture/layers.md#1-分层模型) 的**第 3 层**，即 `packages/logs/*`：

| 插件 | 何时运行 | 行为 |
|---|---|---|
| `plugin-log-buffer` | 始终运行 | 内存环形缓冲区（默认 2000 条），支撑应用内日志查看器。声明 `ctx.logBuffer` |
| `plugin-log-console` | 仅开发环境 | 带插件作用域前缀的 `console.*`，debug 级别。发布构建里没人盯着终端看 |
| `plugin-log-file` | 仅发布构建 | `ctx.paths.logs` 下的滚动 NDJSON 文件，按大小与条数封顶。日志必须能在应用被关闭之后存活，这正是 console 覆盖不了的场景 |
| `plugin-log-crash` | *（未构建）* | 遇到未处理的 rejection 时，把最近的缓冲条目连同设备信息打包成文件，供用户附加到问题报告。自身绝不主动上传任何东西 |

### 为什么它是一层

把传输端放在核心服务与功能插件之间，会导出三条规则，而每一条都封死了一种在调用点看起来颇为
合理的错误日志写法：

- **它们从外壳的 `bootstrap:` 数组加载，而不是从注册表。** 经配置白名单启用的传输端会与功能
  插件*并肩*启动，因此会错过每个功能插件写下的最初几行 —— 而当某个插件没能启动时，恰恰是
  这些行最有价值。引导条目按序应用并被 await，所以"在核心服务之后、第一个功能插件之前"是一
  个真实存在的位置。
- **第 3 层之上的任何东西都不导入传输端。** `ctx.logger` 就是全部接口；它背后是哪个 sink，
  是外壳一次性地在 `boot.ts` 里做出的决定。一次导入，就会把某一份实现钉进一段其意义恰在于
  不该知道这件事的代码里，并且只要导入者还活着，那份实现就一直被挂着。
- **`console.*` 在第 3 层之上是错误。** 它不是 `ctx.logger` 的缩小版：它跳过下方的脱敏器，
  既到不了日志查看器读取的环形缓冲区，也到不了 bug 报告附带的那个文件。外壳是唯一的豁免，
  因为启动失败可能发生在任何传输端加载之前。

有一点后果需要刻意面对：**引导条目不受能力门约束**，因此 `plugin-log-file` 用外壳自己的
`ctx.fs` 写入，而不经过那道本会把它约束到其清单所声明的 `fs:write:logs` 的门。这与核心服务
拿到的是同一笔交易，理由也相关 —— 一个必须先被授予能力才能记录任何东西的传输端，一旦被拒
绝，就无从报告自己被拒绝了。清单仍然声明最小集合，而那正是将来经 M5 注册表加载的传输端会被
约束到的标准。

`conventions.test.ts` 还要求每个功能插件至少调用一次 `ctx.logger`。一个一言不发的插件并不是
整洁 —— 它正是那种失败时只给你一块空空如也的屏幕、背后什么都没有的插件。

```ts
export interface LogRecord {
  sn: number             // 会话内的单调递增序号，用于稳定排序
  time: number
  level: 'error' | 'warn' | 'info' | 'debug'
  scope: string          // 插件名称，由 Cordis 注入
  message: string
  meta?: Record<string, unknown>
}

export interface LogTransport {
  write(record: LogRecord): void
  flush?(): Promise<void>
}
```

> ⚠️ **脱敏是强制的。** 传输端会对 `meta` 与 `message` 跑一个脱敏器，剔除键名为
> `token`、`password`、`authorization`、`cookie` 或 `refresh_token` 的内容，并重写 URL
> 上的查询字符串。音源规则动辄把凭据放进请求头与查询字符串，而测试界面的追踪
> （[sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源)）存在的意义就是被复制进
> 论坛帖子 —— 所以同一个脱敏器也跑在追踪记录上，而不只是日志上。

### 应用内诊断视图

桌面端诊断中心（`@BBeBee/plugin-settings-ui-desktop`）提供了实时的遥测界面：

1. **系统日志查看 (`debug.logs`)**：
   直接从 `ctx.logBuffer` 读取日志数据。提供实时流检查、日志级别过滤（`ALL`、`DEBUG`、`INFO`、`WARN`、`ERROR`）、子字符串搜索、导出为 NDJSON 到剪贴板，以及一键清空缓冲区。
2. **HTTP 请求日志 (`debug.http-logs`)**：
   监控由第三方音源与后台任务发起的出站 HTTP 请求。核心 HTTP 客户端（`core-http-node`）将追踪记录格式化为 `[HTTP] ${method} ${url} -> ${status} (${durationMs}ms)`，该视图将其解析为带有方法徽标、HTTP 状态码、毫秒级延迟与目标 URL 的结构化条目。

---

