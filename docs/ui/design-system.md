# Visual Design Language, Tokens & Typography

> **Legacy Reference:** Formerly `docs/08-ui-architecture.md §6`.

## 6. Multi-Theme Color System & Visual Identity

The visual design is an **immersive, character-inspired dark music player aesthetic** rooted in the brand visual identity. The system is architected as an extensible **Multi-Theme Color System** with runtime theme switching, token injection, and user-customizable color schemes.

Tokens are **plain data, not components** — maintaining 100% parity between desktop (CSS Custom Properties) and mobile (React Native `StyleSheet`) without duplicated styling code.

### 6.0 Theme System Architecture & Tokens Model

The color architecture is divided into three layers:
1. **Layer 1: Color Primitives** — Pure hex/rgba color constants extracted from brand references.
2. **Layer 2: Semantic Color Tokens (`ColorTokens`)** — Purpose-driven design tokens structured by category: `bg`, `surface`, `brand`, `gradient`, `text`, `border`, `semantic`, `music`, and `glow`.
3. **Layer 3: Component Mappings & CSS Custom Properties** — Flat CSS variables injected into the DOM by `themeToCssVariables()` and `applyThemeToDom()`.

```ts
// @BBeBee/protocol — ColorTokens and ThemeDefinition
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

### 6.0.2 Dual-Scheme Mode & Light Mode Architecture (WCAG AA Gate)

All four built-in themes (`midnight-purple`, `spotify`, `crimson-night`, and `ocean-abyss`) and the core design system palettes support **light mode** alongside their default dark mode aesthetics:

#### Surface Luminance Hierarchy
The design system establishes a strict four-layer surface hierarchy for both `dark` and `light` schemes via `@BBeBee/ui-tokens`:

| Layer | Dark Palette | Dark Luminance | Light Palette | Light Luminance | Role & Semantics |
|---|---|---|---|---|---|
| **`sunken`** | `#0A0A0E` | 0.007 | `#EAEBED` | 0.830 | Lowest anchor: outer window chassis, sidebar navigation rail, sunken input tracks |
| **`base`** | `#111218` | 0.009 | `#F7F7F8` | 0.931 | Main canvas: scrollable viewports, table views, feed screens (avoids stark `#FFFFFF` glare) |
| **`raised`** | `#181922` | 0.013 | `#FAFAFA` | 0.956 | Elevated content: media cards, batch action bars, floating utility shelves |
| **`overlay`** | `#20222D` | 0.019 | `#FFFFFF` | 1.000 | Topmost surface: modal dialogs, sheets, context menus, tooltips, popovers |

- **Luminance Inversion & Glare Prevention**: In dark mode, `sunken` is the darkest chassis layer and `overlay` is the brightest. In light mode, `sunken` remains the deepest/darkest anchor layer (`#EAEBED`), grounding the application structure, while `base` is specifically tuned to a warm, soft grey (`#F7F7F8`) instead of pure white to prevent eye strain during long listening sessions. `overlay` is pure white (`#FFFFFF`) to ensure modals and popovers cleanly elevate above the canvas.
- **No Direct Inversion:** Direct color inversion is forbidden. Backgrounds shift to soft off-white/grey palettes, while brand accent colors use deeper hues within the same brand spectrum to maintain WCAG AA contrast (e.g. Spotify green `#12833C`, Electric blue `#3B66F5`, Crimson `#C9184A`, Ocean abyss `#087E96`).
- **WCAG AA Compliance Gate:** Automated tests `paletteContrastIssues()` and `themeContrastIssues(theme, scheme)` enforce:
  - Normal text contrast $\ge 4.5:1$ (Light mode `text.primary` achieves **14.93:1** on `sunken` and **16.74:1** on `base`; `text.secondary` achieves **5.44:1** on `sunken` and **6.06:1** on `base`)
  - Large text & key UI borders contrast $\ge 3.0:1$
  - Tested across both `dark` and `light` schemes in CI parity suites.
