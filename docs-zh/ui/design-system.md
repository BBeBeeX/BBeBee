# 视觉设计语言、设计令牌与排版系统

> **历史章节映射：** 原 `docs-zh/08-ui-architecture.md §6`。

## 6. 多主题色彩系统与视觉识别

视觉设计是一种**沉浸式、源于角色灵感的深色音乐播放器美学**，深深植根于品牌视觉识别之中。该系统被架构为一个可扩展的**多主题色彩系统**，支持运行时主题切换、令牌注入以及用户可自定义的配色方案。

令牌是**纯数据，而不是组件** —— 在桌面端（CSS 自定义属性）与移动端（React Native `StyleSheet`）之间保持 100% 对等，且没有任何重复的样式代码。

### 6.0 主题系统架构与令牌模型

色彩架构分为三层：
1. **Layer 1: 颜色原语（Color Primitives）** —— 从品牌参考提取的纯十六进制/rgba 颜色常量。
2. **Layer 2: 语义化颜色令牌（`ColorTokens`）** —— 按分类组织的意图驱动设计令牌：`bg`、`surface`、`brand`、`gradient`、`text`、`border`、`semantic`、`music` 和 `glow`。
3. **Layer 3: 组件映射与 CSS 自定义属性** —— 由 `themeToCssVariables()` 与 `applyThemeToDom()` 注入到 DOM 中的扁平 CSS 变量。

```ts
// @BBeBee/protocol — ColorTokens 与 ThemeDefinition
export interface ColorTokens {
  bg: {
    app: string
    primary: string
    secondary: string
    tertiary: string
  }
  surface: {
    s1: string
    s2: string
    s3: string
    hover: string
    active: string
    selected: string
  }
  brand: {
    primary: string
    primaryActive: string
    primaryHover: string
    accent: string
    accentHover: string
  }
  gradient: {
    brand: string
    progress: string
    blueViolet?: string
    ice?: string
    spectrum?: string
  }
  text: {
    primary: string
    secondary: string
    tertiary: string
    muted: string
    disabled: string
    placeholder: string
  }
  border: {
    subtle: string
    default: string
    hover: string
    active: string
    focus: string
  }
  semantic: {
    success: string
    warning: string
    error: string
    info: string
  }
  music: {
    playing: string
    lyrics: string
    lyricsActive?: string
    lyricsHighlight?: string
    waveform: string
    waveformActive: string
  }
  glow: {
    xs: string
    sm: string
    md: string
    lg: string
    blueXs?: string
    blueSm?: string
    blueMd?: string
    purpleXs?: string
    purpleSm?: string
    purpleMd?: string
    brandSm?: string
    brandMd?: string
  }
}

export interface ThemeDefinition {
  id: string
  name: string
  description?: string
  isDark: boolean
  tokens: ColorTokens
  lightTokens?: ColorTokens
  cssVariables?: Record<string, string>
  lightCssVariables?: Record<string, string>
}
```

### 6.0.2 双配色模式与浅色模式架构（WCAG AA 门禁）

所有四个内置主题（`midnight-purple`、`spotify`、`crimson-night` 和 `ocean-abyss`）以及核心设计系统调色板除了默认的深色美学外，均完整支持**浅色模式**：

#### 表面层级与亮度阶梯（Surface Luminance Hierarchy）
设计系统通过 `@BBeBee/ui-tokens` 为 `dark` 和 `light` 两种配色方案确立了严格的四层表面高度与亮度阶梯：

| 表面层级 | 深色调色板 | 深色相对亮度 | 浅色调色板 | 浅色相对亮度 | 职责与设计语义 |
|---|---|---|---|---|---|
| **`sunken`** | `#000000` | 0.000 | `#EAEBED` | 0.830 | 最深锚点：外层窗口底盘、侧边栏导航轨、凹陷输入轨道 |
| **`base`** | `#121212` | 0.006 | `#F7F7F8` | 0.931 | 主视口画布：可滚动视口、表格视图、信息流页面（避免刺眼的纯白 `#FFFFFF` 眩光） |
| **`raised`** | `#181818` | 0.009 | `#FAFAFA` | 0.956 | 凸起内容：媒体卡片、批量操作栏、悬浮工具搁板 |
| **`overlay`** | `#282828` | 0.021 | `#FFFFFF` | 1.000 | 最亮顶层：模态对话框、Sheet 抽屉、右键菜单、Tooltip 气泡、浮层 Popover |

当前主题在这套核心调色板之上映射自己的 `ColorTokens`：播放器底盘变量 `--player-bg` 是 `--bg-app`（主题 `bg.app`）的别名，在 `midnight-purple` 深色下为 `#05060A` —— 见 §6.3。

- **亮度反转逻辑与抗眩光设计**：在深色模式下，`sunken` 为最深暗底，`overlay` 相对最亮；在浅色模式下，`sunken` 依然是明度最低（0.830）的锚定层（`#EAEBED`），为主界面提供稳重的骨架感；主画布 `base` 专门调优为柔和暖灰（`#F7F7F8`，0.931）而非纯白，消除长时间聆听与浏览时的刺眼眩光与视疲劳；最顶层的浮层 `overlay` 采用纯白（`#FFFFFF`，1.000），确保弹出层能清晰浮动于主画布之上。
- **禁止直接色彩反转**：严禁粗暴的反色处理。背景转换为柔和的米白/灰白调色板，而品牌强调色采用同一品牌光谱内的更深色相，以维持 WCAG AA 对比度（如 Spotify 绿 `#12833C`、电光蓝 `#3B66F5`、绯红 `#C9184A`、深海湛蓝 `#087E96`）。
- **WCAG AA 合规门禁**：自动化测试 `paletteContrastIssues()` 与 `themeContrastIssues(theme, scheme)` 严格强制执行：
  - 正文 / 常规文本对比度 $\ge 4.5:1$（浅色模式下 `text.primary` 在 `sunken` 上达 **14.93:1**，在 `base` 上达 **16.74:1**；`text.secondary` 在 `sunken` 上达 **5.44:1**，在 `base` 上达 **6.06:1**）
  - 大号文本与关键 UI 边框对比度 $\ge 3.0:1$
  - 在 CI 中针对 `dark` 和 `light` 两种配色方案全量自动化验证。
