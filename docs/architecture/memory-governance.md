# Memory Governance — OOM 事后分析与 P0 加固记录

> 诞生背景：一次生产级 WebView2 渲染进程 OOM（Windows minidump 取证）+ 三路并行代码审计。
> 本文是审计结论、风险登记册、本轮（P0）修复记录与后续迁移计划的唯一权威汇总。
> 相关代码注释中的 "memory-governance" 即指向本文。

## 1. 事故取证结论（minidump 分析）

| 证据 | 数值 |
|---|---|
| 崩溃进程 | `msedgewebview2.exe --type=renderer`（线程名 `CrRendererMain`），WebView2 157.0.4341.42 |
| 页面 | `http://localhost:1420`（**dev 构建**），`--renderer-client-id=5` |
| 异常 | PartitionAlloc `OnNoMemoryInternal` → `RaiseException(0xE0000008, [请求 6 MiB, 系统提交上限 60.76 GiB, 剩余 8.59 GiB])` |
| 会话 | 存活 4h24m；**内核态 10,705 s（91%）** vs 用户态 754 s；3950 万缺页 |
| 提交内存 | **17.26 GiB**（峰值 17.4）；工作集 7.65 GiB；虚拟保留 3.53 TiB |
| PartitionAlloc 主池 | 16 GiB 用满：14.65 GiB 存活 + 561,797 个 VAD 区域（4 KiB ×288k、≤64 KiB ×244k） |
| V8 堆 | 2.46 GiB（JS 侧非主凶；ArrayBuffer/IPC clone/DOM 都在 PA 池） |
| 增长速率 | ≈ 0.93 MB/s ≈ 66 MB/min（与提示词复审数字一致） |

**机制**：PA 池是渲染进程的硬上限，池内耗尽与系统剩余内存无关。4-64 KiB 粒度的
commit/decommit churn 把剩余地址空间粉碎成 56 万块，6 MiB 连续分配失败即崩。

**修正后的根因认知**（区别于最初的四条假设）：

- 封面 Base64 链真实存在（仅内嵌封面提取路径），但单次量级有限 → **churn 贡献者**，非唯一根因。
- LAN 数据无界进入渲染进程真实存在（UDP 泛洪、pending 表、16 MiB 响应三穿越）→ **P0**。
- `queue/changed`/`lyrics/changed` 是 Cordis **进程内**事件（传引用，hooks 有浅比较守卫）→ **不是**风险。
- b5deb4d7（崩溃前一天）修复的 60Hz structured-clone 队列 OOM 与本次**同签名**——该家族的
  失败模式（"生产者不受消费者约束"）在本代码库里已发生两次，第三次是必然，除非架构性设界。

## 2. 风险登记册（审计定级）

### 本轮已关闭（P0/P1）

| # | 级别 | 风险 | 修复 |
|---|---|---|---|
| 1 | P0 | UDP 数据报无条件 base64 → 推送渲染进程，无速率/大小限制 | `core-lan-desktop/host.ts`：令牌桶 40/s（burst 80）+ 8 KiB 包上限 + 计数 |
| 2 | P0 | LAN `pending` 表无上限（仅 30s 超时） | `host.ts`：128 条上限，满时立即 503 |
| 3 | P0 | Leader/Peer 表可被随机 id 灌爆（TTL 只清已知行） | 两插件 `discovery.ts`：256 行上限，最老驱逐 |
| 4 | P0 | 渲染进程同步解码每个 datagram（UI 线程风暴） | `bridge.ts`：64 条原始线格式队列，drop-oldest，8 条/宏任务排水 |
| 5 | P0 | sidecar NDJSON 双侧无行长上限（16 MiB 响应 = 单行 21 MB+） | `sidecar.rs` `read_limited_line` 32 MiB 行帽；`sidecar/index.ts` stdin 8 MiB |
| 6 | P0 | `writeRaw` 不检查 stdout 返回值，无背压 | `sidecar/index.ts`：有界 outbox（256 条/8 MiB）+ drain 排空；只丢 notification |
| 7 | P0 | 任意 notification 无条件广播全部 webview | `sidecar.rs`：4 MiB payload 帽 + 200/s 速率门 + 计数器 |
| 8 | P0 | `player/state-changed` 3Hz 全量 TransportState 广播 | `plugin-player` set()：position-only patch 抑制（`player/position` 已承载） |
| 9 | P0 | mini-player/lyrics/媒体位置三跳链无合流 | 新 `notify.rs` `CoalescedEmitter`：latest-wins + 去重 + 定时兜底 flush（不丢最终值） |
| 10 | P0 | `bbebee-file://` 对 `bytes=0-`/无 Range 整文件读入 Rust Vec | `protocols.rs`：8 MiB 响应窗口，>窗口的文件以 206 首窗口 + Accept-Ranges 应答 |
| 11 | P0 | 封面单文件无独立上限（512 MiB 预算即单帽）+ 批响应可超行帽死循环 | `plugin-cache`：8 MiB 单帽（base64 解码前预检）+ 自适应分块（20 MiB 响应预算） |
| 12 | P0 | 封面磁盘缓存永不淘汰（`enforce('artwork')` 直接 return） | 真实 LRU 淘汰 + 10 分钟新鲜度豁免（`localArtwork()` 的 exists() 自愈使淘汰安全） |
| 13 | P1 | 分享卡成功路径不 revoke objectURL | `canvasRenderer.ts` onload 补 revoke |
| 14 | P1 | `audio:state` 死事件 3Hz+ 序列化广播 | `main.rs` 移除循环（broadcast 无接收者即零成本） |
| 15 | P1 | iOS lan-host body 不落盘无上限且截断 | `LanHostModule.swift`：16 MiB 上限 + 完整收满 body（同时修复截断正确性 bug） |
| 16 | P1 | 全仓库零内存监控 | 见 §4 监控骨架 |
| 17 | 存量 bug | `EngineMessage` 字段未 camelCase rename——引擎的 `durationMs`/`mpvAvailable` 被静默丢弃 | `audio.rs`：`rename_all_fields = "camelCase"`（审计中发现的预存缺陷） |

