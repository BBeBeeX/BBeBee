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

所有四个内置主题（`midnight-purple`、`spotify`、`crimson-night` 和 `ocean-abyss`）除了默认的深色美学外，均完整支持**浅色模式**：
- **禁止直接色彩反转**：严禁粗暴的反色处理。背景转换为柔和的米白/灰白调色板（`#FFFFFF`、`#F0F4FC`、`#FDF2F4`、`#F0F9FF`），而品牌强调色采用同一品牌光谱内的更深色相，以维持 WCAG AA 对比度（如 Spotify 绿 `#12833C`、电光蓝 `#3B66F5`、绯红 `#C9184A`、深海湛蓝 `#087E96`）。
- **WCAG AA 合规门禁**：自动化测试 `themeContrastIssues(theme, scheme)` 严格强制执行：
  - 正文 / 常规文本对比度 $\ge 4.5:1$
  - 大号文本与关键 UI 边框对比度 $\ge 3.0:1$
  - 在 CI 中针对 `dark` 和 `light` 两种配色方案全量测试。
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
- **动态用户主题**：用户可通过“设置”导入任意自定义 `.json` 主题文件。主题引擎动态验证并将缺失的令牌与 `midnightPurpleTheme.tokens` 进行深度合并，在运行时注册该主题，并持久化至 `ctx.store`。
- **内置主题受保护与安全删除**：内置主题不可删除（`removeTheme()` 返回 `false`）。自定义主题可通过“设置”删除；若当前激活的自定义主题被删除，引擎会立即自动回退至 `midnight-purple` 并发出 `theme/registry-changed` 事件。

### 6.3 表面层级与后退式纯黑底盘

纵深感通过**微妙的亮度阶梯与半透明图层**来传达，以绝对纯黑底盘作为锚定：

| 层级 | 取值 / 变量 | 角色与用法 |
|---|---|---|
| `chassis` | `#000000` / `var(--player-bg)` | 外壳框架、桌面端侧栏和常驻底部播放栏。纯黑且无顶边框（`borderTop: none`），消除视觉噪音并锚定视口。 |
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

> ⚠️ **关键 CSS 规则：针对主题令牌使用 `background:` 简写，绝不使用 `backgroundColor:`：**
> 许多主题变量（如 `--button-primary-bg`、`--playing-item-indicator` 和 `--gradient-brand`）解析为 CSS 线性渐变（`linear-gradient(...)`）。
> 在 CSS 规范中，`backgroundColor` 不接受渐变；浏览器渲染引擎将 `backgroundColor: linear-gradient(...)` 判定为无效并丢弃，导致元素完全透明！
> 在所有按钮、卡片和指示器组件中，**必须始终书写 `background: var(--button-primary-bg, ...)`**。

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
  - 隐藏轨道背景（`background: transparent`），防止灰色凹槽条破坏深色画布的连续性。
  - 极窄宽度（桌面端为 `4px` 宽）。
  - **面板滑块仅在光标处于该面板上方或该面板自身正在滚动时可见。** `main.tsx` 在滚动容器上维护两个朴素类名：`is-scrollbar-hover`（从 `mouseover` 获取的悬停元素最深滚动祖先）与 `is-scrolling`（在面板最后一次滚动事件后 1.2 秒自动清除）。其他每个面板的滚动条保持完全透明，因此滚动页面 A 绝不会点亮侧边栏、播放队列或其他页面的滚动条。
  - ⚠️ **Chromium 陷阱，切勿重蹈覆辙**：`*:hover::-webkit-scrollbar-thumb` 无法正常工作 —— Chromium 在计算滚动条部件样式时不包含宿主元素的 `:hover` 状态，这会导致在*每个*面板上始终绘制“悬停”变体（且全局 `html.is-scrolling` 标记会在任何滚动期间点亮每个滚动条）。只有滚动容器上的朴素类名才能正确融入层叠样式；同理，标准的 `scrollbar-width`/`scrollbar-color` 会完全禁用 `::-webkit-scrollbar` 规则。
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
  - **常驻底部播放栏（下沉 `#000000` / `#181818`）**：横跨整个窗口宽度。
    左侧：当前曲目封面缩略图、曲目标题（`#FFFFFF`）与艺人副标题（`#B3B3B3`）—— 两者在空间压缩时均跑马灯滚动（`MarqueeText`）而非简单截断 —— 以及保存按钮。
    中间：播放控制（前一首左侧的当前播放模式按钮、前一首、超大圆形播放/暂停按钮、后一首、后一首右侧的声音状态图标，带有静音 'x' / 音量波纹档位，点击可切换带有底部静音开关的垂直音量滑块浮层）与时间进度条，在显示 `缓冲中…` 时宽度保持恒定（固定的 64px 槽位承载该标签）。
    右侧：功能切换（桌面歌词开关、播放队列、输出设备选择器）。