- **Component Tokenization & Contrast Preservation Rule**:
  - UI views must never hardcode `#FFFFFF` or `#000000` for general component typography or icons. Use semantic CSS variables (`var(--bb-text-primary, #FFFFFF)`, `var(--bb-text-secondary, #8E8E93)`, `var(--bb-bg-overlay)`, `var(--bb-border-subtle)`, `currentColor`).
  - **Fixed Dark Container Exception**: Containers with fixed black backgrounds (e.g. Dynamic Island `#000000` / `#0A0A0F`, floating translucent HUDs, error/danger badges, or artwork overlays) must preserve light/white foregrounds or use on-color tokens (`var(--bb-accent-on, #FFFFFF)`, `var(--bb-state-error-on, #FFFFFF)`). Never convert text inside fixed black containers to `var(--bb-text-primary)` as it would become unreadable dark text on black in light mode.
- **Effective Scheme Resolution:** `settings.theme` supports `'dark' | 'light' | 'system'`. When `'system'` is chosen, `plugin-theme` resolves the scheme in real-time via `window.matchMedia('(prefers-color-scheme: dark)')` and listens to OS theme preference changes.
- **DOM Single-Writer Principle:** DOM theme attributes are strictly converged into a single writer (`applyThemeToDom()` in `ui-tokens` invoked by `plugin-theme`):
  - `data-theme="{theme.id}"` (e.g., `midnight-purple`, `spotify`)
  - `data-color-scheme="{effectiveScheme}"` (`dark` or `light`)
  - `target.style.colorScheme = effectiveScheme`
  - CSS custom properties (`--bg-app`, `--primary`, `--text-primary`, `--color-*`, etc.)

```ts
// @BBeBee/ui-tokens — Layout and typography tokens
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

### 6.1 Primary Visual Identity: Bee Music · Cyber Neon (`midnight-purple`)

The primary visual identity is derived directly from the **Bee anime character visual reference**:
- **Character Color Spectrum**:
  - High-contrast tech chassis: Deep Black (`#05060A`, `#080A10`) and crisp White (`#FFFFFF`).
  - Glowing wing roots & technological accents: Ice Blue (`#D4E2FF`, `#91B0FF`) and Electric Blue (`#4D8BFF`, `#3875F6`).
  - Translucent wing feathers & floating music notes: Periwinkle (`#7C86FF`) and Lavender (`#9087FF`, `#A99CFF`).
  - Wingtip glow, headphones highlight, and sparkle accents: Soft Violet (`#B47BFF`, `#C96BFF`).
  - Shadow and base depth: Deep Navy Blue (`#0B0E16`, `#0F1322`).
- **Continuous Spectrum Flow**: Rather than pinning a single monolithic hex color as the "brand", the UI utilizes continuous spectral gradients connecting Electric Blue, Periwinkle, Lavender, and Soft Violet.
- **Subtle Neon Glows & Soft Glass**: Tiered neon glows (`--glow-brand-sm`, `--glow-blue-md`, `--glow-purple-md`) and frosted semi-transparent surfaces provide high-tech tactile hierarchy without hard clunky borders.

```css
/* Core Cyber Neon Gradients */
--gradient-brand: linear-gradient(135deg, #5F87FF 0%, #7C86FF 45%, #9687FF 75%, #A99CFF 100%);
--gradient-progress: linear-gradient(90deg, #3875F6 0%, #4D8BFF 30%, #7C86FF 70%, #A99CFF 100%);
--gradient-blue-violet: linear-gradient(135deg, #4D8BFF 0%, #A99CFF 100%);
--gradient-ice: linear-gradient(135deg, #EAF1FF 0%, #91B0FF 50%, #4D8BFF 100%);
--gradient-spectrum: linear-gradient(90deg, #4D8BFF 0%, #7C86FF 25%, #9087FF 50%, #B47BFF 75%, #C96BFF 100%);
```

### 6.2 Alternate Themes & Runtime Extensibility

The application supports multiple built-in and dynamic user themes:
- **`midnight-purple` (`Bee Music · Cyber Neon`)**: Default primary theme.
- **`spotify` (`Spotify Classic`)**: High-contrast classic streaming player theme featuring the signature `#1DB954` green accent.
- **Dynamic User Themes**: Users can import any custom `.json` theme file via Settings. The theme engine dynamically validates and deep-merges missing tokens with `midnightPurpleTheme.tokens`, registers the theme at runtime, and persists it to `ctx.store`.
- **Protected Built-Ins & Safe Deletion**: Built-in themes cannot be removed (`removeTheme()` returns `false`). Custom themes can be deleted via Settings; if an active custom theme is removed, the engine immediately falls back to `midnight-purple` and emits `theme/registry-changed`.

