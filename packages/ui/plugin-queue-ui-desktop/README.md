# @BBeBee/plugin-queue-ui-desktop

Layer 5（ui）— `plugin-queue`（headless）的桌面视图包：up-next 队列屏。

## 概述

把 `queue.view` 绑到桌面 kit 上，从 `plugin-player` 的视图包整体迁入。领域状态全部来自 `@BBeBee/toolkit/hooks`（跨功能消费的 React 绑定统一在 toolkit；队列模型仍是 player 的），`ctx.player` / `ctx.sources` 经 `inject` 访问。对 headless 包是运行时依赖（view id）。

## 源文件

### `src/index.tsx`

**注册的视图**（generator effect `'queue-ui-desktop'`）：

| id | 组件 |
|---|---|
| `queue.view` | `QueueScreen` |

**`QueueScreen({ ctx, onClose })`** — 播放队列与最近播放历史抽屉页，提供顶部双 Tab 切换：
- **「队列」Tab**：
  - **当前播放**：高亮当前播放曲目（绿色标题、波形状态），无待播时提示 "队列中暂无更多待播歌曲"。
  - **下一首播放**：展示后续待播序列，若带有来源语境则显示「下一首歌来自：{label}」。
  - 空队列状态下展示 `EmptyState`（🎵 "Nothing queued"）。
  - 行内容来自 `useTracksByUrn` 批量解析：封面 + 标题 + 艺人；未就绪时经 `queueTrackFallback` 优雅回退，绝不展示原始 URN。
  - 行点击调用 `playFromContext(urn)` 跳至该项。
- **「最近播放」Tab**：
  - 通过 `usePlayHistory` 读取历史记录，并按 `trackUrn` 严格**去重**（保留该曲目最近一次的播放记录与时间）。
  - 右侧显示相对时间（如 "刚刚"、"5分钟前"、"2小时前"）。
  - 行点击调用 `playFromContext(record.trackUrn, uniqueHistoryUrns)`，将去重后的播放历史作为上下文队列播放。
  - 空记录时展示 `EmptyState`（🎵 "暂无播放记录"）。

**`bound(ctx, Screen)`** — 闭包本插件 `apply` 时的 context（shell 的 context 只有 `ui`，hooks 读 `ctx.player` 会抛 `cannot get property "player" without inject`）。必须 `h(Screen, …)` 而非函数调用。

## 声明与导出

```ts
export const name = 'plugin-queue-ui-desktop'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)      // generator effect：registerView × 1
export default { name, inject, apply }
```

## 测试（`src/screens.test.tsx`）

- 空态与占位文案断言；
- 队列行渲染、绿色高亮当前播放与「下一首播放」上下文标题；
- 目录未解析时不显示原始 URN；
- 行点击触发 `playFromContext` 跳转而非重新入队；
- 最近播放 Tab 切换与列表展示；
- 最近播放 Tab 歌曲按 `trackUrn` 去重测试，验证同一歌曲多次播放仅展示一行最新记录，且点击行附带去重上下文 URN 列表；
- 队列行右键菜单操作项验证。

## 相关文档

- `docs/05-audio-playback.md`：transport 状态与队列
- `packages/feature/plugin-queue/README.md`：headless 侧与 view id
- `packages/ui/plugin-queue-ui-mobile/README.md`：孪生半边
- `packages/ui/plugin-now-playing-ui-desktop/README.md`：现在播什么（本包的对侧）