- **移动端外壳**：
  - 干净的全出血深色视图，带有底部导航标签栏（音乐库、搜索）和作用域限定的曲库过滤（`全部` / `本地` / `最喜欢`）。
  - 停靠在标签栏正上方的常驻迷你播放器，展示封面缩略图、跑马灯标题、艺人名称、播放/暂停切换以及发丝级播放进度条。
  - 全屏播放面板：展开迷你播放器会向上滑出沉浸式播放器，展示大方形封面、加粗几何排版、进度滑块、圆形传输控件以及上滑式歌词面板。

### 6.9 图标系统与线条粗细规范（Tabler Icons，stroke = 1.25）

桌面端 UI 中的所有图标统一基于 **Tabler Icons SVG 路径**，采用统一的线条粗细：
- **全局描边粗细**：标准化为 `stroke="1.25"`（`packages/ui/ui-kit-desktop/src/icons/tabler.ts` 中的 `DEFAULT_STROKE_WIDTH = 1.25`）。1.25 描边在深色背景上提供清晰、高精度的几何形态，在小字号下不会产生视觉沉重感或模糊。
- **禁止裸 Unicode / 手写 SVG**：UI 组件绝不能直接渲染裸 Unicode 字符或自定义 `<svg>` 定义。所有图标均通过 `tablerIcon(name, props)`、`TablerIcon` 或接收 `IconName` 的组件（如 `IconButton`、`EmptyState`）渲染。
- **标准尺寸与默认大小**：默认图标大小为 `28px`（`packages/ui/ui-kit-desktop/src/icons/tabler.ts` 中的 `DEFAULT_ICON_SIZE = 28`）。尺寸刻度：
  - `sm`: 16–20px（表格行操作、列头、元数据徽标）
  - `md`: 22–24px（侧边栏导航、操作栏、滑块手柄、标准按钮，`tokens.size.icon = 24`）
  - `lg`: 28–32px（播放控制、弹窗头部，`tokens.size.iconLarge = 32`）
  - `xl`: 36–52px（巨幅播放按钮、空状态）
- **集中注册表**：`packages/ui/ui-kit-desktop/src/icons/registry.ts` 提供别名映射直观名称（`play`、`pause`、`previous`、`next`、`volume-mute`、`favorite`、`favorite-filled`、`filter`、`close`、`add`、`more`、`folder` 等）到官方 Tabler 图标定义。
- **无障碍与测试友好**：SVG 元素输出 `aria-hidden="true"` 和 `data-icon="{name}"`。测试套件查询 `[data-icon="..."]` 或 `data-testid`，而非针对文本节点值断言。

**组件对等是一项契约。** 两个套件导出相同的组件名称与相同的 props —— `Button`、`IconButton`、`TrackRow`、`Slider`、`Sheet`/`Dialog`、`List`、`EmptyState`、`Toast`、`TextField`、`Text`、`Artwork`、`JsonTree`。编写两个视图包的插件作者应该是在转录代码，而不是重新设计。CI 中的对等测试会对两个套件导出的名称和 prop 类型进行 diff 对比，出现分歧则构建失败，因为若非如此，套件会悄无声息地发生偏移，代价由每位插件作者承担。