### 6.3 Surface Hierarchy & Receding Solid Black Chassis

Depth is communicated through **subtle luminance stepping and translucent layers**, anchored by an absolute black chassis:

| Layer | Value / Variable | Role & Usage |
|---|---|---|
| `chassis` | `#000000` / `var(--player-bg)` | The outer frame, desktop rail, and persistent bottom player bar. Solid black without top borders (`borderTop: none`) to eliminate visual noise and anchor the viewport. |
| `bg.base` | `#080A10` / `var(--bg-primary)` | Main scrollable canvas for playlists, album views, search results, and library grids. |
| `surface.s1` | `var(--surface-1)` | Elevated media cards (album/playlist tiles) and section panels. |
| `surface.s2` | `var(--surface-2)` | Cards on hover, dialogs, and flyout sheets. |
| `surface.hover` | `var(--surface-hover)` | Active hover illumination on track rows and interactive items. |
| `surface.selected`| `var(--surface-selected)` | Selected rows, active navigation tabs, and focus chips. |
| `border.subtle` | `var(--border-subtle)` | Hairline dividers between major structural panels. |
| `border.focus` | `var(--border-focus)` | Accessible focus rings clearing WCAG 1.4.11 3:1 contrast. |

- **Dynamic Reactive Canvas Gradients**: Detail views (Album Detail, Favorites, Local Music, Playlist Detail, Settings) render smooth vertical ambient gradients responding to `--surface-hover` / `--surface-selected` / `--surface-1` / `--bg-primary`, adapting instantly to any theme switch.
- **Cover-Tinted Detail Theming**: The four detail pages (Album Detail, Playlist Detail, Favorites, Local Music) source the header area's gradient and the scroll-collapsed sticky bar's wash from the cover's `dominantColor` via the kit's `headerGradient(tint)` / `tintRgba` — the tint is strongest at the top (~50% alpha) and, using percentage stops, lands exactly on `--bg-primary` at the header's bottom edge, so the gradient scrolls away with the header and everything below (rows, pinned table header) sits on the same solid colour with no seam. A ref without a declared colour gets a one-shot canvas extraction (`useImageColor` → `extractVibrantColor`); an unreadable cover or no cover at all falls back to the neutral brand wash above, never an error. Favorites pins the liked-songs purple (`#450af5`) as its identity tint; Local Music, with no single cover, keeps the neutral gradient.

### 6.4 CSS Shorthand & Styling Conventions

> ⚠️ **CRITICAL CSS RULE: Use `background:` shorthand, never `backgroundColor:` for theme tokens:**
> Many theme variables (such as `--button-primary-bg`, `--playing-item-indicator`, and `--gradient-brand`) resolve to CSS linear gradients (`linear-gradient(...)`).
> In CSS specifications, `backgroundColor` does not accept gradients; browser rendering engines discard `backgroundColor: linear-gradient(...)` as invalid, leaving elements completely transparent!
> **Always write `background: var(--button-primary-bg, ...)`** across all buttons, cards, and indicator components.

### 6.5 Typography & type scale

