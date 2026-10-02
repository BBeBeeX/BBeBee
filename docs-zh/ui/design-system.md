# 视觉设计语言、设计令牌与排版系统

> **历史章节映射：** 原 `docs-zh/08-ui-architecture.md §6`。

## 6. 视觉设计语言与设计令牌

视觉设计是一种**沉浸式、深色优先的流媒体美学**，旨在把封面图、高密度的目录列表与高活力的播放状态置于用户体验的中心。浅色主题作为一种可访问的反转配色存在，但深色是塑造整个产品的表面层次与交互模型的主模式。

令牌是**数据，不是组件** —— 这是让两个视图层在不共享组件代码的前提下看起来像一个产品的唯一办法。

```ts
// @BBeBee/ui-tokens — plain values, no framework
export interface Palette {
  bg: { sunken: string; base: string; raised: string; overlay: string }
  text: { primary: string; secondary: string; disabled: string }
  accent: { base: string; hover: string; muted: string; on: string }
  state: { error: string; warn: string; ok: string }
  border: { subtle: string; strong: string }
}

export const dark: Palette = {
  bg: { sunken: '#000000', base: '#121212', raised: '#181818', overlay: '#282828' },
  text: { primary: '#FFFFFF', secondary: '#B3B3B3', disabled: '#6A6A6A' },
  accent: { base: '#1DB954', hover: '#1ED760', muted: '#1B3D2B', on: '#000000' },
  state: { error: '#F15E6C', warn: '#FFA42B', ok: '#1ED760' },
  border: { subtle: '#282828', strong: '#7A7A7A' },
}

export const light: Palette = {
  bg: { sunken: '#F1F1F1', base: '#FFFFFF', raised: '#F6F6F6', overlay: '#EDEDED' },
  text: { primary: '#000000', secondary: '#5E5E5E', disabled: '#8C8C8C' },
  accent: { base: '#12833C', hover: '#0D6E36', muted: '#D7F2E2', on: '#FFFFFF' },
  state: { error: '#C1291F', warn: '#8A5A00', ok: '#0E7A3D' },
  border: { subtle: '#E5E5E5', strong: '#767676' },
}

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
  size: { touchTarget: 44, icon: 20, iconLarge: 28, row: 56, artworkThumb: 48 } as const,
} as const
```

`ui-kit-mobile` 把它们作为 `StyleSheet` 值消费；`ui-kit-desktop` 把它们输出为 CSS 自定义属性（`cssVariables(scheme)`）。

### 6.1 表面层级与无边框的层级感

深度通过**近黑色表面的微妙亮度阶梯**来传达，而不是厚重的边框或投影。硬朗的轮廓在高密度目录视图中制造视觉杂讯；微妙的对比阶梯让表面彼此区分，同时让封面图更突出。

| 层 | 取值（深色） | 角色与用法 |
|---|---|---|
| `bg.sunken` | `#000000` | 外部底盘与常驻导轨：桌面端窗口骨架、侧边栏/导航栏，以及底部传输播放条。后退感，让内容凸显。 |
| `bg.base` | `#121212` | 主滚动画布：播放列表、专辑视图、搜索结果、曲库网格。 |
| `bg.raised` | `#181818` | 抬升的媒体卡片（专辑/播放列表磁贴）与分区面板。 |
| `bg.overlay` | `#282828` | 悬停的行/卡片、下拉菜单、右键菜单、工具提示，以及模态面板。 |
| `border.subtle` | `#282828` | 主要面板之间的发丝级分隔线（如侧边栏边框、底栏边框）。 |
| `border.strong` | `#7A7A7A` | 聚焦的可交互边界与可访问轮廓（满足 WCAG 1.4.11 的 3:1）。 |

### 6.2 标志性强调色与高对比规则

