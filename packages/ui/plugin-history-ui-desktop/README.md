# @BBeBee/plugin-history-ui-desktop

Layer 5（ui）— `plugin-history`（headless）的桌面视图包：播放历史与听歌统计页面。

## 概述

把 `history.view` 注册并绑定到桌面 shell。所有领域统计与历史数据来自 `@BBeBee/toolkit/hooks`（`usePlayHistory`、`usePlayHistoryStats`、`usePlayHistoryHeatmap`；跨功能消费的 React 绑定统一在 toolkit）。
`inject = ['ui', 'player', 'sources']`，封面经 `useResolvedArtwork`（`@BBeBee/toolkit/hooks`）由本地缓存解析，上下文菜单通过 `@BBeBee/ui-menus` 接入。

## 注册的视图

| id | 组件 | 说明 |
|---|---|---|
| `history.view` | `HistoryScreen` | 播放历史统计与去重曲目记录页面 |

## 核心功能与交互设计

1. **听歌足迹统计卡片（Stat Cards）**：
   - 总播放次数：累计播放次数；
   - 累计播放时长：格式化呈现沉浸音乐的总时长；
   - 今日播放：当天听过的曲目数；
   - 完播率：完整播放曲目占比（`completedPlays / totalPlays`）。
2. **播放活跃度热力图（PlayHeatmap）**：
   - GitHub 风格的 52 周 × 7 天网格热力图，根据当天听歌次数渲染 5 级绿阶；
   - 点击具体单元格按日期筛选当天的播放记录，再次点击取消日期筛选。
3. **曲目列表与严格去重**：
   - **单曲去重**：按 `trackUrn` 进行去重，保留每首歌曲最近一次的播放记录，防止单曲循环或重复播放导致页面被同首歌曲刷屏；
   - **播放次数徽标**：在曲目行右侧展示该歌曲在历史中的累计播放频次（`播放 N 次` 胶囊徽标）；
   - **状态与时间**：展示「完播」/「跳过」徽标以及相对/绝对播放时间（如 "今天 14:30"、"昨天 09:15"）；
   - **批量元数据加载**：`useTracksByUrn` 仅解析去重后的唯一 URN 列表，大幅减少无意义的重复 catalogue 查询；
   - **单曲点播与右键菜单**：点击曲目直接调用 `player.playNow([trackUrn])` 开始播放，右键触发标准化曲目操作菜单。
4. **清空历史记录**：
   - 包含二次确认机制（"确定清空历史记录？" / "确定" / "取消"），调用 `player.clearHistory()`。

## 测试（`src/screens.test.tsx`）

- 热力图阶数与时长格式化单元测试；
- 热力图单元格点击与日期选择；
- 空历史记录状态断言；
- 统计卡片与曲目记录渲染；
- 清空历史二次确认交互断言；
- 歌曲去重与每首歌曲播放次数徽标（`播放 N 次`）渲染断言。