### 未关闭，列入后续阶段

| # | 级别 | 风险 | 方向 |
|---|---|---|---|
| A | P2 | FFT 60fps JSON invoke churn（1-2 KB/帧，fast-path 已免 sidecar） | 二进制 fast-path（raw bytes invoke）或共享内存环形缓冲 |
| B | P2 | `plugin-library/local-catalog.ts` 全量分页累积曲目元数据 | 游标分页 + 虚拟化直接查询 |
| C | P2 | `plugin-download` 整读下载文件做标签嵌入（被桥 10 MiB 上限约束，大文件静默跳过） | readRange 分块 |
| D | P2 | lan-sync leader 快照含全量 queueMeta，无 schema 级大小上限 | 快照分页 + 大小校验 |
| E | P3 | 状态无 revision 协议；副窗口一致性靠 latest 缓存 | Phase 1：Snapshot+Revision+LatestWins（提示词 §3/§5） |
| F | P3 | 命令无请求 id/去重/串行化语义 | Phase 1：CommandRouter（提示词 §4）——`desktop_bridge_call` 已是统一入口，缺协议语义 |
| G | P3 | 封面 base64 仍三穿越 IPC（worker→NDJSON→Rust→webview→fs） | Phase 2：cover sidecar 直接落盘返回 URI（提示词 §8 目标形态） |

## 3. 架构边界（为什么不是提示词的完全形态）

提示词要求 "Rust 作为唯一权威状态中心"。BBeBee 的分层规则（AGENTS.md：内核之上的
一切皆插件、状态所有权在 feature 层）与 Cordis 事件模型决定了：

- `plugin-player` 保持唯一写者——**不迁移**状态权威到 Rust。
- Rust 侧只做 **latest-wins 转发**（`latest_*` 缓存 + `CoalescedEmitter`）。
- 命令入口已经统一（`desktop_bridge_call` → sidecar → 引擎），缺的是协议语义（去重/串行化/预期版本），列为 Phase 1。
- 真正的缺口是**有界性与可观测性**，这正是 P0 覆盖的内容。

## 4. 监控骨架（本轮交付）

| 组件 | 位置 | 内容 | 有界性 |
|---|---|---|---|
| Rust 采样器 | `src-tauri/src/metrics.rs` | 30s 采样本进程/全部 msedgewebview2/受管子进程 RSS，720 点环（6h）；超总内存 75%（`BBEBEE_MEMORY_ALERT_RATIO` 可调）单次 `metrics:warning` | 定长数值环，无字符串分配，edge-triggered |
| 指标命令 | `system_runtime_stats` | 最新样本 + 各 sidecar 传输门计数器（行帽/通知帽丢弃数） | 只读快照 |
| Node 通知 | `sidecar/index.ts` 60s `metrics:node` | rss/heap/external/arrayBuffer + LAN 门计数 | 单对象/分钟，unref |
| 渲染采样 | `apps/desktop/renderer/metrics.ts` | `performance.memory` 10s 入 360 点环（1h）；`window.__bbebeeMetrics` 诊断口 | 定长数值环 |
| dev 看门狗 | 同上 `MemoryWatchdogBanner`（挂在 Shell） | JS 堆 ≥70%/≥85% 告警横幅（趋势 MB/min），**仅告警不自动刷新**，仅 dev 构建渲染 | — |

## 5. Phase 1/2 迁移计划（后续）

**Phase 1 — 协议语义**（提示词 §3/§4/§5 的 BBeBee 形态）
1. `TransportState`/`MiniPlayerData`/`DesktopLyricsPayload` 加单调 `rev`；Rust `latest_*` 缓存比较 rev，旧不覆新。
2. `desktop_bridge_call` 增加请求 id 透传 + 幂等去重缓存（有界 256/2h TTL）。
3. 音量/Seek 走 latest-wins 合并；Next/Prev 串行化保序。
4. 验收：慢消费者压测——mini-player 窗口挂起 10 分钟，恢复后经快照对齐，无事件重放。

**Phase 2 — 资源引用化**（提示词 §8）
1. cover sidecar 直接写盘（content-hash 文件名）返回 `{uri, bytes}` 元数据；删除 base64 三穿越。
2. `artworks.local_uri` 全走引用；解码只在 webview 图像栈发生。
3. 验收：1000 张封面扫描，渲染进程内存曲线平稳（可由 `system_runtime_stats` 曲线证明）。

**Phase 3 — 长跑验收**（提示词 §12）
4h/24h/72h 播放 + LAN + 封面扫描，持续记录 `system_runtime_stats` 曲线。
**通过标准：不存在无法解释的持续内存增长**——不以"没崩"为通过。