- **标志性强调色是鲜活的绿色（`#1DB954`，悬停 `#1ED760`）。** 它传达动作、活力与正在播放：播放按钮、活动行标题、进度条填充，以及激活的开关。
- **`accent.on` 是 `#000000`（黑色）。** 在饱和的 `#1DB954` 上放浅色文字无法满足 WCAG AA（仅约 2.6:1）。绿底上的黑色文字与图标对比度超过 8:1。主圆形播放按钮与实心操作药丸始终把黑色字形放在绿色填充之上。
- **浅色模式把色相调整为 `#12833C`。** 饱和的 `#1DB954` 放在白底上无法通过对比度测试；更深的森林绿在保持品牌识别度的同时保持可读。
- **文字层级**：纯白（`#FFFFFF`，`text.primary`）承载标题与主要可交互标签。柔和的银灰（`#B3B3B3`，`text.secondary`）承载艺术家、专辑标题、曲目时长、列标题与次要计数。非活动控件使用低调的 `#6A6A6A`。

### 6.3 字体与字号刻度

字体栈优先选用几何怪诞体（geometric grotesque）字形：
`"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`。
字体从操作系统/系统本地解析，而不是下载，避免外来网络字体的授权问题与 CSP 网络开销。

刻度遵循**"字重随字号"**：
- **Display（`40px`，字重 `900` heavy，行高 `1.2`）**：播放列表与专辑详情页上的巨型主标题。
- **XL（`28px`，字重 `900` heavy，行高 `1.2`）**：主要分区标题（"为你推荐"、"最近播放"）。
- **LG（`20px`，字重 `700` bold）**：分区标题、货架（shelf）标题、对话框标题。
- **MD（`15px`，标题用 `700` bold，正文用 `400` regular）**：曲目标题、主菜单标签。
- **SM（`13px`，字重 `400` regular）**：艺术家名、专辑副标题链接、时长时间戳。
- **XS（`11px`，字重 `500` medium / `700` bold，全大写）**：列标签（`TITLE`、`ALBUM`、`DATE ADDED`）、分类标签与时长徽标。

### 6.4 组件可供性与微交互

- **药丸按钮（`radius.pill: 999`）**：可交互控件（主操作按钮、分类筛选 chip、标签开关）均为药丸形。在面板皆为矩形的无边框深色 UI 中，全圆角形状立即传达出"可按压"。
- **悬停微缩放**：主药丸按钮在指针下轻微放大（`transform: scale(1.04)`，历时 `120ms`），而不仅是变色，在近黑背景上提供即时的、可触知的物理反馈。
- **媒体卡片与悬浮播放揭晓**：矩形卡片（`radius.md: 8px`，`bg.raised: #181818`）顶部是方形封面（`radius.sm: 4px`），随后是粗体标题与艺术家副标题。指针悬停时：
  1. 卡片背景从 `#181818` 提亮到 `#282828`。
  2. 一枚鲜绿的圆形播放按钮（直径 `48px`，`#1DB954` 填充，`#000000` 播放字形）从封面右下角缓缓升起，带轻微的 translateY 与透明度过渡（`120ms`）以及淡淡的投影。
  3. 点击播放按钮立即开始播放该容器的内容，无需跳转导航。
- **曲目行（`TrackRow`，高 `56px`）**：
  - 显示序号、封面缩略图（`48px` 方形，`radius.sm: 4px`）、`#FFFFFF` 的曲目标题、`#B3B3B3` 的艺术家、专辑名与时长。
  - 悬停时，该行被照亮（`#282828`），曲目序号被替换为播放图标（`▶`），快捷操作（经由 `onToggleLoved` 的红心/喜爱切换按钮 `♥`/`♡`、右键菜单 `···`）变为可见。
  - 正在播放时，曲目标题、曲目序号与均衡器图标以标志性绿色（`#1DB954`）点亮。
- **进度条与滑块（`Slider`）**：
  - 水平条（高 `4px`），背景轨道为低调的灰色。
  - 已播放进度在静态展示时呈 `#FFFFFF`，在指针悬停或拖动时以标志性绿色（`#1DB954`）点亮，并伴随一个圆形滑块把手。

### 6.5 动态主视觉渐变与封面呈现

- **方形封面（`radius.sm: 4px`）**：曲目、专辑与播放列表使用方形比例。艺术家使用圆形头像（`radius.pill`）。
- **零布局跳动加载**：封面容器在全分辨率图片懒加载期间立即以 `blurhash` 字符串作为背景展示，并以 `artworks.dominant_color` 兜底。
- **动态氛围主视觉横幅**：播放列表与专辑视图的头部区域从封面提取 `artworks.dominant_color`，生成一道浓郁的水平渐变，从顶部横幅向外辐射，并平滑地向下渗入 `#121212` 基底画布。