The typography stack prioritises geometric grotesque letterforms:
`"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
The font is resolved locally from the OS/system rather than downloaded, avoiding foreign webfont
licensing and CSP network overhead.

The scale relies on **"weight follows size"**:
- **Display (`40px`, weight `900` heavy, line-height `1.2`)**: Massive hero titles on playlist and
  album detail pages.
- **XL (`28px`, weight `900` heavy, line-height `1.2`)**: Major section headers ("Made for You",
  "Recently Played").
- **LG (`20px`, weight `700` bold)**: Section titles, shelf headers, dialog titles.
- **MD (`15px`, weight `700` bold for titles, `400` regular for body)**: Track titles, primary
  menu labels.
- **SM (`13px`, weight `400` regular)**: Artist names, album subtitle links, duration timestamps.
- **XS (`11px`, weight `500` medium / `700` bold, uppercase)**: Column labels (`TITLE`, `ALBUM`,
  `DATE ADDED`), category tags, and duration badges.

### 6.6 Component affordances & micro-interactions

- **Pill buttons (`radius.pill: 999`)**: Interactive controls (primary action buttons, category
  filter chips, tag toggles) are pill-shaped. In a borderless dark UI where panels are rectangles,
  the fully rounded shape immediately signals pressability.
- **Hover micro-scaling**: Primary pill buttons scale up slightly under the pointer
  (`transform: scale(1.04)` over `120ms`) rather than just shifting color, providing immediate,
  tactile physical feedback against near-black backgrounds.
- **Media cards & floating play reveal**: Rectangular cards (`radius.md: 8px`, `bg.raised: #181818`)
  feature square artwork (`radius.sm: 4px`) at the top, followed by bold title and artist subtitle.
  On pointer hover:
  1. The card background brightens from `#181818` to `#282828`.
  2. A vibrant green circular play button (`48px` diameter, `#1DB954` fill, `#000000` play glyph)
     rises into view at the bottom-right corner of the artwork with a gentle translateY and opacity
     transition (`120ms`) and subtle drop shadow.
  3. Clicking the play button immediately starts playback of that container without navigating.
- **Track rows (`TrackRow`, height `56px`)**:
  - Displays index number, artwork thumbnail (`48px` square, `radius.sm: 4px`), track title in
    `#FFFFFF`, artists in `#B3B3B3`, album name, and duration.
  - On hover, the row illuminates (`#282828`), the track number is replaced by a play icon (`play-filled`),
    and quick actions (heart/saved toggle button `heart` / `heart-filled` via `onToggleLoved`, context menu `dots`) become visible.
  - When actively playing, the track title, track number, and equalizer icon illuminate in
    signature green (`#1DB954`).
- **Scrubbers & sliders (`Slider`, `VerticalSlider`)**:
  - Horizontal & vertical bars with a slim `3px` track height/width and dark background track.
  - Played progress fill displays in `#FFFFFF` during passive display, but illuminates in signature
    green (`#1DB954`) on pointer hover or active drag.
  - **Hover-only knob affordance**: The circular thumb handle (`12px` diameter) is hidden during
    idle state (`opacity: 0`) to preserve clean lines across dense views; it smoothly reveals
    (`opacity: 1` over `150ms`) exclusively when the pointer hovers over the slider or during active drag.
  - Progress bar (`ProgressBar`): Slim `3px` track matching slider dimensions.