- **组件 Token 规范与对比度保护原则（Component Tokenization & Contrast Preservation Rule）**：规范见 [rules/ui.md §4](../../rules/ui.md#4-visual-design-language--color-system)（L2）—— 禁止硬编码 `#FFFFFF`/`#000000` 前景色（一律使用语义 CSS 变量）；固定深色容器保持明亮前景色 / on-color 令牌（固定深色容器保护例外）。
- **实际方案决策（Effective Scheme Resolution）**：`settings.theme` 支持 `'dark' | 'light' | 'system'`。当选择 `'system'` 时，`plugin-theme` 借助 `window.matchMedia('(prefers-color-scheme: dark)')` 实时解析生效的方案，并监听操作系统主题偏好的变化。
- **DOM 单一写入者原则**：DOM 主题属性严格收敛至单一写入者（由 `plugin-theme` 调用的 `ui-tokens` 中的 `applyThemeToDom()`）：
  - `data-theme="{theme.id}"`（例如 `midnight-purple`、`spotify`）
  - `data-color-scheme="{effectiveScheme}"`（`dark` 或 `light`）
  - `target.style.colorScheme = effectiveScheme`
  - CSS 自定义属性（`--bg-app`、`--primary`、`--text-primary`、`--color-*` 等）

```ts
// @BBeBee/ui-tokens — 布局与排版令牌
export const tokens = {
  space: [0, 4, 8, 12, 16, 24, 32, 48, 64] as const,
  radius: { sm: 4, md: 8, lg: 16, pill: 999 } as const,
  font: {
    family: {
      ui: '"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    size: { xs: 11, sm: 13, md: 15, lg: 20, xl: 28, display: 40 } as const,
    weight: { regular: '400', medium: '500', bold: '700', heavy: '900' } as const,
    lineHeight: { tight: 1.2, normal: 1.45, loose: 1.7 } as const,
  },
  duration: { fast: 120, normal: 200, slow: 320 } as const,
  size: { touchTarget: 44, icon: 24, iconLarge: 32, row: 56, artworkThumb: 48 } as const,
} as const
```

### 6.1 主视觉识别：Bee Music · 赛博霓虹（`midnight-purple`）

主视觉识别直接源于 **Bee 动漫角色视觉参考**：
- **角色色彩光谱**：
  - 高对比度科技底盘：深黑（`#05060A`、`#080A10`）与纯白（`#FFFFFF`）。
  - 发光翼根与科技强调色：冰蓝（`#D4E2FF`、`#91B0FF`）与电光蓝（`#4D8BFF`、`#3875F6`）。
  - 半透明翼羽与悬浮音符：长春花蓝（`#7C86FF`）与薰衣草紫（`#9087FF`、`#A99CFF`）。
  - 翼尖光晕、耳机高光与星芒点缀：柔和紫罗兰（`#B47BFF`、`#C96BFF`）。
  - 阴影与底座纵深：深海军蓝（`#0B0E16`、`#0F1322`）。
- **连续光谱流动**：UI 不将单一死板的十六进制颜色固定为“品牌色”，而是采用连接电光蓝、长春花蓝、薰衣草紫与柔和紫罗兰的连续光谱渐变。
- **微妙霓虹光晕与柔光玻璃**：分级霓虹光晕（`--glow-brand-sm`、`--glow-blue-md`、`--glow-purple-md`）和毛玻璃半透明表面提供高科技触感层级，无需粗重笨拙的硬边框。

```css
/* 核心赛博霓虹渐变 */
--gradient-brand: linear-gradient(135deg, #5F87FF 0%, #7C86FF 45%, #9687FF 75%, #A99CFF 100%);
--gradient-progress: linear-gradient(90deg, #3875F6 0%, #4D8BFF 30%, #7C86FF 70%, #A99CFF 100%);
--gradient-blue-violet: linear-gradient(135deg, #4D8BFF 0%, #A99CFF 100%);
--gradient-ice: linear-gradient(135deg, #EAF1FF 0%, #91B0FF 50%, #4D8BFF 100%);
--gradient-spectrum: linear-gradient(90deg, #4D8BFF 0%, #7C86FF 25%, #9087FF 50%, #B47BFF 75%, #C96BFF 100%);
```

### 6.2 备选主题与运行时可扩展性

应用程序支持多个内置主题和动态用户自定义主题：
- **`midnight-purple`（Bee Music · 赛博霓虹）**：默认主主题。
- **`spotify`（Spotify 经典）**：高对比度经典流媒体播放器主题，带有标志性的 `#1DB954` 绿色强调色。
- **动态用户主题**：用户可通过"设置"导入任意自定义主题（`.json` 文件上传或粘贴原始 JSON）。主题引擎动态验证并将缺失的令牌与 `midnightPurpleTheme.tokens` 进行深度合并，在运行时注册该主题，并持久化至 `ctx.store`。
- **内置主题受保护与安全删除**：内置主题不可删除（`removeTheme()` 返回 `false`）。自定义主题可通过“设置”删除；若当前激活的自定义主题被删除，引擎会立即自动回退至 `midnight-purple` 并发出 `theme/registry-changed` 事件。

### 6.3 表面层级与后退式纯黑底盘

纵深感通过**微妙的亮度阶梯与半透明图层**来传达，以近黑底盘锚定（默认 `midnight-purple` 深色方案为 `#05060A`）：

| 层级 | 取值 / 变量 | 角色与用法 |
|---|---|---|
| `chassis` | `#05060A` / `var(--player-bg)`（`--player-bg` ≡ `--bg-app`，即主题的 `bg.app`） | 外壳框架、桌面端侧栏和常驻底部播放栏。近黑纯色且无顶边框（`borderTop: none`），消除视觉噪音并锚定视口。 |
| `bg.base` | `#080A10` / `var(--bg-primary)` | 播放列表、专辑视图、搜索结果和曲库网格的主可滚动画布。 |
| `surface.s1` | `var(--surface-1)` | 抬升的媒体卡片（专辑/歌单磁贴）和分区面板。 |
| `surface.s2` | `var(--surface-2)` | 悬停状态卡片、对话框和抽屉弹层。 |
| `surface.hover` | `var(--surface-hover)` | 单曲行与可交互元素的激活悬停高亮。 |
| `surface.selected`| `var(--surface-selected)` | 选中行、激活导航标签与焦点胶囊。 |
| `border.subtle` | `var(--border-subtle)` | 主要结构面板之间的发丝级分隔线。 |
| `border.focus` | `var(--border-focus)` | 符合 WCAG 1.4.11 3:1 对比度的无障碍焦点环。 |

- **动态反应式画布渐变**：详情视图（专辑详情、最喜欢、本地音乐、歌单详情、设置）渲染响应 `--surface-hover` / `--surface-selected` / `--surface-1` / `--bg-primary` 的平滑垂直环境渐变，即刻随主题切换自适应。
- **封面着色详情页主题**：四个详情页（专辑详情、歌单详情、最喜欢、本地音乐）借助套件的 `headerGradient(tint)` / `tintRgba`，从封面的 `dominantColor` 中提取头部区域渐变以及滚动收缩粘性栏的底色 —— 顶部色调最浓（~50% alpha），通过百分比停靠点恰好在头部下边缘平滑过渡至 `--bg-primary`，使下方所有内容（曲目行与固定表头）都坐落在无缝的同一纯色背景上。没有声明颜色的引用通过 Canvas 进行一次性提取（`useImageColor` → `extractVibrantColor`）；无法读取的封面或完全无封面回退至上述中性品牌底色，绝不报错。“最喜欢”页面固定使用红心紫（`#450af5`）作为身份色调；“本地音乐”无单一封面，保持中性渐变。

### 6.4 CSS 简写与样式规范

> 规范见 [rules/ui.md §4「CSS Shorthand & Styling Rule」](../../rules/ui.md#css-shorthand--styling-rule)（L2）—— 凡是可赋主题令牌或渐变之处，一律写 `background:`，绝不写 `backgroundColor:`：渐变取值的变量会被 `backgroundColor` 当作无效 CSS 静默丢弃，元素因此变为透明。

### 6.5 字体与排版字号体系

排版字体栈优先选用几何怪诞体（geometric grotesque）字形：
`"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`。
字体从操作系统/系统本地解析，而不是从网络下载，避免外来网络字体的授权问题与 CSP 网络开销。

字号刻度遵循**“字重随字号”**原则：
- **Display（`40px`，字重 `900` heavy，行高 `1.2`）**：歌单与专辑详情页上的巨幅主标题。
- **XL（`28px`，字重 `900` heavy，行高 `1.2`）**：主要分区标题（“为你推荐”、“最近播放”）。
- **LG（`20px`，字重 `700` bold）**：分区标题、书架标题、对话框标题。
- **MD（`15px`，标题用 `700` bold，正文用 `400` regular）**：曲目标题、主菜单标签。
- **SM（`13px`，字重 `400` regular）**：艺人名、专辑副标题链接、时长时间戳。
- **XS（`11px`，字重 `500` medium / `700` bold，全大写）**：列标签（`TITLE`、`ALBUM`、`DATE ADDED`）、分类标签与时长徽标。

### 6.6 组件可供性与微交互

- **药丸按钮（`radius.pill: 999`）**：交互控件（主操作按钮、分类筛选胶囊、标签开关）均为药丸形。在面板皆为矩形的无边框深色 UI 中，全圆角形状立即传达出“可按压”。
- **悬停微缩放**：主药丸按钮在光标悬停时轻微放大（`transform: scale(1.04)`，历时 `120ms`），而不仅是变色，在近黑背景上提供即时的、可触知的物理反馈。
- **传输播放按钮**：主播放控件为圆形，在鲜活的品牌渐变填充（`background: var(--gradient-brand)`）之上承载高对比度图标。
- **媒体卡片与悬浮播放揭晓**：矩形卡片（`radius.md: 8px`，`bg.raised: #181818`）顶部是方形封面（`radius.sm: 4px`），随后是粗体标题与艺人副标题。光标悬停时：
  1. 卡片背景从 `#181818` 提亮到 `#282828`。
  2. 一枚鲜绿的圆形播放按钮（直径 `48px`，`#1DB954` 填充，`#000000` 播放字形）从封面右下角缓缓升起，带轻微的 translateY 与透明度过渡（`120ms`）以及淡淡的投影。
  3. 点击播放按钮立即开始播放该容器的内容，无需跳转导航。
- **曲目行（`TrackRow`，高 `56px`）**：
  - 显示序号、封面缩略图（`48px` 方形，`radius.sm: 4px`）、`#FFFFFF` 的曲目标题、`#B3B3B3` 的艺人、专辑名与时长。
  - 悬停时，该行被照亮（`#282828`），曲目序号被替换为播放图标（`play-filled`），快捷操作（通过 `onToggleLoved` 触发的红心/喜爱切换按钮 `heart` / `heart-filled`、上下文菜单 `dots`）变为可见。
  - 处于活动播放状态时，曲目标题、曲目序号和均衡器图标亮起标志性绿色（`#1DB954`）。
- **进度条与滑块（`Slider`、`VerticalSlider`）**：
  - 水平与垂直条具有纤细的 `3px` 轨道高/宽和深色背景轨道。
  - 被动展示期间已播放进度填充显示为 `#FFFFFF`，但在光标悬停或主动拖拽时亮起标志性绿色（`#1DB954`）。
  - **仅在悬停时显现手柄**：圆形拇指手柄（直径 `12px`）在闲置状态下隐藏（`opacity: 0`），以保持密集视图中线条干净；仅在光标悬停于滑块上方或主动拖拽时平滑显现（`150ms` 内 `opacity: 1`）。
  - 进度条（`ProgressBar`）：匹配滑块尺寸的纤细 `3px` 轨道。
- **全局滚动条**：
  - 隐藏轨道背景（`background: transparent`）、极窄宽度（桌面端 `4px`）与高透明度滑块（默认 `rgba(255, 255, 255, 0.2)`，悬停 `0.4`）共同保持深色画布的连续性。
  - 滚动条可见性双类机制（`is-scrollbar-hover` / `is-scrolling`）与 Chromium 陷阱：规范与原理见 [rules/testing-and-gotchas.md §2](../../rules/testing-and-gotchas.md#2-common-gotchas)（L2）。
- **截断名称的悬停浮层标签（`HoverLabel`）**：
  - 包裹截断的标题/名称；将光标在其上停留 **2 秒** 会弹出一个 Portal Tooltip（固定定位在 `document.body` 上，使列表行的 `overflow: hidden` 无法裁剪它），展示完整文本。光标移开、滚动、调整窗口大小或按 `Escape` 时关闭。
  - 应用于详情页的巨幅标题（`DetailHero` —— 专辑/最喜欢/歌单/本地）以及曲库与专辑表格行的曲目标题/艺人单元格。
- **截断播放文本的跑马灯滚动（`MarqueeText`）**：
  - 一个单行裁剪盒，当文本溢出时通过 Web Animations API 往复滚动其内容（滚动到末尾、停顿、滚回）；当文本能放下或 `element.animate` 不可用（测试环境）时保持为静态单行。
  - 用于底栏的曲目标题和艺人名称。
- **TopBar 搜索栏与动态图标平移**：
  - 居中的搜索输入框（默认宽度 `360px`，最大宽度 `480px`，高 `36px`，药丸圆角 `radius.pill: 999`，背景色 `#282828`）。
  - **窗口收缩时折叠为放大镜**：当窗口将中间区域压缩到 180px 以下时（ResizeObserver 测量），搜索栏渲染为单个放大镜按钮；点击它会在顶栏横向展开搜索 —— 展开期间托盘和头像图标隐藏，窗口控制按钮绝不隐藏 —— 点击其他区域、按 `Escape` 或提交查询会恢复图标与折叠按钮。
  - **动态图标定位**：
    - *闲置状态*：搜索图标（`search`）位于左侧内边距（`left: 12px`），带占位文本 `"搜索歌曲、专辑、艺人..."`。
    - *激活 / 聚焦状态*：搜索图标平滑横向滑移至输入框最右侧（`right: 12px`，动画 `all 200ms cubic-bezier(0.4, 0, 0.2, 1)`），充当可点击的搜索提交触发器。
    - *失焦取消*：点击搜索区域外部或按 `Escape` 将图标重置回左侧。
- **2×2 搜索矩阵浮动面板**：
  - 定位在搜索输入框正下方（`top: calc(100% + 8px)`，宽 `600px`，`z-index: 1000`）。
  - 抬升的 `#181818` 卡片表面，带有 `#282828` 边框、`12px` 圆角和环境投影（`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5)`）。
  - 2×2 网格布局（`display: grid; grid-template-columns: 1fr 1fr; gap: 16px`）：
    - **第 1 行（表头行）**：
      - 左列：“搜索范围”（`Search Scope`）分区标题（`xs: 11px`，`text.secondary`）。
      - 右列：“搜索历史”（`Search History`）分区标题（`xs: 11px`，`text.secondary`），附带邻近的高透明度“清空”（`Clear`）按钮（`rgba(255, 255, 255, 0.4)`，悬停 `rgba(255, 255, 255, 0.8)`）。
    - **第 2 行（内容行）**：
      - 左列（音源）：连接至 `useSearchSourceSelection(ctx)` 的交互式第三方音源开关按钮。渲染单个音源接口胶囊（激活时呈现标志性绿色 `#1DB954` 填充与黑色文字；未激活呈现 `#282828` 与灰色文字）以及“全部”与“重置”批量开关。
      - 右列（历史）：存储在 `localStorage`（`bbebee_search_history`，最多 10 项）中的交互式搜索历史标签。点击任意标签立即执行该搜索。历史记录为空时显示空状态标签（“暂无搜索历史”）。

### 6.7 动态主视觉渐变与封面展示

- **方形封面（`radius.sm: 4px`）**：曲目、专辑和歌单采用正方形宽高比。艺人采用圆形头像（`radius.pill`）。
- **零布局跳动加载**：封面容器立即展示 `blurhash` 字符串作为背景，同时惰性加载完整分辨率图片，并回退至 `artworks.dominant_color`。完全不存在的封面则自动生成：从实体 URN 推导出的确定性 identicon（见上述渲染规则），使无封面的曲库依然呈现为稳定、形态各异的正方形网格。
- **动态环境巨幅横幅**：歌单和专辑视图的头部区域从封面图中提取 `artworks.dominant_color`，生成丰富的垂直渐变，从顶部横幅向下辐射并平滑融入 `#121212` 基础画布中。

### 6.8 外壳结构与布局范式

- **桌面端外壳**：
  - **左侧导航栏 / 侧边栏（下沉 `#000000`）**：专用于浏览用户内容和收藏（主页/音乐库、历史记录、可滚动的歌单列表）。全局工具路由（搜索与设置）特意从侧边栏中排除。
  - **TopBar 顶部栏（下沉 `#000000` / `#121212`）**：横跨窗口标题栏。
    左侧：品牌 Logo（主页）和窗口导航历史按钮（前进/后退）—— ⋯ 更多菜单已被移除。
    中间：带动态搜索图标平移、窄窗口下折叠为放大镜以及 2×2 矩阵浮动面板（搜索范围音源 + 搜索历史）的搜索输入框。
    右侧：插件托盘、直接链接到设置中心（`settings.view`；设置也通过 `'tray'` 路由放置出现在托盘中）的用户头像按钮，然后是绝不隐藏的最小化/最大化/关闭窗口控制按钮。
  - **中央主内容卡片（`#121212`，圆角）**：可滚动的画布，承载动态渐变巨幅头部、操作栏（大号绿色圆形播放按钮 `play-filled`、爱心/保存 `heart` / `heart-filled`、更多选项 `dots`）以及虚拟化的单曲列表或媒体卡片网格。曲库视图通过顶层作用域（`全部`、`本地`、`最喜欢`）和内容视图（`歌曲`、`专辑`）组织条目。
  - **常驻底部播放栏（下沉）**：横跨整个窗口宽度（`borderTop: none`）。
    左侧：当前曲目封面缩略图、曲目标题（`#FFFFFF`）与艺人副标题（`#B3B3B3`）—— 两者在空间压缩时均跑马灯滚动（`MarqueeText`）而非简单截断 —— 以及保存按钮。
    中间：播放控制（前一首左侧的当前播放模式按钮、前一首、超大圆形播放/暂停按钮、后一首、后一首右侧的声音状态图标，带有静音 'x' / 音量波纹档位，点击可切换带有底部静音开关的垂直音量滑块浮层）与时间进度条，在显示 `缓冲中…` 时宽度保持恒定（固定的 64px 槽位承载该标签）。
    右侧：功能切换（桌面歌词开关、播放队列、输出设备选择器）。播放模式按钮循环切换 顺序播放 / 单曲循环 / 列表循环 / 随机播放。
  - **TopBar 布局定位**：TopBar 嵌入在主内容面板顶部 —— 而非贯穿全宽的横条 —— 因此侧边栏与播放队列面板得以延伸整个窗口高度；当音乐库的展开模式占据工作区时，TopBar 移入展开后的曲库面板内。
  - **队列抽屉**：覆盖在工作区之上的右侧抽屉（`position: absolute`，位于 48px 顶部栏之下，保证窗口控制按钮始终可触达）。它不占据任何网格列，因此打开它不会引起任何重排；队列拖拽调节条调整其宽度，双击调节条恢复默认宽度（340px）。`ui/navigate 'queue.view'` 仅切换抽屉 —— 绝不会弹出打开它的页面 —— 在全屏播放页之上时，抽屉浮于播放页蒙层之上（`zIndex: 120` 对蒙层的 100；否则为 40，调节条 125）；仅有分享弹窗（130）与桌面歌词窗口（9999）位于其上。
  - **全屏播放页**：叠加在外壳之上的蒙层 —— 不透明、fixed、z-index 100，作为外壳根节点的后续子节点 —— 绝不是早期返回的分支切换，因此每个缓存页面都保持挂载在其下（[ui/architecture.md §7.1](architecture.md#71-桌面端外壳导航与顶部栏交互)）。
  - **曲库侧栏快捷入口**（喜欢 / 本地和下载）：高亮状态来自外壳的真实当前路由（`activeViewId` prop），绝非来自 `ui/navigate` 事件 —— 外壳内部导航（专辑详情、前进/后退、主页）不会发出任何此类事件。
  - **队列行拖拽重排**：原生 HTML5 拖放（无依赖）外加 Alt+↑/↓；可见播放顺序中的落点间隙经 `upcomingDropToQueueIndex`（`plugin-queue-ui-desktop/src/reorder.ts`）换算为队列行索引；随机播放开启时禁用拖拽，因为此时的可见顺序只是排列，而非行本身。
- **移动端外壳**：
  - 干净的全出血深色视图，带有底部导航标签栏（音乐库、搜索）和作用域限定的曲库过滤（`全部` / `本地` / `最喜欢`）。
  - 停靠在标签栏正上方的常驻迷你播放器，展示封面缩略图、跑马灯标题、艺人名称、播放/暂停切换以及发丝级播放进度条。
  - 全屏播放面板：展开迷你播放器会向上滑出沉浸式播放器，展示大方形封面、加粗几何排版、进度滑块、圆形传输控件以及上滑式歌词面板。

### 6.9 图标系统与线条粗细规范（Tabler Icons，stroke = 1.25）

桌面端 UI 中的所有图标统一基于 **Tabler Icons SVG 路径**。描边粗细、禁止手写 SVG 规则（含移动端 `MENU_ICON_GLYPHS` 例外）与无障碍渲染契约（`aria-hidden="true"` + `data-icon="{name}"`，测试查询 `[data-icon]`/`data-testid`）为规范内容，见 [rules/ui.md §4.1](../../rules/ui.md#41-tabler-icons--stroke-standard-stroke--125)（L2）。1.25 描边在深色背景上提供清晰、高精度的几何形态，在小字号下不会产生视觉沉重感或模糊。

- **标准尺寸与默认大小**：默认图标大小为 `28px`（`packages/ui/ui-kit-desktop/src/icons/tabler.ts` 中的 `DEFAULT_ICON_SIZE = 28`）。尺寸刻度：
  - `sm`: 16–20px（表格行操作、列头、元数据徽标）
  - `md`: 22–24px（侧边栏导航、操作栏、滑块手柄、标准按钮，`tokens.size.icon = 24`）
  - `lg`: 28–32px（播放控制、弹窗头部，`tokens.size.iconLarge = 32`）
  - `xl`: 36–52px（巨幅播放按钮、空状态）
- **集中注册表**：`packages/ui/ui-kit-desktop/src/icons/registry.ts` 提供 `ICON_ALIASES`，将语义别名键映射到官方 Tabler 定义（未知名称回退为 Tabler 键本身）。别名键分组如下：
  - 导航与搜索：`home`、`search`、`library`（→ `books`）、`compass`
  - 播放与音量：`play`、`play-outline`、`pause`、`pause-outline`、`previous`、`next`、`volume`、`volume-high`、`volume-2`、`volume-3`、`volume-zero`、`mute` / `volume-off`
  - 播放模式：`shuffle`、`repeat`（`list-loop`）、`repeat-once`（`single-loop`）、`sequence`（→ `list-numbers`）
  - 收藏与操作：`heart`、`heart-filled`、`plus`、`minus`、`trash`、`x`（`close`/`clear`）、`pin`、`pencil`（`edit`）、`download`、`clock`、`alarm`、`history`、`playlist`（`queue`）、`list`、`sort`（→ `arrows-sort`）、`dots`（`more`）、`dots-vertical`、`folder`、`folder-plus`（`create-folder`）、`folder-share`（`move-folder`）、`music`、`disc`（`album`）、`playlist-add`（`create-playlist`）、`list-check`、`check`、`checkbox`
  - **加入列表语义**："加入歌单 / 添加至其他歌单 / 添加（歌单详情）"操作使用纯 `plus`；"加入播放列表"（入播放队列）使用 `playlist-add`（列表 + 加号），以区分二者。
  - 方向与界面：`chevron-left`（`back`）、`chevron-right`（`forward`）、`chevron-down`（`expand`）、`chevron-up`（`collapse`）、`alert`、`settings`、`adjustments`（`tune`）、`user`、`lock`、`lock-open`、`copy`、`camera`、`info-circle`（`info`）、`share`、`share-box`（`external-link`）、`bug`、`sidebar`（→ `layout-sidebar`）、`maximize`、`minimize`、`wave-sine`（`equalizer`）
- **无障碍与测试友好**：SVG 元素输出 `aria-hidden="true"` 和 `data-icon="{name}"`。测试套件查询 `[data-icon="..."]` 或 `data-testid`，而非针对文本节点值断言 —— 见 [rules/ui.md §4.1](../../rules/ui.md#41-tabler-icons--stroke-standard-stroke--125)（L2）。

**组件对等是一项契约。** 两个套件导出相同的组件名称与相同的 props —— `Button`、`IconButton`、`TrackRow`、`Slider`、`Sheet`/`Dialog`、`List`、`EmptyState`、`Toast`、`TextField`、`Text`、`Artwork`、`JsonTree`。编写两个视图包的插件作者应该是在转录代码，而不是重新设计。CI 中的对等测试会对两个套件导出的名称和 prop 类型进行 diff 对比，出现分歧则构建失败，因为若非如此，套件会悄无声息地发生偏移，代价由每位插件作者承担。

---

## 7. 桌面设置中心：布局与诊断

贡献域的归属规范见 [rules/ui.md §5](../../rules/ui.md#5-desktop-settings-center--diagnostics-specifications)（L2）：设置页自身不拥有任何被贡献的域。

### 7.1 布局与导航
- **单页设置界面**：左侧是一条固定的纯文字标签栏（纯文本标签，无图标），右侧是一个自然滚动的主容器，只渲染当前激活标签对应的分区组 —— `SettingsScreen` 仅渲染与 `activeTab` 匹配的分区（互斥分区渲染），且各分区携带稳定的 `section-<id>` 锚点 id。避免在分区内嵌套滚动容器。
- **卡片级层级**：分区卡片使用弱化的半透明背景（`rgba(255, 255, 255, 0.03)`）并留足留白，而不是把单条设置项各自包成孤立卡片。
- **一致的行组件**：
  - `Boolean` → `Switch`
  - `Enum` → `Select` 下拉
  - `Number` → `Slider`
  - `Text` → `Input`
  - `Action` → `Button`
  - `Nested/Expanded` → Chevron 可展开行

### 7.2 设置中的专属域：谁贡献了什么

| 分区 | 由谁贡献 | 形态 |
|---|---|---|
| `general` — 用户资料 | `plugin-library` (`library.profile`) | card，视图在 `plugin-library-ui-desktop` |
| `general` — 主题管理 / 外观模式 | `plugin-theme` (`theme.settings`) | card（视图在 `plugin-theme-ui-desktop`） |
| `general` — 语言、closeToTray | settings service（保留行）/ 组合根 | 保留行 + `fields` |
| `playback` — 播放页样式模板 | `plugin-now-playing` (`now-playing.styles`) | card，视图在 `plugin-now-playing-ui-desktop` |
| `playback` — 过渡与衔接 | `plugin-player` (`player.transition`) | `fields`（gapless、crossfade、pause-on-unplug） |
| `playback` — 音频引擎/独占/设备 | 组合根（`apps/*/boot.ts`） | `fields` + `optionsAsync`/`noteAsync` |
| `playback`/`audio` — DSP 卡、响度标准化 | `plugin-dsp` | card（已贡献） |
| `playback` — 音频可视化 | `plugin-visualizer` | card（已贡献） |
| `lyrics` — 桌面歌词设置 | `plugin-desktop-lyrics` (`desktop-lyrics.settings`) | 带实时预览的 card，视图在 `plugin-desktop-lyrics-ui-desktop` |
| `lyrics` — 歌词源管理 | `plugin-lyric-sources` (`lyric-sources.manage`) | card，视图在 `plugin-lyric-sources-ui-desktop` |
| `network` — 第三方音源/歌词源总开关、User-Agent、代理 | `plugin-source-runtime` / `plugin-lyric-sources` / 组合根 | `fields`（分源代理规则的 `switch-list`） |
| `sources` — 音乐来源、导入、本地文件夹 | `plugin-sources` / `plugin-local-scanner` | link rows（已贡献） |
| `storage` — 下载目录 | `plugin-download` | `fields`（`directory`） |
| `storage` — 缓存目录与占用 | `plugin-cache` | `fields`（`directory` + 带结果反馈的 `action`） |
| `plugins` — 插件管理 | `plugin-manager` (`manager.view`) | card，视图在 `plugin-manager-ui-desktop` |
| `shortcuts` — 全局快捷键 | `plugin-settings` 自身 (`settings.shortcuts`) | card，视图在 `plugin-settings-ui-desktop` |

迁移之后仍归属其所有者的域行为：

- **桌面歌词**：主启用开关、单/双行模式、对齐、字体族与字号（16–48px）、颜色（含十六进制输入）、不透明度（0.2–1.0）、实时悬浮预览卡，以及严格的 4 步启动生命周期（1. 检查是否启用 → 2. 恢复位置 → 3. 推送设置与数据 → 4. 显示窗口）—— 全部位于 `plugin-desktop-lyrics` 的卡片视图内。
- **全局快捷键**：注册是 `plugin-settings` feature 拥有的 headless 编排（`watchGlobalShortcuts`）：它的生命周期与服务一致 —— 而非随设置页挂载而生灭 —— 并在 `settings/changed` 时重新绑定。被贡献的卡片只渲染开关与键位绑定。
- **代理**：桌面主进程负责应用配置（session 代理、认证、`proxy:test` 延迟探测）；描述符 —— 包括 Google 探测动作与分源 `switch-list` —— 由组合根贡献。
- **关于与高级设置（诊断防护门）**：这是设置页唯一保留硬编码的域（它是设置服务自己的页面）：应用元数据、收容开发者诊断（`debug.view`、`debug.logs`、`debug.http-logs`）的"高级设置"防护门，以及危险区（设置重置）。

### 7.3 诊断系统
- `debug.view`：调试模式指示器、环境规格（Node、Electron、OS、Chromium、路径），以及指向各日志页面的快捷入口。
- `debug.logs`：实时环形缓冲区日志（`ctx.logBuffer`），带级别过滤与搜索；完整缓冲区以 NDJSON 复制到剪贴板（复制全量日志），清空日志则清空缓冲 —— 没有文件导出动作（`LogsScreen.tsx`）。
- `debug.http-logs`：三方音源发出的 HTTP 请求，详列方法、状态码、延迟与 URL。

---

## 8. 曲库侧栏模式与右键菜单设计

文件夹/合集语义与递归曲目收集规范见 [rules/ui.md §6](../../rules/ui.md#6-library-sidebars--context-menus-specification)（L2）。

### 8.1 曲库布局模式
- **折叠模式（72px）**：极简紧凑侧栏，仅显示图标磁贴。文件夹渲染专属的文件夹线框 SVG 图标。进入文件夹后，顶部 Logo 下方出现 `chevron-left` 返回按钮，用于回到根曲库。
- **侧边栏模式（260–340px）**：标准曲库导航。文件夹通过旋转箭头指示器（`chevron-down` / `chevron-right`）内联展开/折叠，子项缩进 28px 左内边距。点击文件夹行导航进入文件夹详情页（`chevron-left 文件夹名称`）。
- **展开模式（全画布）**：高密度 3 列表格视图，带面包屑（`音乐库 < 文件夹名称`）、可交互搜索与响应式尺寸。

### 8.2 右键菜单设计规范
- **播放器表面上的曲目菜单**：底栏封面与全屏播放页右键弹出同一个曲目菜单模型（`trackMenuItems`）；播放页传入正在播放队列条目的 id（`state.currentItemId`，按 `trackUrn` 回退到队列行），使"从队列中移除"准确作用于真实队列行，页面已渲染的歌词文本则作为 `TrackMenuOptions.lyrics` —— 正是这个选项让"分享歌词"可用；模型自身绝不抓取歌词。两个表面都通过 `useCurrentTrack`（`plugin-now-playing-ui-desktop/src/hooks.ts`）解析正在播放的曲目。全屏播放栏渲染在一个 `overflow: hidden` 容器内，其底栏经 `transform` 滑动 —— 固定定位的菜单要么被裁剪，要么被重新锚定 —— 因此外壳向它传入 `portalMenus: true`，套件将 `ContextMenu`/`SaveToPlaylistPopover` 挂载到 `document.body`（`portal` prop）。
- **深色卡片主题**：`#242424` 背景、8px 圆角、4px 内边距、`0 12px 32px rgba(0,0,0,0.55)` 深度阴影，以及 1px 边框（`rgba(255, 255, 255, 0.08)`）。
- **分割线**：菜单项支持 `divider: true`，渲染 1px 半透明分隔线（`rgba(255, 255, 255, 0.08)`）。
- **分区标题**：菜单项支持 `heading: true`，渲染为贴左对齐的弱化分区标签（12px 内边距，无 18px 图标槽，无悬停高亮，更小的粗体字）—— 用它为一组选项命名，并在前一项上使用 `divider: true` 来闭合上一组。
- **线框图标**：标准操作映射到 Tabler SVG 图标（`stroke: 1.25`）：`pencil`、`trash`、`pin`、`plus`、`folder`、`play-filled`、`download`、`playlist`。
- **专属弹窗**：
  - `EditPlaylistModal`：修改封面图（文件选择器或 URL）、标题与多行描述。
  - `RenameFolderModal`：重命名文件夹标题，经 `ctx.library.renameCollection` 保存。
  - `ConfirmDeleteModal`：针对歌单与专辑破坏性删除的二次确认弹窗。展示按实体定制的警告（"确定要删除歌单“{name}”吗？此操作无法撤销。" / "确定要从音乐库中删除专辑“{name}”吗？"），带高危操作按钮与取消选项；支持 `Escape` 关闭。只有显式确认后才会执行删除。
- **专辑右键菜单**：
  - 专辑行支持与歌单观感一致的右键/上下文操作：`delete-album`（高危色带分割线，打开 `ConfirmDeleteModal` 从曲库与文件夹中移除专辑）、`toggle-pin`（置顶/取消置顶专辑）、`add-to-collection`（移动到文件夹、子文件夹或根目录）。
- **文件夹可移动性与根列表一致性**：
  - 嵌套在文件夹内的歌单自动从曲库根列表中隐藏（`containedPlaylistUrns`）。把歌单移回根层级会立即恢复其在根列表中的显示。
  - 文件夹内实体的右键菜单提供"移至根目录"选项，移动到其他目标文件夹时自动从源文件夹中移除该条目，并伴有即时的 0ms 乐观 UI 更新。
- **视口边界感知**：
  - 右键子菜单（Flyouts）相对视口动态计算水平（左/右）与垂直（上/下）翻转。
  - 子菜单高度动态钳制（`maxHeight = Math.max(120, viewportHeight - flyoutTop - 8)`）并开启内部滚动（`overflowY: 'auto'`），保证嵌套菜单绝不溢出应用窗口边界。

---

## 9. 详情页排序与播放历史

严格曲目去重、喜欢双写不变量、播放队列一致性与歌单项 ID 解耦规范见 [rules/ui.md §7](../../rules/ui.md#7-detail-screens-sorting--playback-history-specifications)（L2）。
封面着色的详情页主题规格见上文 [§6.3](#63-表面层级与后退式纯黑底盘)。

### 9.1 收缩头部与粘性栏（`AlbumScreen`、`PlaylistDetailScreen`、`FavoritesScreen`、`LocalMusicScreen`）
- **Spotify 式收缩头部**：详情页的巨幅头部与操作栏位于列表的 `header` 槽位（`ui-kit-desktop` 的 `List`），随内容一同滚出视口。当头部的大播放按钮逼近时，`StickyDetailBar` 从视口顶部滑入，留下标题 + 播放按钮 + 表头。滚过之后**表头固定在粘性栏正下方** —— 通过 `List` 的 `stickyHeader` 槽位实现，因为作为滚动容器的直接子节点，它是 `position: sticky` 真正生效的唯一位置（嵌套在 header 内时它只是父元素的最后一个子节点，永远无法吸顶）。本地音乐的专辑（albums）标签页不经虚拟化，用页面自己的滚动容器复刻了完全相同的结构。
- **粘性栏契约**：该栏作为 `List` 的 `sticky` 槽位传入 —— 必须是**滚动容器的直接子节点**（`position: sticky` 只在其父容器边界盒内生效；嵌套进 header 的话，它会在刚刚滑到位时随 header 一起被滚走）。联动编排**靠测量，而非假设**（`useDetailBarCollapse`）：每次滚动事件都读取锚点（大播放按钮）到滚动视口顶部的距离；粘性栏在按钮接近的最后一程滑入，并在**其边缘盖住按钮高度一半的瞬间停靠** —— 此刻栏上自己的紧凑播放按钮缩放进入（吸收动作），标题完成淡入，表头以实底背景固定在栏正下方，曲目行从其下滑过。`pointer-events` 跟随滑动过程，因此粘性栏的"幽灵态"绝不会吃掉本该落在巨幅头部上的点击。
- **表头悬停**：默认状态下表头**完全不显示排序箭头**。悬停时显现发丝级列分隔线（`boxShadow` 内阴影，因此无布局位移）、点亮排序列的方向箭头，并在其余每个非当前排序列上显示暗淡的排序提示。
- **共享的详情页原语**：四个页面是组装，而非复制。`ui-kit-desktop` 拥有 `DetailTableHeader`（吸顶排序表头，列即配置 —— 宽度/flex/对齐/图标/纯文本/可见性）、`DetailPlayButton`（圆形主播放按钮）与 `DetailHero`（眉题 / 两行截断标题 / 副标题 / 元数据槽 / 封面槽）；`ui-menus` 拥有 `sortMenuItems`（排序下拉的条目，带勾选标记、分割线、升序/降序）；`plugin-library-ui-desktop` 拥有 `LibraryTrackRow`（本地/收藏/歌单共用的曲目行，各页差异以 props 传入：专辑链接、添加日期列、移除按钮）。新的详情页应当组装这些原语，而不是重新推导。
- **长标题截断**：专辑/歌单巨幅标题两行截断（`-webkit-line-clamp`），绝不破坏布局。

### 9.2 曲目表格排序与行交互
- **可交互表头列与来源列排序**：
  - 点击列头（`#`、`标题`、`艺人`、`专辑`、`来源`、`添加日期`、带 Tabler `clock` 图标的 `时长`、`播放量`）在升序（`asc`）与降序（`desc`）间切换。
  - 当前排序列显示细微的方向箭头指示器（升序 `chevron-up`，降序 `chevron-down`）。
  - `AlbumScreen`、`FavoritesScreen` 与 `PlaylistDetailScreen` 提供可交互的"来源"列（`LocalMusicScreen` 全部为本地曲目，故省略）。
  - 来源名经 `resolveTrackSourceName(ctx, trackUrn)` 解析（位于 `@BBeBee/toolkit/hooks`；本地/文件路径返回 `'本地'`，或提供方显示名如 `'哔哩哔哩'`）。排序使用 `localeCompare(..., { numeric: true, sensitivity: 'base' })`。
  - 列头省略旧版勾选标记，呈现干净的列名与 Tabler `clock` 图标。
- **批量操作模式与工具栏（`BatchActionBar`）**：
  - 四个详情页的三点操作菜单均提供直连的"批量操作"入口（`id: 'batch-operations'`，图标 `list-check`），无嵌套子菜单。
  - 切换进入批量模式并挂载 `BatchActionBar`：
    - 原生 `<input type="checkbox">` 实现的"全选"，与曲目行复选框一致，支持 `indeterminate`（部分选中）与 `checked` 状态；
    - "批量播放"（`batch-play`）：按当前视觉顺序播放选中曲目；
    - "添加到歌单"（`batch-add`）：把选中曲目批量加入歌单，歌单曲目数按所选数量精确递增（`delta = active.tracks.length`）；
    - "删除" / "从最喜欢中删除"（`batch-delete`）：并发移除或取消喜欢选中曲目；
    - "退出批量操作"（`exit-batch`）：取消选择，恢复常规单曲模式。
  - 批量模式期间，三点菜单将所有批量操作直接平铺，不再有子菜单。
- **操作栏排序下拉（`ContextMenu`）**：
  - 专属排序下拉按钮（如 `默认顺序` / `自定义顺序` / `标题`，伴随 Tabler `arrows-sort` 或 `list` 图标）。
  - 点击展开结构化 `ContextMenu`，含排序键选项（包括"来源"）与升/降序切换选项。
- **排序菜单中的视图模式分区（`viewModeMenuItems`）**：
  - 排序菜单以"视图模式"分区收尾：一条发丝级分割线闭合排序选项，随后是贴左的 `heading`"视图模式"标签，每个模式一个条目，当前激活者带勾选图标。
  - 专辑 / 歌单 / 最喜欢 / 本地歌曲提供 紧凑（compact）与 列表（list）；本地专辑标签页额外提供 平铺（tiled，卡片网格）。
  - 紧凑 去掉封面并将艺人提升为独立列（含表头）；列表 与历史行一致。
  - 该选择按页面持久化在 `localStorage`（经 `ui-kit-desktop` 的 `useViewMode` 写入 `bbebee_view_mode:<key>`）。
- **统一的行内曲库操作按钮（`TrackLibraryActionButton`）与 Popover**：
  - 替换 `LocalMusicScreen`、`PlaylistDetailScreen`、`FavoritesScreen` 与 `CollectionScreen` 曲目行中以往的静态勾选或红心图标。
  - 默认隐藏；行悬停时平滑淡入（`opacity: 1`）。
  - **未入库**：显示 `plus` 图标（`tablerIcon('plus')`），点击直接把曲目加入最喜欢 —— **双写两个存储**：先 `sources.setLoved(track.urn, true)`，后 `library.setSaved(track.urn, true)`（双写不变量见 [rules/ui.md §7](../../rules/ui.md#7-detail-screens-sorting--playback-history-specifications)（L2））。
  - **已入库 / 最喜欢 / 歌单 / 合集**：显示 `heart-filled`（经 `tablerIcon('heart-filled')` 的绿心），点击打开专属的 Spotify 式 `SaveToPlaylistPopover`，而非原始右键菜单：
    - 对既有歌单的实时搜索过滤；
    - 点击"新建歌单"无缝地把顶部"查找歌单"搜索框切换为带自动聚焦的内联创建输入框、"确定"确认按钮与取消按钮，同时列表中的"新建歌单"行自动隐藏，避免重复操作；
    - "确定"按钮强制 `flexShrink: 0`、`whiteSpace: 'nowrap'`、`minWidth: 44`，输入框强制 `minWidth: 0`，确保按钮文字在 Flexbox 容器中绝不被挤压或截断；
    - "已点赞的歌曲"分组，带即时喜欢切换；
    - 歌单行带复选框切换，文件夹行展开嵌套子歌单；
    - 视口边界检测，水平/垂直自动翻转与钳制；
    - 高挑而沉稳的存在感：最小高度 480px（文件夹弹层 320px），以视口为上限 —— 收缩到只剩三行的菜单看起来像坏了。
  - **入库状态是实时的，绝非快照**：行的 `inLibrary` 取自 `useTrackLibraryInfo.isTrackInLibrary` —— 实时的已保存集合（`useSaved(ctx, 'track')`，随 `library/changed` 重载），行上可能过期的 `track.loved` 只用于填补实时数据尚未回答的部分；该 hook 在每次 `library/changed` 事件时从曲库重读变更 URN 的喜欢标记。硬编码 `inLibrary: true`（某行在歌单里不代表它被喜欢）或信任挂载时的快照，正是"取消喜欢了却仍画着红心"这类 bug 的成因。

### 9.3 专辑页定制（`AlbumScreen`）
- 头部操作栏红心切换：接线到 `library.isSaved(album.urn)` / `library.setSaved(album.urn, isSaved)`，即时响应，把已保存专辑同步到曲库的专辑标签页。
- 本地专辑安全：检测 `urn.startsWith('BBeBee:local:')`，在头部与行条目中省略下载按钮，并移除下载菜单项。
- 三点菜单："加入合集"更名为"加入文件夹"，"添加至最喜欢的音乐"更新为"添加到音乐库/从音乐库中删除"，移除冗余的"加入歌单"与"转至专辑"条目。

### 9.4 最喜欢页面对齐（`FavoritesScreen`）
- 与 `LocalMusicScreen` 对齐：头部区域的已喜欢歌曲紫色渐变（经 `headerGradient` 应用的 `#450af5`，其下为纯色）、无封面的文字巨幅头部（"已点赞的歌曲"）、带 56px 播放按钮（`play-filled`）的操作栏、随机播放（`shuffle`）、搜索输入框与排序下拉（`arrows-sort`）。
- 行渲染为 `FavoriteTrackTableRow`：序号/悬停播放、40px 封面、标题/艺人、专辑、悬停 `TrackLibraryActionButton`（`heart-filled` / `heart` 子菜单）、悬停 `dots` 更多按钮与时长。

### 9.5 本地音乐双视图与分页（`LocalMusicScreen`）
- **全量加载（无 100 条上限）**：使用 `fetchAllLocalTracks` 与 `fetchAllLocalAlbums` 以 500 条为批次递归分页，直至取回全部已扫描文件，突破默认 100 条的页边界。
- **视图切换**：头部分段切换器在"歌曲"（曲目表格）与"专辑"（专辑网格）之间切换。
- **本地专辑网格（`LocalAlbumCard`）**：
  - 按专辑名聚合本地曲目，封面取自第一首带封面的曲目。
  - 卡片展示专辑封面、标题、艺人与曲目数。
  - 悬停显现绿色播放按钮（`play-filled`），即刻播放该专辑曲目。
  - 点击卡片直接导航到专辑视图（`album.view`）。
- **专辑网格排序**：专辑视图激活时，操作栏排序菜单动态适配，提供专辑专属排序键：默认顺序、专辑标题、艺人、发行年份、曲目数。

### 9.6 播放历史与最近播放（`HistoryScreen` 与 `QueueScreen`）
- **按 `trackUrn` 严格去重**：桌面与移动端的 `HistoryScreen` 以及桌面 `QueueScreen` 的"最近播放"标签页都按 `trackUrn` 对播放条目去重，仅保留最近一次播放记录。保留最新播放时间戳、相对时间展示与完成/跳过徽标。headless 批量元数据加载（`useTracksByUrn`）只解析去重后的 URN 列表，避免冗余的曲库查询。
- **播放次数指示**：`HistoryScreen` 在整个历史数据集中计算每首曲目的累计播放频次，并在行元数据区展示胶囊徽标（`播放 N 次`）。
- **头部计数与空状态一致**：头部记录计数（`最近播放记录 (${uniqueRecords.length} 首)`）与空状态守卫均针对去重后的记录求值。

### 9.7 推荐界面与弯角书架轮播（`RecommendScreen` 与 `RecommendShelfRow`）
- **推荐书架层级**：
  - `RecommendScreen` 在三方音源之前渲染两个动态个人书架：
    1. **"最近播放 · 专辑"**（`useRecentPlayedAlbums`）：从 `ctx.player.getHistory()` 解析最近 20 首不重复曲目所属的专辑，按曲目 URN 去重为唯一专辑，响应式订阅 `player/history-changed`。
    2. **"收藏随选 · 专辑"**（`useFavoriteAlbums`）：从用户已保存的喜欢曲目（`ctx.library.listSaved('track')`）中随机选取 20 张专辑，挂载时动态洗牌，并随 `library/changed` 响应式更新。
    3. **三方音源书架**（`RecommendShelf`）：每个实现了 `recommend` 能力的注册音源各一个书架，带导航至 `RecommendAllScreen` 的"显示全部"操作按钮。
- **弯角书架轮播物理效果（`RecommendShelfRow`）**：
  - **3D 弯曲边缘**：只有当前可见的最左与最右卡片在其外边缘向内弯曲（`perspective(600px) rotateY(±22deg)`），以 `transformOrigin: right center / left center` 锚定，使其内边缘与相邻平整卡片保持齐平。
  - **圆柱阴影错觉**：每张弯曲边缘卡片叠加定向阴影层（`linear-gradient(to right/left, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.24) 38%, rgba(0,0,0,0) 70%)`），使后退的外边缘变暗并向内平滑过渡到透明。
  - **动态边界取消**：行滚动到开头（`leftEdgeIdx === 0`）时，左侧弯曲效果与左滚动箭头完全禁用；滚动到末尾（`rightEdgeIdx >= entries.length - 1`）时，右侧弯曲效果与右滚动箭头完全禁用。平整卡片经 CSS `transition: transform 0.28s ease` 无缝恢复为未弯曲变换。
  - **悬停导航箭头**：磨砂玻璃圆形按钮（❮ / ❯，40×40px，字号 22px，`backdropFilter: blur(12px)`）悬浮于左右边缘之上，悬停时平滑淡入（`opacity: 1`，过渡 `0.18s ease`），鼠标离开时淡出。
  - **垂直滚动拦截预防**：书架滚动容器强制 `overflowX: 'auto'` 与 `overflowY: 'hidden'`，确保鼠标滚轮或触控板的垂直手势干净地透传到页面垂直滚动，而不会被卡在书架行内。

---

## 10. 迷你播放器与灵动岛

零冗余操作按钮、`bbebee-file://` 封面边界与次级窗口动作的 Cordis 注入不变量规范见 [rules/ui.md §8](../../rules/ui.md#8-mini-player--dynamic-island-desktop-specifications)（L2）。

### 10.1 多状态窗口模型
- **悬浮迷你播放器（`normal`）**：380×96px 悬浮药丸。提供专辑封面、曲目名、艺人、进度滑块与播放控制。主体可拖拽（`-webkit-app-region: drag`），控件可交互（`-webkit-app-region: no-drag`）。包含恢复主窗口（`⤢`）与关闭（`✕`）。
- **灵动岛胶囊（`attached`）**：280×50px 药丸，与活动显示器顶部中央齐平停靠。显示曲目名、艺人与实时均衡器波形条（`IslandWaveBars`）。单击或向下拖拽展开；双击折叠。
- **展开灵动岛（`expanded`）**：420×184px 卡片，停靠在顶部。显示大封面、跑马灯文字、动画波形条、时间轴滑块与播放控制。双击背景折叠回胶囊；向下拖拽超过阈值（>60px）脱离为悬浮模式。
- **手势过渡**：把悬浮播放器拖到顶边附近（≤40px）自动吸附为灵动岛；把灵动岛向下拖（>60px）脱离为悬浮播放器；单击胶囊展开为卡片；双击背景折叠回胶囊。

### 10.2 阴影与边框亮度规范
- **透明窗口光晕预防**：透明次级窗口绝不使用大模糊半径（>30px）或 `0 0 0 1px` 白色外圈，它们会造成夸张的模糊光晕。
- **清晰的多层黑色阴影**：
  - 悬浮播放器：`0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)`（悬停：`0 10px 24px rgba(0, 0, 0, 0.55)`）。
  - 灵动岛胶囊：`0 4px 12px rgba(0, 0, 0, 0.45)`。
  - 展开灵动岛：`0 12px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)`。
- **低调玻璃边框**：边框必须使用低不透明度白色描边（`1px solid rgba(255, 255, 255, 0.08)`），与 `rgba(18, 18, 18, 0.85)` 深色玻璃及 `backdrop-filter: blur(24px)` 无缝融合。

---

## 11. 播放页布局样式

iframe 沙箱、数据/动作白名单与注入式 SDK 是规范性的安全约束，见 [rules/ui.md §9.2](../../rules/ui.md#92-sandboxed-external-plugin-dynamic-import-option-b)（L2）；音量浮层的 portal 模式见 rules/ui.md §9.5。

### 11.1 内置布局样式
应用提供 5 种由 `ctx.nowPlaying` 管理的内置布局样式：
1. **`classic`**（默认）：居中封面，歌名与艺人居下，播放控制在底部，右侧为可折叠歌词面板。
2. **`cinematic`**（16:9 映画歌词）：
   - 16:9 居中舞台（`aspectRatio: '16 / 9'`），最大宽度 1240px。
   - 中性深色底（`#0D1118`）配大幅封面背景（`opacity: 0.34`、`blur: 3.5px`、`scale 2`、居中），显露出封面剪影 —— 电影胶片氛围。
   - 左侧区（约 46% 宽）：方形专辑封面（最大 460px），带清晰的白色边框（`2px solid rgba(255, 255, 255, 0.9)`）、锐利直角（`borderRadius: 2`）与醒目的右下双层阴影（`12px 16px 5px` + `20px 28px 56px`）。
   - 右侧区：手写体标题（`Caveat` → `Segoe Print` → `cursive`，46px，对齐不超过封面顶部）、弱化的艺人、电影字幕式的同步歌词，随后是设置驱动的音频可视化（共享的 `visualizer.canvas` 视图 —— 渲染在设置中选择的样式与配色主题）+ 进度条 + 带文字阴影的更大手写斜体时间戳，对齐不低于封面底部。
   - 歌词列表（共享的 `CinematicLyricsTemplate`，由 `ui-kit-desktop` 拥有，播放页 cinematic 布局与歌词面板消费同一组件）在同步与纯文本两种模式下都隐藏滚动条滚动（经注入规则使用 `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）—— 列表即舞台，而非文档；自动跟随在滚轮/触摸时暂停，并提供"回到当前歌词"药丸按钮。
   - 可视化组件嵌在进度条宽度之内；其 `wave` 样式即 cinematic 有机波形（层叠锥形正弦频带、两端渐隐的渐变描边、柔和辉光、振幅随实时音频抬升）。
   - **屏上没有播放控制按钮，也没有样式切换按钮** —— 纯电影式沉浸；左上返回与右上窗口控制在鼠标离开顶栏时自动隐藏。
3. **`full-cover`**：全屏模糊封面背景、玻璃拟态浮层、悬浮半透明播放控制。
4. **`vinyl`**：圆形旋转黑胶唱片动画，带同心纹路光泽与中心专辑标签。
5. **`compact`**：并排宽屏布局，左侧大封面，右侧纵向的元数据/控制/歌词流。

### 11.2 设置界面集成（`NowPlayingStylesSection`）
- 挂载在"播放与音频（`PlaybackSection`）"设置标签页顶部。
- **样式卡片网格**：展示每种样式的名称、描述、Tabler 图标、作者/版本，以及"官方内置"与"沙箱 🛡️"徽标。
- 点击任意卡片立即切换激活样式，并持久化到 `settings.nowPlayingStyle` 与 `ctx.store`。
- 沙箱插件提供删除按钮；删除激活中的插件会自动回退到 `'classic'`。
- **导入插件弹窗（`Sheet`）**：
  - 展示沙箱安全保证与数据边界。
  - "载入示例模板"按钮提供即时可用的霓虹玻璃拟态示例模板。
  - 支持直接粘贴 JSON 清单或上传本地 `.json` 文件。
  - 校验必填字段（`id`、`name`、`htmlContent`），并阻止与内置样式 ID 冲突。

### 11.3 曲目播放信息弹窗与元数据检视（`TrackInfoModal`）
- **右键菜单（"查看播放内容"）**：
  - 播放页表面挂接 `useTrackMenu(ctx, { onShowTrackInfo })`，提供带 `info-circle` 图标的 `track-info` 条目。
  - 打开 `TrackInfoModal`（`Sheet`），聚合技术规格与存储来源：
    - **本地曲目**：标题、艺人、专辑、存储分类（`本地音乐文件`）、文件名、绝对文件系统路径（一键复制到剪贴板 + 反馈）、格式化文件大小与最后修改时间戳。
    - **三方曲目**：`sourceId`（如 `bilibili`）、`sourceTrackId`（从曲目 URN 解析）。
    - **音频技术规格**：曲目时长、采样率（如 `44,100 Hz`）、声道（如 `2 (立体声 Stereo)`）、比特率（如 `920 kbps`）、编码（如 `FLAC`、`M4A`）、标签类型（如 `Vorbis, ID3v2.3`、`ID3v2` 或 `在线流媒体`）。
  - 读取来源：聚合是无头的 —— `@BBeBee/plugin-now-playing/hooks` 中的 `resolveTrackDetails` / `useTrackDetails` 读取 `ctx.db`（`media_bindings`、`scan_entries`）、`ctx.codec.readMetadata`、`ctx.fs.stat` 与实时 `ctx.player.currentStream`，逐级回退；弹窗只渲染返回的行。

### 11.4 自适应标题换行
- **两行标题换行**：在所有内置布局（`ClassicLayout`、`FullCoverLayout`、`VinylLayout`、`CinematicLayout`）中，曲目名自适应换行至多 2 行（`numberOfLines: 2` 或 `-webkit-line-clamp: 2`）。更长的标题在第 2 行末尾以省略号截断，防止水平溢出或与播放控制相撞。

---

## 12. 分享 UI 与卡片渲染

Canvas 对等架构约束（Canvas 导出物不得使用 DOM 树预览）规范见 [rules/ui.md §10.1](../../rules/ui.md#101-live-canvas-rendering-architecture-100-dual-engine-parity)（L2）。

### 12.1 实时 Canvas 预览
- `ShareCardPreview` 内嵌实时 `<canvas width={540} height={960} style={{ width: 252, height: 448 }} />`，直接经由 `drawTrackCard`、`drawPlaylistCard`、`drawAlbumCard` 与 `drawLyricsCard` 渲染。
- 弹窗预览与导出的 PNG 在数学上完全一致（2 倍 Retina 锐度）。

### 12.2 卡片几何与排版层级
- **不变形的居中裁剪封面（`drawImageCover`）**：
  - 封面图绝不拉伸或变形宽高比。`drawImageCover(ctx, img, x, y, w, h)` 依据源与目标宽高比执行居中裁剪的 object-fit cover。
- **自适应文本换行（`wrapText`）**：
  - 标题、艺人、作曲元数据与歌词行优雅换行至多 3 行（`maxLines = 3`）。
  - 文本超过第三行时追加省略号（`…`）。
  - 使用二分搜索，支持 CJK 与西方单词边界检测。
- **排版刻度**：
  - 卡片标题：`bold 26px`，行高 `34px`，锐利 `#FFFFFF`。
  - 艺人 / 副标题：`500 18px`，行高 `26px`，次要色 `#B3B9C9`。
  - 歌词：`bold 22px`，行高 `34px`，锐利 `#FFFFFF`。
- **垂直间距与 Logo 定位**：
  - BBeBee 品牌 Logo（宽 `110px`，高约 `24px`）紧贴艺人/副标题/歌词之下，间距紧凑（`10px`，`gapAboveLogo`）。
  - 底部内边距严格为 `18px`（`gapBelowLogo`）。
  - 卡片高度自适应包裹内容（`cardH = naturalCardH`），消除 Logo 下方的大片空白。

### 12.3 组件抽取与高内聚弹窗
分享弹窗（`ShareTrackModal`、`SharePlaylistModal`、`ShareAlbumModal`、`ShareLyricsModal`）被拆分为单一职责的可复用组件：
- `ShareModalHeader`：统一的弹窗头部栏，带关闭按钮。
- `BackgroundModeSelector`：紧凑切换胶囊，提供"纯主题色"（封面主题色）、"半高渐变"（50% 过渡到黑）与"纯黑底色"（黑）。
- `LocalSourceWarning`：红色警告横幅（`data-testid="local-source-warning"`），提示仅本地的曲目无法跨设备分享。
- `DisabledReasonToast`：信息性琥珀色 Toast（`data-testid="copy-disabled-reason-toast"`），解释点击禁用动作时为何无法继续。
- `ShareActionButtons`：封装"复制"（Base64）与"保存图片"（带 LSB 隐写的 PNG），处理复制状态、生成转圈与禁用态。
- `useShareModalState`：统一 hook，封装主题色提取（`useImageColor`）、封面解析（`useResolvedArtwork`）、本地来源检查（`isLocalSource`）、剪贴板复制回退与 Toast 计时器。

### 12.4 歌词分享卡片尺寸（完整海报与仅内部卡片）
- **范围切换**：`ShareLyricsModal` 提供分段范围选择器：**整张海报（大图）**（`full`）与 **仅内部卡片（小图）**（`card`），由 `RenderLyricsCardOptions.cardOnly` 控制。

---

## 13. 音源徽标分页与原始资源

平台不变量 1（`openExternalUrl`，UI 包禁止导入平台 SDK）规范见 [rules/ui.md §11](../../rules/ui.md#11-third-party-source-badges-half-page-pagination--original-resources)（L2）。

### 13.1 详情页头部的音源徽标
- **视觉呈现**：当专辑或歌单来自三方音源（`isThirdParty`）时，头部巨幅节点在右上角挂载一个紧凑的灰框徽标（`top: 24, right: 32`）：
  - `album-source-badge` / `playlist-source-badge`
  - 样式：`border: '1px solid rgba(255, 255, 255, 0.2)'`、`borderRadius: 4`、`padding: '3px 8px'`、`color: '#A0A0A0'`，字号 12px。
- **本地来源豁免**：用户创建的本地歌单（`BBeBee:local:playlist:...`）不显示三方音源徽标，即使其中包含来自三方提供方的歌曲。

### 13.2 半页无限滚动分页
- **分块加载**：三方专辑与歌单避免一次性抓取全部曲目；请求使用 `PageRequest`，默认页大小 30。
- **半页触发线**：
  - `ListProps` 接受 `pageSize?: number`。
  - 提供该参数时，虚拟列表在当前最后一页的半程位置计算阈值索引：
    `thresholdIndex = Math.max(0, count - pageSize) + Math.floor((count - Math.max(0, count - pageSize)) / 2)`
  - 滚动监听器检查滚动偏移是否超过 `scrollMargin + thresholdIndex * estimateItemHeight`。
  - 只有真实用户滚动越过该半程标记才触发 `onEndReached`，且 `firedFor.current = count` 防止对同一数量重复触发。
  - 这消除了短列表完全落在视口内时初始挂载引发的无限抓取循环。

### 13.3 右键菜单"跳转原始资源"与安全外部导航
- **菜单注册**：曲目、专辑与歌单的右键/更多菜单注册 `open-original-resource`（"跳转原始资源"），图标 `external-link`（映射到 Tabler `share-box`）。
- **规范 URL 解析（`resolveOriginalResourceUrl`）**：
  - 自动从 URN、曲目元数据与原始 ID 中解析规范网页 URL，覆盖：
    - Bilibili：视频 BV 号（`https://www.bilibili.com/video/BV...`）、AV 号、番剧（`ss...`）、系列（`series...`）与用户合集/收藏夹（`ml...`）。
    - 网易云音乐：曲目 / 专辑 / 歌单网页 URL。
    - QQ 音乐：歌曲 / 专辑 / 歌单网页 URL。
    - YouTube：Watch / playlist URL。
    - 直链 HTTP/HTTPS 回退：`track.originalUrl` 或 `item.id` 中提供的任何有效网页 URL。