### 6.6 外壳结构与布局范式

- **桌面端外壳**：
  - **左侧导航栏 / 侧边栏（下沉的 `#000000`）**：常驻导航快捷入口（首页、搜索、你的曲库）与可滚动的播放列表列表。
  - **顶部栏（下沉的 `#000000` / `#121212`）**：横贯窗口标题区。左侧：品牌 Logo（即 Home）与历史前进/后退按钮（原 ⋯ 更多菜单已移除）。中间：搜索输入框，带动态图标位移、窗口过窄时收起为单个放大镜按钮（点击展开后托盘与头像图标让位、窗口控件常驻；点击其他区域、`Escape` 或提交搜索即还原）以及 2×2 矩阵下拉面板。右侧：插件托盘、直接跳转设置中心（`settings.view`）的用户头像（设置页同时经路由的 `'tray'` placement 出现在托盘中），以及**永不隐藏**的最小化/最大化/关闭窗口控件。
  - **居中的主内容卡片（`#121212`，圆角）**：可滚动画布，承载动态渐变主视觉头部、操作栏（大号绿色圆形播放按钮、红心/收藏、`···`），以及虚拟化的曲目列表或媒体卡片网格。曲库视图通过顶层范围（`All`、`Local`、`Favorites`）与内容视图（`Tracks`、`Albums`）组织条目。
  - **常驻底部播放条（下沉的 `#000000` / `#181818`）**：横贯整个窗口宽度。左侧：当前曲目封面缩略图、曲目标题（`#FFFFFF`）与艺术家副标题（`#B3B3B3`）——被压缩时以走马灯（`MarqueeText`）来回滚动而不是省略号截断——以及收藏按钮。中间：传输控制按钮（上一曲左侧显示当前播放模式图标，点击可循环切换顺序播放/单曲循环/列表循环/随机播放；超大的圆形播放/暂停按钮；下一曲右侧显示声音状态图标，静音时显示带 x 喇叭，非静音时根据音量高低展示不同波纹大小，点击弹出竖向音量调节栏且底部提供静音/恢复切换图标）与时间进度条，进度条宽度在 `Buffering…` 提示出现时保持不变（标签居于固定 64px 槽位）。右侧：功能开关（桌面歌词切换、队列、设备选择等）。
  - **全局滚动条**：4px 超窄滑块、透明轨道。只有**指针所在的容器**（`is-scrollbar-hover`，由 `main.tsx` 从 `mouseover` 维护）或**正在滚动的容器**（`is-scrolling`，滚动停止 1.2 秒后自动移除）显示滑块，其他容器一律隐藏——滚动 A 页面时侧栏、队列等任何其他面板的滚动条都不会亮起。⚠️ Chromium 陷阱：`*:hover::-webkit-scrollbar-thumb` 不会生效——Chromium 计算滚动条部件样式时不含所属元素的 `:hover` 状态，"悬浮"变体会同时画在所有面板上；同理也不要用全局 `html.is-scrolling` 之类的开关。只有滚动容器上的普通类能进入级联。
- **移动端外壳**：
  - 干净的全出血（full-bleed）深色视图，带底部导航标签栏与按范围过滤的曲库（`All` / `Local` / `Favorites`）。
  - 常驻迷你播放器紧贴标签栏之上停靠，显示封面缩略图、跑马灯标题、艺术家名、播放/暂停开关，以及一条发丝级播放进度条。
  - 全屏正在播放面板：展开迷你播放器会向上滑出一个沉浸式播放器，包含大幅方形封面、粗犷的几何字体、进度条、圆形传输控件，以及上滑展开的歌词面板。

**组件对等是一份契约。** 两个组件库导出同名且同 props 的组件 —— `Button`、`IconButton`、`TrackRow`、`Slider`、`Sheet`/`Dialog`、`List`、`EmptyState`、`Toast`、`TextField`、`Text`、`Artwork`、`JsonTree`。同时编写两个视图包的插件作者应该是在"誊写"，而不是"重新设计"。CI 中有一个对等性测试，会对比两个组件库导出的名称与 props 类型，出现分歧即失败 —— 因为没有它，两个组件库会悄然漂移，而每个插件作者都要为此买单。

---

