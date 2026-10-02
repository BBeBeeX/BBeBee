# @BBeBee/ui-kit-desktop

Layer 5（ui）— React DOM 版对等组件集（parity component set）的桌面半边。

## 概述

与 `ui-kit-mobile` 互为孪生：同名组件、同套 props（类型写在 `ui-core/props.ts`，两端只消费不复写）、同一份 `ui-tokens`。它**不是插件**（无 `BBeBee.plugin.json`），是被各 `plugin-*-ui-desktop` 视图包和宿主 shell 消费的纯组件库。

- 运行时依赖：`react` + `react-dom`、`@tanstack/react-virtual`（虚拟化）、`ui-core`（types）、`ui-tokens`、`protocol`（`Track`/`ArtworkRef` 类型）。
- 桌面允许用 DOM，但同样禁止接触平台**能力**——"需要 fs 的组件是放错了层"。
- exports 子路径：`.`、`./manifest`（parity 声明）、`./testing`（仅 monorepo 测试用）、`./package.json`。

## 源文件

### `src/index.tsx` — 11 个对等组件

每个组件都带 `CommonProps`（`testID` → `data-testid`；`accessibilityLabel` → `aria-label`）。颜色永远来自 `palettes[scheme]`（模块级 `scheme` 默认 `'dark'`，shell 启动时 `setScheme()` 设置；渲染在 scheme 之外时它是回退），**从不内联色值**——两个 kit 看起来像一个产品，是因为读同一批数字。

| 组件 | props | 职责与要点 |
|---|---|---|
| `Button` | `children*`, `onPress*`, `variant?`（primary/secondary/ghost/danger）, `disabled?`, `loading?` | 真 `<button type="button">`。`loading` 同时禁用并显示 `aria-busy="true"`、文案换成 `…`（防双击重复提交）。**焦点环不可移除**——`outline: none` 是 kit 破坏键盘导航的头号方式，被测试 pin 住。 |
| `IconButton` | `icon*`, `onPress*`, `accessibilityLabel*`（必填）, `variant?`, `disabled?`, `size?` | 整个表面就是一个图标。正方形，`width = tokens.size.touchTarget`（44px）——icon 再小也满足平台最小点击目标（测试 pin 了 size=8 时仍是 44px）。 |
| `TextField` | `value*`, `onChange*`, `placeholder?`, `multiline?`, `rows?`, `secure?`, `disabled?`, `error?`, `autoCorrect?` | 两端都**受控**。`multiline` → `<textarea rows>`（粘贴的源文档），否则 `<input type=text\|password>`（单行规则——不能用吞 Enter 的 textarea）。`spellCheck={autoCorrect ?? false}` 默认关：规则/URL 对拼写敏感。`error` 渲染为字段下方的红色 Text，**不是 hover title**（触摸没有 hover，读屏读不到 title）。multiline 用 mono 字体（等宽才能看出未闭合括号）。 |
| `Text` | `children?`, `variant?`（xs…display）, `tone?`, `numberOfLines?` | **整个 app 里唯一允许决定字号的地方**，只收 scale 名。`numberOfLines` 用 `-webkit-line-clamp`。 |
| `Artwork` | `artwork?`, `size*`, `radius?` | 封面。`dominantColor` 作为**背景**先于图片渲染——加载期间无灰闪、滚动无布局位移。无 `sourceUrl` 时只渲染色块。`<img loading="lazy" alt="">`——`alt=""` 是有意的：行组件已经念出曲名，装饰图对屏读器应静默。 |
| `TrackRow` | `track*`, `onPress?`, `onMore?`, `active?`, `showArtwork?`, `showAlbum?` | **全 app 渲染次数最多的组件**。标题 + 逗号连接的艺人；`active` = 正在播放（不等于选中）。`onMore` 桌面绑**右键**（`onContextMenu`）。键盘可达：`tabIndex=0` + Enter/Space，`role="row"`。 |
| `Slider` | `value*`, `max*`, `onChange?`（拖动中）, `onCommit?`（释放）, `disabled?` | 原生 `<input type="range">`，键盘步进免费获得；`onPointerUp`/`onKeyUp` commit、`onBlur` 清 dragging；`aria-valuenow`/`aria-valuemax`。 |
| `Sheet` | `open*`, `onClose*`, `title?`, `children?` | 模态打断面：全屏遮罩 + 居中面板（宽 320–560），`role="dialog"` + `aria-modal`；**Escape 关闭**；点遮罩关闭、面板内 `stopPropagation`。 |
| `List<T>` | `items*`, `renderItem*`, `keyExtractor*`, `estimatedItemSize?`, `onEndReached?`, `empty?`, `header?`, `sticky?`, `stickyHeader?`, `onScroll?` | `@tanstack/react-virtual` 窗口化（`overscan: 8`），spacer 撑出总滚动高度（滚动条反映整个库）。**`aria-setsize`（真实总数）+ `aria-posinset`**——窗口化对明眼人不可见、对屏读是灾难，除非把真实长度说出来。`onEndReached` 由"最后已渲染行"在 effect 里判定，`firedFor` ref 保证**每页只请求一次**。`count === 0 && empty` 渲染空态——"空白 pane 说明不了是加载、坏了还是真空"。**`header`** 随列表一起滚走（详情页的 Spotify 式渐隐头部）。**`sticky`** 是吸附栏——必须是滚动容器的**直接子节点**：`position: sticky` 只在父盒范围内吸附，嵌进 header 会恰好在它成型时滚走；净零流高度（`marginBottom: -height`）使其不参与偏移。**`stickyHeader`** 是固定表头——同理必须是滚动容器的直接子节点，嵌在 header 盒里时它作为父盒最后一个子元素等于完全吸不住；虚拟化偏移按 **spacer 实测位置**（`scrollMargin`，挂载时测量 + `ResizeObserver` + 内部滚动监听守着）计算，行 transform 随之抵消。**`onScroll`** 在每次滚动回报 `scrollTop`，驱动吸附栏的滑入与吸附。 |
| `EmptyState` | `title*`, `description?`, `action?`, `icon?` | 屏幕尚无内容时的展示——**永远不是一块空白**。 |
| `Toast` | `message*`, `tone?`, `action?`, `onDismiss?` | 瞬时反馈，"播报但不抢焦点"：`role="status"` + `aria-live="polite"`。 |