- **Global scrollbars**:
  - Hidden track background (`background: transparent`) to prevent grey gutter bars from breaking
    dark canvas continuity.
  - Ultra-narrow width (`4px` width on desktop).
  - **A pane's thumb is visible only for the pane under the pointer, or while that pane itself is
    scrolling.** `main.tsx` maintains two plain classes on the scroll container:
    `is-scrollbar-hover` (the deepest scrollable ancestor of the hovered element, from `mouseover`)
    and `is-scrolling` (self-cleared 1.2s after the pane's last scroll event). Every other pane's
    scrollbar stays fully transparent, so scrolling page A never lights the sidebar's, the queue's
    or another page's scrollbar.
  - ⚠️ **Chromium trap, do not revisit**: `*:hover::-webkit-scrollbar-thumb` does not work —
    Chromium evaluates scrollbar part styles without the owner element's `:hover` state, which
    painted the "hover" variant on *every* pane at all times (and a document-wide
    `html.is-scrolling` flag lit every scrollbar during any scroll). Only plain classes on the
    scroll container reach the cascade; likewise standard `scrollbar-width`/`scrollbar-color`
    would disable the `::-webkit-scrollbar` rules entirely.
- **Hover labels for clamped names (`HoverLabel`)**:
  - Wraps a clamped title/name; resting the pointer on it for **2 seconds** floats a portal tooltip
    (fixed-positioned on `document.body`, so list-row `overflow: hidden` cannot clip it) with the
    full text. Dismissed on leave, scroll, resize, or `Escape`.
  - Applied to the detail pages' hero title (`DetailHero` — 专辑/最喜欢/歌单/本地) and to the track
    title/artist cells of the library and album table rows.
- **Marquee text for clamped playback text (`MarqueeText`)**:
  - A one-line clip box that ping-pongs its content (scroll to the end, hold, scroll back) via the
    Web Animations API when the text overflows; a static line when it fits or when
    `element.animate` is unavailable (tests).
  - Used for the bottom bar's track title and artist name.
- **TopBar search bar & dynamic icon shift**:
  - Centered search input (`360px` default width, `max-width: 480px`, `height: 36px`, pill radius `radius.pill: 999`, background `#282828`).
  - **Collapse to a magnifier**: when the window squeezes the center group below `180px`
    (ResizeObserver-measured), the search renders as a single magnifier button; clicking it expands
    the search across the bar — the tray and profile icons hide while expanded, the window controls
    never do — and clicking elsewhere, `Escape`, or committing the query restores the icons and the
    collapsed button.
  - **Dynamic icon positioning**:
    - *Idle state*: Search icon (`search`) sits at the left padding (`left: 12px`), with placeholder text `"搜索歌曲、专辑、艺人..."`.
    - *Active / Focused state*: Search icon smoothly slides across the input to the far right (`right: 12px`, `all 200ms cubic-bezier(0.4, 0, 0.2, 1)`), functioning as a clickable search trigger.
    - *Dismissal*: Clicking outside the search area or pressing `Escape` resets the icon back to the left.
- **2×2 Search Matrix Floating Dropdown**:
  - Positioned directly beneath the search input (`top: calc(100% + 8px)`, width `600px`, `z-index: 1000`).
  - Elevated `#181818` card surface with `#282828` border, `12px` border-radius, and ambient drop shadow (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5)`).
  - 2×2 Grid layout (`display: grid; grid-template-columns: 1fr 1fr; gap: 16px`):
    - **Row 1 (Header row)**:
      - Left column: "搜索范围" (`Search Scope`) section header (`xs: 11px`, `text.secondary`).
      - Right column: "搜索历史" (`Search History`) section header (`xs: 11px`, `text.secondary`) with an adjacent high-transparency "清空" (`Clear`) button (`rgba(255, 255, 255, 0.4)`, hover `rgba(255, 255, 255, 0.8)`).
    - **Row 2 (Content row)**:
      - Left column (Sources): Interactive third-party music source toggle buttons connected to `useSearchSourceSelection(ctx)`. Renders individual source interface chips (active in signature green `#1DB954` fill with black text; inactive in `#282828` with grey text) alongside "全部" (All) and "重置" (None) batch toggles.
      - Right column (History): Interactive search history tags stored in `localStorage` (`bbebee_search_history`, max 10 entries). Clicking any tag executes that search immediately. An empty state label ("暂无搜索历史") is displayed when history is empty.

### 6.7 Dynamic hero gradients & artwork presentation

- **Square artwork (`radius.sm: 4px`)**: Tracks, albums, and playlists use square aspect ratios.
  Artists use circular avatars (`radius.pill`).
- **Zero-layout-shift loading**: Artwork containers display `blurhash` strings instantly as
  backgrounds while the full resolution image loads lazily, with fallback to `artworks.dominant_color`.
  Cover art that does not exist at all is generated instead: a deterministic identicon derived from
  the entity's URN (see the rendering rules above), so an artwork-less library still reads as a
  grid of distinct, stable squares.
- **Dynamic ambient hero banner**: Header sections of playlist and album views extract
  `artworks.dominant_color` from cover artwork, generating a rich vertical gradient that radiates
  from the top banner and smoothly bleeds down into the `#121212` base canvas.

### 6.8 Shell structure & layout paradigms

- **Desktop Shell**:
  - **Left navigation rail / sidebar (sunken `#000000`)**: Dedicated to browsing user content and
    collections (Home / Your Library, History, scrollable playlist list). Global utility routes
    (Search and Settings) are intentionally excluded from the sidebar.
  - **TopBar (sunken `#000000` / `#121212`)**: Spans window title chrome.
    Left: brand logo (Home) and window navigation history buttons (Back/Forward) — the ⋯ More menu
    was removed.
    Center: search input with dynamic search icon shift, collapse-to-magnifier under narrow
    windows, and 2×2 matrix dropdown (Search Scope sources + Search History).
    Right: plugin tray, user profile avatar button linking directly to Settings Center
    (`settings.view`; Settings also appears in the tray via `'tray'` route placement), then the
    minimize/maximize/close window controls, which are never hidden.
  - **Center main content card (`#121212`, rounded corners)**: Scrollable canvas hosting the
    dynamic gradient hero header, action bar (large green circular play button `play-filled`, heart/save `heart` / `heart-filled`, more options `dots`),
    and virtualized track list or media card grid. The Library view organizes items through
    top-level scopes (`All`, `Local`, `Favorites`) and content views (`Tracks`, `Albums`).
  - **Persistent bottom playback bar (sunken `#000000` / `#181818`)**: Spans the entire window width.
    Left: current track artwork thumbnail, track title (`#FFFFFF`) and artist subtitle (`#B3B3B3`) —
    both marquee-scroll (`MarqueeText`) when compressed instead of truncating — and the save button.
    Center: transport controls (current playback mode button to the left of previous,
    previous track, oversized circular play/pause button, next track, sound status icon to the right
    of next with mute 'x' / loudness wave tiers that toggles a vertical volume slider popover with
    a bottom mute toggle) and time scrubber, whose width stays constant while `Buffering…` shows
    (a fixed 64px slot hosts the label). Right: utility toggles (desktop lyrics toggle, queue,
    device picker).
- **Mobile Shell**:
  - Clean full-bleed dark views with bottom navigation tab bar (Library, Search) and scoped library
    filtering (`All` / `Local` / `Favorites`).
  - Persistent mini-player docked directly above the tab bar showing cover thumbnail, marquee title,
    artist name, play/pause toggle, and a hairline playback progress bar.
  - Full-screen now-playing sheet: Expanding the mini-player slides up an immersive player featuring
    large square cover art, bold geometric typography, scrub bar, circular transport controls, and
    swipe-up lyrics pane.

### 6.9 Iconography & stroke standard (Tabler Icons, stroke = 1.25)

All iconography across the desktop UI is standardized on **Tabler Icons SVG paths** with a unified line weight:
- **Global Stroke Width**: Standardized to `stroke="1.25"` (`DEFAULT_STROKE_WIDTH = 1.25` in `packages/ui/ui-kit-desktop/src/icons/tabler.ts`).
  A 1.25 stroke provides crisp, high-precision geometry on dark backgrounds without visual heaviness or blur at small font scales.
- **Zero Raw Unicode / Handwritten SVG**: UI components must never render raw Unicode glyphs or custom `<svg>` definitions directly. All icons are rendered via `tablerIcon(name, props)`, `TablerIcon`, or components accepting `IconName` (e.g. `IconButton`, `EmptyState`).
- **Standard Sizes & Default Size**: Default icon size is `28px` (`DEFAULT_ICON_SIZE = 28` in `packages/ui/ui-kit-desktop/src/icons/tabler.ts`). Size scale:
  - `sm`: 16–20px (table row actions, column headers, metadata badges)
  - `md`: 22–24px (sidebar nav, action bars, slider thumbs, standard buttons, `tokens.size.icon = 24`)
  - `lg`: 28–32px (transport play controls, modal headers, `tokens.size.iconLarge = 32`)
  - `xl`: 36–52px (large hero play buttons, empty states)
- **Centralized Registry**: `packages/ui/ui-kit-desktop/src/icons/registry.ts` provides aliases mapping intuitive names (`play`, `pause`, `previous`, `next`, `volume-mute`, `favorite`, `favorite-filled`, `filter`, `close`, `add`, `more`, `folder`, etc.) to official Tabler icon definitions.
- **Accessible & Test-Friendly**: SVG elements emit `aria-hidden="true"` and `data-icon="{name}"`. Test suites query `[data-icon="..."]` or `data-testid` instead of asserting against text node values.

**Component parity is a contract.** Both kits export the same component names with the same props —
`Button`, `IconButton`, `TrackRow`, `Slider`, `Sheet`/`Dialog`, `List`, `EmptyState`, `Toast`,
`TextField`, `Text`, `Artwork`, `JsonTree`. A
plugin author writing both view packages should be transcribing, not redesigning. A parity test in
CI diffs the exported names and prop types of the two kits and fails on divergence, because without
it the kits drift silently and every plugin author pays.

---

