# 里程碑路线图与风险登记册

> **历史章节映射：** 原 `docs-zh/10-roadmap.md`。

> **本篇回答什么。** 构建的先后顺序、每个阶段"完成"意味着什么，以及对可能出问题之处的如实盘点。

排序原则：**尽早证明风险最高的那条架构论断。**"同一张插件图无需修改即可同时运行在 Hermes 与 Electron 渲染进程中"——这个论断要么成立，要么项目需要重新设计；在第一周验证它代价很小，到第六个月才发现则是灾难。所以 M0 刻意朴实无华——在 M1 之前不会有任何音乐响起。

---

## 里程碑

### M0 —— 内核在两个平台上跑起来

构建 `@BBeBee/protocol`、`@BBeBee/kernel`，以及最小核心服务（`paths`、`fs`、`store`、`db`、`logger` 传输层）的双份实现。两个外壳都能启动、加载一个极简插件并渲染它贡献的视图。还有来自 [workflow/testing.md §6](../workflow/testing.md#6-测试策略) 的一致性测试 harness 与泄漏测试。

**完成标准**
- 同一个插件包在 iOS 模拟器、Android 模拟器与 Electron 上加载并激活，插件内不含任何条件分支代码。
- `pnpm test` 对所有实现跑绿 `fs`、`db` 与 `store` 的一致性测试套件，其中 Expo 侧的实现要在设备上运行。
- 禁用插件后，Context 快照被精确还原。
- 插件检查器展示 fiber 树，且各 effect 均带标注。

**为何排第一。** 在这一步通过之前，每个 ADR 都只是假设。如果 Cordis 在 Hermes 上表现异常、Metro 无法解析其 `exports` 映射、或标准装饰器无法转译——问题都会在这里暴露，而此时退出成本仍然很低。

---

### M1 —— 能播放音乐

`core-audio-webaudio`、`plugin-player`、`plugin-source-local`、`plugin-local-scanner`、`plugin-source-runtime` 的仅流式切片，外加两个外壳中足以浏览曲库、控制播放的 UI。媒体会话（media session）集成。

> **详细计划** —— [M1 执行计划（历史档案）](./archive-m1.md)：包集合、构建顺序、里程碑级的决策，以及下文每一条完成标准背后的验证方式。

**完成标准**
- 扫描一个 ≥ 5,000 个文件的文件夹；对未变化的曲库做增量重扫，只消耗 stat 调用。
- 播放、暂停、进度跳转、上一曲、下一曲、队列重排——三个平台全部支持。
- iOS 与 Android 上锁屏与通知栏控件可用；桌面上为 MPRIS/SMTC/Now Playing。
- 移动端切后台、桌面端隐藏窗口后，播放不中断。
- 拔出耳机即暂停（[audio/playback.md §5](../audio/playback.md#5-打断焦点与路由)）。
- 队列与播放位置在重启后恢复，且不自动开始播放。

**现状。** 已建成并处于测试之中：`core-audio-webaudio` 及其一致性测试套件、`core-codec-node` 与 `core-codec-rn`、`core-http-node` 与 `core-http-rn`（其 M1 切片一致性测试套件对着一个真实的按字节服务的 socket 运行）、两个目标平台上的 `ctx.device`、`ctx.background` 与 `ctx.mediaSession`、扫描器、目录、带无缝播放、交叉淡入淡出、预取与打断表的播放器、带对等（parity）检查的两套 UI kit，以及两个外壳上的那五块屏幕。两个外壳加载的都是**生成出来的**注册表，因此一个包被打进 bundle 靠的是声明一份 manifest，而不是被加进两份可能互相不一致的手写清单。完成标准 1 按它点名的规模被检验：一个生成的 5,000 文件语料库，由真正的解码器读取，经过一个插桩的 `ctx.fs`，由它断言第二遍不打开任何文件。

传输状态机能到达其类型声明的每一个状态，`stalled` 包括在内：一个流式源会经 `ctx.audio` 的 `onStalled` 报告缓冲欠载（underrun），播放器显示的是转圈而不是播放按钮，锁屏则继续显示*正在播放*，而一次永不恢复的停滞会变成一个可重试的错误，而不是一个永远转下去的转圈。两套 kit 都对列表做了虚拟化 —— 移动端是 FlashList，桌面端是 `@tanstack/react-virtual`，后者会发布 `aria-setsize`，让窗口化对屏幕阅读器保持不可见，而不是成为它的灾难。

仍未完成，且每一项都需要硬件：**阶段 0 试石尚未在 iOS 真机、Android 真机或 Electron 中跑过**，所以下文 ADR-4 的结论仍然是一个假设；真机冒烟矩阵尚未运行；而且 **`load({ strategy: 'stream' })` 还没有移动端实现** —— React Native 没有 `HTMLMediaElement`，因此一首较长的远程曲目只能被缓冲，或者干脆播不出来，这正是 `StreamerNode` 要填补的缺口，也是 M1 中唯一属于架构而非接线的一块。

---

### M2 —— 音源即字符串

[ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释) 的全部内容：`source-rules`（规则语言）、`ctx.js` 与两份 `core-js-quickjs-*`（沙箱）、`plugin-source-runtime` 的其余部分（搜索、探索、专辑、歌词、登录）、导入/导出/编辑器/tracer 的 UI，以及带持久化 cookie 罐的 `ctx.secrets`。`ctx.sources` 聚合与身份关联表。`fixtures/sources/` 语料库新增一份 Subsonic 文档和一份播客订阅源文档。

**完成标准**
- **粘贴一段字符串就能播放音乐。** 一份从文本导入的 Subsonic 文档——从未编译、从未安装——即可在三个平台上搜索、浏览与流式播放。
- 同时导入两台 Navidrome 服务器，cookie 罐相互隔离，认证状态各自独立——一个实例设置的 cookie 绝不会被发给另一个。
- **登录一次，一直在线。** 强杀应用并重新启动：会话从持久化 jar 中恢复，无需任何提示，也不存任何密码（[sources/runtime.md §5.1](../sources/runtime.md#51-会话持久化--cookie-在应用关闭后依然存活)）。
- **登出后不留痕迹。** `signOut()` 之后，持久化的 jar、secrets 命名空间与 `source_vars` 全部消失；重新启动后该音源显示为未登录状态。
- **导出可完整往返。** 导出音源集合，再导入一份干净的档案：行为完全一致，且没有任何凭据随行（[sources/authoring.md §9](../sources/authoring.md#9-导入更新与分享)）。
- 一份只含 `ruleStream` 的文档与其他文档一同导入，没有任何界面因它不具备的能力而出错。
- `searchAll` 返回按音源分组的结果；某个音源失败时予以报告，而不让整个搜索失败。
- 使用中途会话过期时透明地重新认证；重新认证失败则就地显示重新登录，同时缓存内容仍可浏览。
- 完整的错误分类法均被覆盖——[sources/authoring.md §7](../sources/authoring.md#7-错误) 中每一行都有对应测试，包括 `RuleError` 与过期（stale）徽标。
- **沙箱守得住。** 一份刻意怀有恶意的文档无法触达未声明的主机，无法读取其他音源的 cookie 或变量，无法碰文件系统，且会被中断而不是挂死应用（[sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。
- **坏掉的音源用户自己能诊断。** 刻意写坏一条规则；测试界面展示后端实际返回了什么，重新导入修好的文档即成功——无需重新构建。
- 同一录音的本地曲目与服务器曲目通过 ISRC 关联，在曲库中显示为一条条目、两个音源。

**现状。** 已建成并处于测试之中：规则语言（含 `@js:`）、QuickJS 沙箱（`core-js-quickjs-node`）与 `ctx.js`、搜索、探索、专辑与歌词、让一条搜索到或浏览到的曲目在重启后仍可播放的目录往返、两个平台上的 `ctx.secrets`（`core-secrets-node`、`core-secrets-expo`）、能持久化且会被登出遗忘的按源 cookie 罐、带透明单飞（single-flight）重新认证的表单与变量登录、按功能的测试界面与其流式追踪、跨源身份关联、两个外壳上的导入与源列表界面，以及完整的错误分类法。

仍未完成，且两项都需要真机才能收尾：**`core-js-quickjs-expo`** —— React Native 的 Hermes 没有 WebAssembly，因此移动端沙箱需要一个*原生* QuickJS 模块，进而需要一次 dev-client 重建，这正是它从一开始就被列为 M2 唯一新增原生依赖的原因（[services/contracts.md §19](../services/contracts.md#19-ctxjs--沙箱化求值器)）；以及在真实硬件上端到端地跑通两个外壳。在第一项落地之前，移动端上一份带脚本的文档会把受影响的能力报告为缺席，而不是提供一个无法工作的按钮 —— 这是设计之内的降级，而不是损坏。

由 MD-3 从 M1 顺延下来的策展（curation）部分同样已就位：`plugin-library` / `ctx.library` —— 播放列表、收藏、合辑，以及规则树能编译为参数化 SQL 的智能播放列表 —— 在两个外壳上均有对应界面（[data-model/schema.md §4.6](../data-model/schema.md#46-策展)）。

⚠️ **直到最近，"已建成"意味着什么、又不意味着什么。** 上面列出的每一个包都已建成且全绿，而*两个外壳一个都没运行过它们*：桌面端的引导流程漏掉了 `ctx.audio`、`ctx.codec` 与 `ctx.http`，于是 `plugin-player` 被注释掉，扫描器与源运行时停在 PENDING，移动端外壳则还停留在 M0 —— 四个核心服务加一个 M0 演示插件。这如今已经修复，而且值得按它本来的失败模式记录在案：一个里程碑可以按包逐个"完成"却什么都没交付，因为完成标准针对的是*应用*本身。本可以更早抓住它的那个检查，是每个外壳一个启动测试，这也是接下来最显然该写的东西。

**为何排第二。** M1 播放的是文件。M2 是整个设计如今所依托的那个模型要么被证明成立——一个陌生人的字符串安全地播放出音乐，并且能被持有它的人修好——要么被揭示为需要的远不止一个里程碑的地方。它也是发现规则语言太弱的最后一个廉价时机，因为 M2 之后写下的每一份文档，都是日后需要有人迁移的文档。

---

### M3 —— 离线

`plugin-download`（含可续传的任务队列）、`media_bindings`、下载策略，以及 `player/before-resolve` 替换机制。

> **已交付（Shipped）。** `ctx.downloads` 已建成（[audio/playback.md §2](../audio/playback.md#解析流水线)）：
> `download_tasks` 是一个由单个 worker 驱动的真实队列（queued → running → done，伴随 paused、canceled 与 failed），`bytes_done` 设有检查点并带有 `If-Range: <etag>` 续传支持，因而远端文件若发生变动会干净地重新拉取而不是拼接损坏字节。下载文件保存在 `ctx.paths.downloads/BBeBee/` 且永不主动淘汰，`wifi_only`/`charging_only` 会对照真实 `ctx.device` 状态挂起排队任务并暂停运行中任务，两个外壳中的下载设置页均可驱动暂停/恢复/取消/重试/删除/清空。原先在此处的自动播放缓存已移交至 `plugin-cache`，由其接管 `cache_entries` 中的封面与流媒体缓存。目前仍处于规划中的项：按策略的 *scopes*（当前 `scope_json` 写入为空 —— 一份全局策略掌管全部）以及播放列表的单曲下载操作（目前播放列表尚未渲染单曲行操作）。

**完成标准**
- 下载中途杀死应用；重启后从 `bytes_done` 续传，若 `etag` 已变化则干净地重新开始，而不是拼接出损坏的字节。
- 禁用 `plugin-download` 后，同一曲目转为流式播放，且行为完全一致——即 [workflow/testing.md §6](../workflow/testing.md#6-测试策略) 中的那个测试。
- 策略在真实的 `ctx.device.network()` 状态变化下遵守 `wifi_only` 与 `charging_only`。
- 底层文件被删除时移除绑定，而不是拖到播放时才失败。
- 持续使用之下，缓存淘汰始终保持在各类配额之内。

---

### M4 —— 听感达标

`plugin-dsp` 与 [audio/playback.md §3](../audio/playback.md#内置效果) 中的内置效果。两个外壳中各有效果链编辑器 UI。

> **已交付（Shipped）。** `ctx.dsp` 与全部 9 种内置效果（`preamp`、`eq10`、`normalize`、`compressor`、`reverb`、`widener`、`crossfeed`、`tempo-pitch`、`limiter`）均已实现并得到验证（[audio/dsp.md §3](../audio/dsp.md#3-ctxdsp--效果链)）：
> - **统一跨平台效果**：EQ、normalize、compressor 与 reverb（以及其余 5 种效果）各凭一份纯 Web Audio 实现，即可在桌面端、iOS 与 Android 上运行。
> - **防爆音音频过渡**：音频图拓扑重接（启用/禁用/重排效果）使用 `ctx.audio.dipVolume(20)` 在 20ms 内指数级淡出并淡入增益，消除爆音与爆鸣。参数更新（如拖动 EQ 滑块）通过 `setTargetAtTime` 平滑应用，无需重建音频图。
> - **Dropout 安全保护**：`tempo-pitch` 监控音频 dropout，在资源受限平台上自动禁用自身，保护效果链其余部分不被拖垮。
> - **效果链编辑器 UI**：`@BBeBee/plugin-dsp-ui-desktop` 与 `@BBeBee/plugin-dsp-ui-mobile` 提供 10 段图形 EQ 滑块、拖拽/重排控制、单独旁通（bypass）开关、延迟报告与预设选择。
> - **设置页集成**：`@BBeBee/plugin-settings-ui-desktop` 与 `@BBeBee/plugin-settings-ui-mobile` 在"播放" / 音频设置中直接提供 EQ、Normalize、Compressor 与 Reverb 的开关、预设与滑块，并设有专门的 DSP 选项卡与导航路由。
> - **组合根已启用**：在 `apps/desktop/renderer/plugins.ts` 与 `apps/mobile/src/plugins.ts` 中均已加载启用。

**完成标准**
- EQ、normalize、compressor、reverb 各凭一份实现，即可在 iOS、Android 与桌面上运行。
- 每个效果的离线渲染测试都在容差内与参考值吻合。
- 拖动 EQ 滑块不重建音频图，也不产生爆音。
- 播放中启用或重排效果，除预期变化外听不出任何差别。
- 在低端 Android 设备上，`tempo-pitch` 会报告 dropout 并自行禁用，而不是拖垮整条效果链。

---

### M4.1 —— 桌面端 Bit-Perfect 音频（WASAPI Exclusive）

> **已缩减范围（Descoped，首个可用版本前移除）。**
> 独占模式输出（`core-audio-wasapi-native`、接收端 worklet、`initWasapi`/`writeWasapi` 桥接方法）经历了端到端原型验证后被移除：通过 `context.destination` 的共享输出已满足当前需求，而原生流水线为一个操作系统引入了 Rust 工具链与逐平台验证负担。这项工作中保留下来的成果包括：桥优先的 FFmpeg 解码路径、通过共享 `StreamedHandle` 实现的真正流式播放、音源 header 转发，以及原生采样率 `AudioContext` 重建（`audio/context-rebuilt`）。若未来 bit-perfect 输出重新成为产品需求，再行审视。

---

### M5 —— 沙箱上的第三方扩展

把 `ctx.js` 从"求值一条音源规则"推广为"承载一个扩展"：一座服务桥，其协议就是 [plugins/capabilities.md §7](../plugins/capabilities.md#能力语法) 的能力语法，外加安装、更新、卸载、能力授予与隔离（quarantine）。它排在 M2 之后而非之前，因为 realm、资源上限、宿主接触面的纪律与一致性测试套件都随音源一同到来——M5 是使用它们，而不是发明它们。

音源变为字符串之后，它的范围缩小了（[修订后的 ADR-1](../architecture/overview.md#adr-1--插件在所有目标平台上都静态打包)）：音乐后端不再需要这个，剩下的只有效果器、scrobbler、歌词提供方与传输层——真实存在，但已不再紧迫。如果这种需求始终没有出现，**不建 M5 也是一种合法的结局**，而 [plugins/loading.md §6.2](../plugins/loading.md#62-桌面端的附加设计--plugin-loader-dynamic) 中留置在架上的设计就是它付出的代价。

**完成标准**
- 在仓库之外构建的扩展可以从本地文件或 URL 安装，并运行**在 `ctx.js` 的 realm 内**，而不是渲染进程的 realm——于是 [plugins/concepts.md §7](../plugins/concepts.md#它不是什么) 里那条诚实说明终于可以被删掉，而不是改写。
- 扩展请求未被授予的能力时收到 `CapabilityError`，操作干净地失败，而不是让应用崩溃。
- 这道闸门在**两个**平台上都守得住，包括跨桌面桥——[plugins/concepts.md §7](../plugins/concepts.md#门实际运行的位置) 点名的缺口被关闭，否则 M5 不发布。
- 加载时连续抛错两次的扩展被隔离；此后应用正常启动，并说明原因。
- 卸载时先销毁（dispose）fiber 再删除文件；"移除数据"恰好只删掉该扩展带命名空间前缀的表。

---

### M5 之后

尚未排期，但架构已为其留好位置，且不被上述任何一项阻塞：

- **同步** —— 一个 `SyncProvider` SPI，附带基于文件/WebDAV 的参考实现。表结构中已备好 `device_id`、`revision` 与 `sync_state`。
- **真正的沙箱** —— 为第三方插件提供 `Worker` 或 QuickJS realm，并把 [plugins/capabilities.md §7](../plugins/capabilities.md#7-能力模型) 的能力语法用作桥接协议。
- **移动端运行时扩展** —— M5 的服务桥落地后即解除阻塞，因为沙箱本身已经随音源一同在移动端交付。
- **音源注册表** —— 一个可浏览、带版本的共享音源文档索引，附带更新通知。刻意不放进 M2：一个分发他人代码的渠道是一种承诺，模型得先在粘贴的字符串上证明自己。
- **指纹匹配** —— 一个为 `track_links` 供数的 AcoustID 插件。
- **更多提供方** —— Jellyfin、播客源，以及 SPI 最终证明能容纳的一切。

---

## 风险登记册

按预期代价而非发生概率排序。

### 🔴 Cordis 尚处于 release candidate（RC）阶段

它的 README 写明 API 可能不作通知就变更，而它又是一切的地基。

*缓解措施* —— 精确锁定版本；刻意收窄的 API 表面；插件从 `@BBeBee/kernel` 而非 `cordis` 导入，让签名变更由一个适配层吸收；以及语义测试，在升级时立即大声失败（[workflow/build-pipelines.md §5.1](../workflow/build-pipelines.md#51-cordis-rc-问题)）。

*触发重新评估的条件* —— 如果一次 RC 版本升级破坏了设计所依赖的隔离或 effect 语义，备选方案是把锁定的版本 vendor 进仓库。Cordis 核心只有几千行、两个依赖，这让该方案切实可行，而非纸上谈兵。

### 🔴 `react-native-audio-api` 尚未到 1.0

ADR-4 把整套跨平台 DSP 方案押在了一个 `0.13.x` 的包上。

*缓解措施* —— 契约是**标准 Web Audio API**，而非该库自身的形态，因此切换成本有上限。文档化的备选方案是改用基于 `react-native-track-player` 的 `core-audio-rntp`，代价是放弃移动端 DSP。

*早期预警* —— M1 会实测流式播放、无缝播放与锁屏控件。如果它在此令人失望，还能赶在 M4 依赖它之前重新审视这个决策。

### 🟠 抽象泄漏的速度快过修补的速度

`ctx.fs` 的两份实现渐生漂移；某个功能插件悄悄开始依赖桌面端行为；六个月后，"在我机器上能跑"的含义就变成了"在桌面端能跑"。

*缓解措施* —— 一致性测试套件是第一道防线，必须在 CI 中于真实设备上运行，而不能只在 Node 里跑。ESLint 导入禁令（[workflow/structure.md §3](../workflow/structure.md#3-依赖规则)）能拦下最粗糙的泄漏。已知泄漏点用 ⚠️ 记录在案而非藏起来，让贡献者在自己的代码出事之前先撞见它们。

### 🟠 双份 UI 复制的不只是视图层

ADR-2 接受了视图要写两遍。失败模式是逻辑悄悄渗进视图——从此逻辑也要写两遍，而两个外壳开始出现*行为*上的分歧。

*缓解措施* —— 三包约定，钩子放在 headless 包里（[ui/architecture.md §4](../ui/architecture.md#4-把服务绑定到-react)），加上 CI 中的组件对等（parity）测试。一旦桌面端与移动端对某个按钮的行为出现分歧，按定义这就是 headless 包的 bug。

### 🟠 iOS 后台限制

非音频类的后台工作在设计上就不可靠，任何架构都改变不了这一点。

*缓解措施* —— 约束被写进契约：提供 `ctx.background.canRunInBackground()` 让插件主动询问；`download_tasks` 按分块记录检查点，让中断的代价很小。UI 对"什么会继续、什么不会"如实相告，而不是摆出一条悄然卡死的进度条。

### 🔴 导入的音源是陌生人的代码

[ADR-5](../architecture/overview.md#adr-5--音源是导入的字符串由一个运行时解释) 把来自互联网的任意 JavaScript 放进了应用的正常工作流。这是项目刻意承担的风险，而且它是一等公民，不是脚注。

*缓解措施* —— 真正的 realm 边界，而非一纸政策：没有环境全局变量、值只能按克隆传递的 `ctx.js`（[services/contracts.md §19](../services/contracts.md#19-ctxjs--沙箱化求值器)）；可枚举的宿主 API；由引擎强制的时间与内存上限；以及——真正把损害框住的那一环——导入时展示给用户的**按音源出站（egress）白名单**（[sources/runtime.md §8](../sources/runtime.md#8-信任导入的源能做什么不能做什么)）。M2 的完成标准里包含一项恶意文档测试，所以这一论断是被核验过的，而不是口头断言。

*残余风险，如实写明* —— 音源能看到用户给它的东西，也能把这些发往它自己的后端。用户选择信任的后端，任何沙箱都无能为力。导入界面会列明主机；除此之外，决定权在用户。

*触发重新评估的条件* —— 出现一次沙箱逃逸，或者生态里文档普遍需要它们说不出正当理由的主机。应对不是放宽白名单，而是收窄一份文档能携带的东西：改为仅声明式的形态（profile），`@js:` 需要按音源单独选择加入。

### 🟠 音源会腐烂，而应用背锅

后端把一个字段改了名，所有指向它的文档都无声地返回空。导入的音源一多，这就不再是边缘情况，而是家常便饭。用户体验到的却是"应用坏了"。

*缓解措施* —— `RuleError` 是与网络故障不同的一类错误，UI 说的是"<音源> 需要更新"，而不是"出了点问题"（[sources/authoring.md §7](../sources/authoring.md#7-错误)）。过期的音源保留其缓存目录，而不是直接消失。`check` 抢在播放之前发现腐烂，测试界面展示后端实际返回了什么，让修复成为持有字符串的人两分钟的编辑（[sources/authoring.md §10](../sources/authoring.md#10-诊断一个坏掉的源)）。

*什么会让它更糟* —— 交付模型却不带 tracer。这是 M2 中唯一不能推迟的一件，因为没有它，每一个烂掉的音源都会变成一单支持请求。

### 🟡 不是音源的扩展没有容身之处

ADR-1 修订之后，第三方效果器或 scrobbler 在 M5 之前完全无法安装，而 M5 可能永远不会建。

*缓解措施* —— 留置在架上的设计继续保留并注明日期（[plugins/loading.md §6.2](../plugins/loading.md#62-桌面端的附加设计--plugin-loader-dynamic)），而 M5 所需要的那座沙箱如今已随音源一同交付，剩下的工作是一座服务桥，而不是一个子系统。需求出现，它就是一个里程碑；需求不出现，就没有花掉任何代价。

### 🟡 两个大型框架之间的版本漂移

Expo SDK 升级会一并带动 React Native 与 React；Electron 升级会一并带动 Node 与 V8。二者不会自发地在 React 版本上保持对齐。

*缓解措施* —— React 与 React Native 锁定在 Expo SDK 57 所规定的版本上，桌面端渲染进程跟随 Expo 使用的 React，而非最新发布版（[workflow/build-pipelines.md §5](../workflow/build-pipelines.md#5-版本矩阵)）。升级是一项排期任务，以一致性测试套件作为闸门。选择 `node:sqlite` 而放弃 `better-sqlite3`，已经消除了最沉重的一项经常性成本。

### 🟡 SQLite 作为唯一存储

一个数据库承载曲库、播放列表、历史、下载、设置与插件表。当曲库庞大、扫描器高效激进、下载队列繁忙时，写冲突完全可能发生。

*缓解措施* —— WAL、扫描器内的批量写入，以及两个平台上统一的单一串行写入路径。如果真的成为问题，把易变表（`play_history`、`cache_entries`、`download_tasks`）拆分到第二个数据库文件是一项影响可控的改动，因为没有任何查询跨这些边界做 JOIN。

*M1 时的实测* —— 在一首曲目播放、检查点不限速的情况下扫描 5,000 个文件，代价是 7–13%（空闲时 `18.2s`→`19.4s`，完整测试运行期间 `24.7s`→`27.9s`），数千个检查点落在扫描*进行中*而不是拖到扫描之后，且没有任何写入被拒绝。所以这个风险在形态上真实，在实践中尚不真实；下载队列是 M1 未能检验的那一半，因为 M3 才存在下载队列。探针是 [archive-m1.md §7](./archive-m1.md#7-夹具与测试架)，它在每一次 `pnpm test` 上运行。

---

## 什么会证明这个设计是错的

值得提前写下，以便日后一眼认出：

- **如果没有人写、也没有人导入任何音源**，规则语言、解释器、沙箱、导入流程与 tracer 就都是纯粹的负担，直接手写三个提供方反而更好。M2 交付的是机器；它之后的六个月才是检验。
- **如果规则语言表达不出人们真正想要的后端**，音源就会沦为插件的劣化版——文档里塞满 `@js:`，直到它们变成一部糟糕编辑器里写出的程序。信号就是语料库与共享文档中声明式规则与脚本的比值。
- **如果插件从未在运行时被加载**，能力模型与清单就是除了可审计性之外没有回报的成本——不过 ADR-1 的修订已经把那笔节省的大头提前入账，剩下的唯一问题只是 M5 值不值得建。
- **如果移动端与桌面端最终拥有实质不同的功能集**，双份 UI 就已经变成了两份*产品*，而 ADR-2 否决的 universal RN-Web 方案才是正确选择。

目前这些都还没有迹象。到 M5 时，三条全部可以检验。