**kit 级导出**：`setScheme(next: Scheme)`（shell 启动时调用）。

**桌面专属扩展**（不进 parity 清单，mobile 无对应物）：`ContextMenu`（右键菜单 + 子菜单飞出，支持搜索过滤与顶部内嵌新建歌单）、`SaveToPlaylistPopover`（心形按钮的"添加到歌单"弹层，最小高度 480px、文件夹二级浮层 320px，随视口封顶；点击"新建歌单"在顶部搜索框位置无缝展开新建输入栏，带自动聚焦与 Escape/Enter 响应，同时自动隐藏列表中的新建行以避免混淆；确定按钮采用 `flexShrink: 0`、`whiteSpace: 'nowrap'` 防挤压包裹样式）、`StickyDetailBar`（详情页滚动折叠后的吸顶栏：标题 + 播放按钮，滑入/吸附动作均为 `progress` 的函数，`pointer-events` 跟随淡入以免透明的它吃掉 hero 的点击）、`useImageColor` / `headerGradient` / `tintRgba` / `extractVibrantColor`（封面主题色：`dominantColor` 优先，缺失时一次 canvas 取色，失败回退 `undefined` → 调用方的中性渐变；渐变按百分比收在 header 底边，其下内容与吸附表头同为纯色 `--bg-primary`）、`DetailTableHeader`（吸顶表头：列配置化（宽度/flex/对齐/图标/plain 列/visible 列/来源排序列），悬停分隔线与排序箭头内聚在组件里，默认无箭头，支持各详情页对“来源”列进行交互式排序）、`DetailPlayButton`（圆形主播放按钮，disabled 而非隐藏）与 `DetailHero`（hero 头部：眉题/两行截断标题/副标题/meta 槽/封面槽，有无封面切换纵排与底对齐横排）。排序下拉菜单条目的构建器在 `ui-menus`（`sortMenuItems`）。`viewModeMenuItems` / `useViewMode`。

### `src/manifest.ts` — parity 声明

把 kit 导出的组件及 props 写成**数据**（`KIT_TARGET = 'desktop'`、`COMPONENT_PROPS`、`COMPONENT_EXPORTS`）。除 `import type { KitPropMap }` 外零导入——React 参数名在运行时被擦除，运行时反射"比这份清单本身更值得怀疑"。与 mobile 的 manifest **逐字同构**（除 target 外），`ui-parity` 据此在 CI 里无 DOM 无设备地强制对等。

### `src/testing.ts` — `withListLayout(body)`（不随包发布）

桌面 `List` 的虚拟化器测量滚动容器的 `offsetHeight/offsetWidth`，而 jsdom 不做布局（测得零 → 渲染空窗口 → 所有数行数的测试因无关原因失败）。此辅助临时 stub 这两个属性：`role="list"` 元素返回视口高 400，其余返回行高 56（恰为 `tokens.size.row`）。**支持 async body**——虚拟化器在 layout effect 里测量，过早恢复尺寸会让第二次测量得零。之后恢复原始 descriptor，不跨测试泄漏。理念：**测量而非 mock 掉虚拟化器**——stub 掉虚拟化器的测试只能证明 stub 会正确窗口化。虚拟化器只有一个，就 fake 一次。

## 测试

`src/index.test.tsx`（jsdom）：多数组件用 `renderToStaticMarkup` 做**静态标记断言**——值得 pin 的是*可访问*输出（控件有名字、屏读可用角色、焦点环未被移除）；`List` 例外，跑进真 DOM + `withListLayout`：10000 条只渲染窗口、`aria-setsize="10000"`、spacer 覆盖全库、空态渲染、`onEndReached` 只触发一次。覆盖细节见各组件行。

## 相关文档

- `docs/08-ui-architecture.md` §6/§8：parity 契约与无障碍门禁
- `packages/ui/ui-kit-mobile/README.md`：孪生半边
- `packages/ui/ui-parity/README.md`：门禁本体
