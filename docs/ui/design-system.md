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
| **`sunken`** | `#000000` | 0.000 | `#EAEBED` | 0.830 | Lowest anchor: outer window chassis, sidebar navigation rail, sunken input tracks |
| **`base`** | `#121212` | 0.006 | `#F7F7F8` | 0.931 | Main canvas: scrollable viewports, table views, feed screens (avoids stark `#FFFFFF` glare) |
| **`raised`** | `#181818` | 0.009 | `#FAFAFA` | 0.956 | Elevated content: media cards, batch action bars, floating utility shelves |
| **`overlay`** | `#282828` | 0.021 | `#FFFFFF` | 1.000 | Topmost surface: modal dialogs, sheets, context menus, tooltips, popovers |

The active theme maps its own `ColorTokens` on top of this core palette: the player chassis variable `--player-bg` is an alias of `--bg-app` (theme `bg.app`), which is `#05060A` for `midnight-purple` dark — see §6.3.

- **Luminance Inversion & Glare Prevention**: In dark mode, `sunken` is the darkest chassis layer and `overlay` is the brightest. In light mode, `sunken` remains the deepest/darkest anchor layer (`#EAEBED`), grounding the application structure, while `base` is specifically tuned to a warm, soft grey (`#F7F7F8`) instead of pure white to prevent eye strain during long listening sessions. `overlay` is pure white (`#FFFFFF`) to ensure modals and popovers cleanly elevate above the canvas.
- **No Direct Inversion:** Direct color inversion is forbidden. Backgrounds shift to soft off-white/grey palettes, while brand accent colors use deeper hues within the same brand spectrum to maintain WCAG AA contrast (e.g. Spotify green `#12833C`, Electric blue `#3B66F5`, Crimson `#C9184A`, Ocean abyss `#087E96`).
- **WCAG AA Compliance Gate:** Automated tests `paletteContrastIssues()` and `themeContrastIssues(theme, scheme)` enforce:
  - Normal text contrast $\ge 4.5:1$ (Light mode `text.primary` achieves **14.93:1** on `sunken` and **16.74:1** on `base`; `text.secondary` achieves **5.44:1** on `sunken` and **6.06:1** on `base`)
  - Large text & key UI borders contrast $\ge 3.0:1$
  - Tested across both `dark` and `light` schemes in CI parity suites.
- **Component Tokenization & Contrast Preservation Rule**: see the spec at [rules/ui.md §4](../../rules/ui.md#4-visual-design-language--color-system) (L2) — no hardcoded `#FFFFFF`/`#000000` foregrounds (semantic CSS variables only); fixed black containers keep light foregrounds / on-color tokens (Fixed Dark Container Exception).
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
- **Dynamic User Themes**: Users can import any custom theme via Settings (`.json` file upload or raw JSON paste). The theme engine dynamically validates and deep-merges missing tokens with `midnightPurpleTheme.tokens`, registers the theme at runtime, and persists it to `ctx.store`.
- **Protected Built-Ins & Safe Deletion**: Built-in themes cannot be removed (`removeTheme()` returns `false`). Custom themes can be deleted via Settings; if an active custom theme is removed, the engine immediately falls back to `midnight-purple` and emits `theme/registry-changed`.

### 6.3 Surface Hierarchy & Receding Solid Black Chassis

Depth is communicated through **subtle luminance stepping and translucent layers**, anchored by a near-black chassis (`#05060A` for the default `midnight-purple` dark scheme):

| Layer | Value / Variable | Role & Usage |
|---|---|---|
| `chassis` | `#05060A` / `var(--player-bg)` (`--player-bg` ≡ `--bg-app`, the theme's `bg.app`) | The outer frame, desktop rail, and persistent bottom player bar. Solid near-black without top borders (`borderTop: none`) to eliminate visual noise and anchor the viewport. |
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

> see the spec at [rules/ui.md §4 "CSS Shorthand & Styling Rule"](../../rules/ui.md#css-shorthand--styling-rule) (L2) — always `background:`, never `backgroundColor:`, wherever theme tokens or gradients can be assigned: gradient-valued variables are silently discarded as invalid CSS by `backgroundColor`, leaving elements transparent.

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
- **Transport play button**: the primary play control is circular with a high-contrast icon over
  the vibrant brand gradient fill (`background: var(--gradient-brand)`).
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
  - Hidden track background (`background: transparent`), ultra-narrow width (`4px` on desktop), and a high-transparency thumb (`rgba(255, 255, 255, 0.2)` default, `0.4` on hover) keep dark canvas continuity.
  - Scrollbar visibility dual-class mechanism (`is-scrollbar-hover` / `is-scrolling`) and the Chromium trap: see the spec and rationale at [rules/testing-and-gotchas.md §2](../../rules/testing-and-gotchas.md#2-common-gotchas) (L2).
- **Hover labels for clamped names (`HoverLabel`)**:
  - Wraps a clamped title/name; resting the pointer on it for **250ms** (standardized responsive window: 200～300ms) floats a portal tooltip
    (fixed-positioned on `document.body`, so list-row `overflow: hidden` cannot clip it) with the
    full text. Dismissed promptly on leave, scroll, resize, or `Escape`.
  - **Truncation-aware activation**: Evaluates actual rendered overflow (`isElementTruncated`: `scrollWidth > clientWidth` or line clamping); completely non-truncated titles remain quiet without showing duplicate tooltips unless `alwaysShow: true`.
  - **Viewport bounds & nest prevention**: Clamps positions to window edges, flips to bottom when top clearance is tight, and provides `HoverLabelContext` to prevent double-tooltips when wrapping components that provide their own tooltip capability.
  - Applied to the detail pages' hero title (`DetailHero` — Albums/Favorites/Playlists/Local) and to the track
    title, artist, and album cells across library, album, and now-playing views.
- **Synchronized marquee text for truncated titles (`MarqueeText` & `PageMarqueeProvider`)**:
  - A responsive one-line clip box that automatically detects text truncation via `ResizeObserver` (`overflow = scrollWidth - clientWidth`). If text fits completely, it remains completely static with zero animation overhead.
  - **Unified page-wide synchronized timeline**: Wrapped by `PageMarqueeProvider`, all visible truncated titles across the current page (Now Playing layouts, Local Music screen, Playlist detail, Album detail, and sticky headers) synchronize to an identical cycle (default `10000ms` / 10s):
    - `0% ~ 15%`: Initial rest and reading pause at start position.
    - `15% ~ 50%`: Smooth forward scroll revealing full text to the end with a `+6px` breathing room margin.
    - `50% ~ 65%`: End pause for inspection.
    - `65% ~ 100%`: Smooth reverse return to origin, ready for the next synchronized loop.
  - **Web Animations API integration**: Directly synchronizes `animation.currentTime = (performance.now() - startTime) % cycleDurationMs`, guaranteeing that newly mounted or scrolled-in items lock onto the page's exact frame instantly with 0ms JavaScript frame overhead.
  - **Viewport virtualization**: Connects to `IntersectionObserver` so off-screen elements in long virtual lists pause animations completely; only on-screen truncated items participate in rendering.
  - **Accessibility & Motion safety**: Automatically respects `prefers-reduced-motion: reduce`, disabling marquee animations and degrading gracefully to static text with ellipsis.
  - **Tooltip integration**: Pairs seamlessly with `HoverLabel` without interrupting, pausing, or desynchronizing the running marquee timeline.
  - Used for track title, artist name, and album name across bottom bar, full-screen player layouts, table rows, and sticky detail headers.
- **TopBar search bar & dynamic icon shift**:
  - Centered search input (`360px` default width, `max-width: 480px`, `height: 36px`, pill radius `radius.pill: 999`, background `#282828`).
  - **Collapse to a magnifier**: when the window squeezes the center group below `180px`
    (ResizeObserver-measured), the search renders as a single magnifier button; clicking it expands
    the search across the bar — the tray and profile icons hide while expanded, the window controls
    never do — and clicking elsewhere, `Escape`, or committing the query restores the icons and the
    collapsed button.
  - **Dynamic icon positioning**:
    - *Idle state*: Search icon (`search`) sits at the left padding (`left: 12px`), with placeholder text `"Search songs, albums, artists..."`.
    - *Active / Focused state*: Search icon smoothly slides across the input to the far right (`right: 12px`, `all 200ms cubic-bezier(0.4, 0, 0.2, 1)`), functioning as a clickable search trigger.
    - *Dismissal*: Clicking outside the search area or pressing `Escape` resets the icon back to the left.
- **2×2 Search Matrix Floating Dropdown**:
  - Positioned directly beneath the search input (`top: calc(100% + 8px)`, width `600px`, `z-index: 1000`).
  - Elevated `#181818` card surface with `#282828` border, `12px` border-radius, and ambient drop shadow (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5)`).
  - 2×2 Grid layout (`display: grid; grid-template-columns: 1fr 1fr; gap: 16px`):
    - **Row 1 (Header row)**:
      - Left column: "Search Scope" section header (`xs: 11px`, `text.secondary`).
      - Right column: "Search History" section header (`xs: 11px`, `text.secondary`) with an adjacent high-transparency "Clear" button (`rgba(255, 255, 255, 0.4)`, hover `rgba(255, 255, 255, 0.8)`).
    - **Row 2 (Content row)**:
      - Left column (Sources): Interactive third-party music source toggle buttons connected to `useSearchSourceSelection(ctx)`. Renders individual source interface chips (active in signature green `#1DB954` fill with black text; inactive in `#282828` with grey text) alongside "All" and "None" batch toggles.
      - Right column (History): Interactive search history tags stored in `localStorage` (`bbebee_search_history`, max 10 entries). Clicking any tag executes that search immediately. An empty state label ("No search history yet") is displayed when history is empty.

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
  - **Persistent bottom playback bar (sunken)**: Spans the entire window width (`borderTop: none`).
    Left: current track artwork thumbnail, track title (`#FFFFFF`) and artist subtitle (`#B3B3B3`) —
    both marquee-scroll (`MarqueeText`) when compressed instead of truncating — and the save button.
    Center: transport controls (current playback mode button to the left of previous,
    previous track, oversized circular play/pause button, next track, sound status icon to the right
    of next with mute 'x' / loudness wave tiers that toggles a vertical volume slider popover with
    a bottom mute toggle) and time scrubber, whose width stays constant while `Buffering…` shows
    (a fixed 64px slot hosts the label). Right: utility toggles (desktop lyrics toggle, queue,
    device picker). The play-mode button cycles sequence / single-loop / list-loop / shuffle.
  - **TopBar placement**: embedded at the top of the main content pane — not a full-width row — so
    the sidebar and queue panel run the full window height; when the library's expanded mode takes
    over the workspace, the TopBar moves into the expanded library pane.
  - **Queue drawer**: a right-side drawer overlaying the workspace (`position: absolute`, below the
    48px top bar so window controls stay reachable). It takes no grid column, so opening it resizes
    nothing; the queue splitter adjusts its width and double-click resets it to the default (340px).
    `ui/navigate 'queue.view'` only toggles the drawer — it never ejects the page it was opened
    from — and over the fullscreen play page the drawer rises above the play-page overlay
    (`zIndex: 120` vs the overlay's 100; 40 otherwise, splitter 125); only the share modals (130)
    and the desktop lyrics window (9999) sit above it.
  - **Fullscreen play page**: an overlay stacked on the shell — opaque, fixed, z-index 100, a late
    child of the shell root — never an early-return branch swap, so every cached page stays mounted
    underneath ([ui/architecture.md §7.1](architecture.md#71-desktop-shell-navigation--topbar-interaction)).
  - **Library sidebar quick entries** (Favorites / Local & Downloads): highlight from the shell's real current
    route (`activeViewId` prop), never from `ui/navigate` events — shell-internal navigation
    (album detail, back/forward, home) emits none.
  - **Queue row drag reorder**: native HTML5 DnD (no dependency) plus Alt+↑/↓; the drop gap in the
    visible play order translates to a queue row index via `upcomingDropToQueueIndex`
    (`plugin-queue-ui-desktop/src/reorder.ts`); dragging is disabled while shuffle is on, because
    the visible order is then a permutation, not the rows.
- **Mobile Shell**:
  - Clean full-bleed dark views with bottom navigation tab bar (Library, Search) and scoped library
    filtering (`All` / `Local` / `Favorites`).
  - Persistent mini-player docked directly above the tab bar showing cover thumbnail, marquee title,
    artist name, play/pause toggle, and a hairline playback progress bar.
  - Full-screen now-playing sheet: Expanding the mini-player slides up an immersive player featuring
    large square cover art, bold geometric typography, scrub bar, circular transport controls, and
    swipe-up lyrics pane.

### 6.9 Iconography & stroke standard (Tabler Icons, stroke = 1.25)

All iconography across the desktop UI is standardized on **Tabler Icons SVG paths**. The stroke width, the zero-handwritten-SVG rule (with the mobile `MENU_ICON_GLYPHS` exception) and the accessible-rendering contract (`aria-hidden="true"` + `data-icon="{name}"`, tests query `[data-icon]`/`data-testid`) are normative in [rules/ui.md §4.1](../../rules/ui.md#41-tabler-icons--stroke-standard-stroke--125) (L2). A 1.25 stroke provides crisp, high-precision geometry on dark backgrounds without visual heaviness or blur at small font scales.

- **Standard Sizes & Default Size**: Default icon size is `28px` (`DEFAULT_ICON_SIZE = 28` in `packages/ui/ui-kit-desktop/src/icons/tabler.ts`). Size scale:
  - `sm`: 16–20px (table row actions, column headers, metadata badges)
  - `md`: 22–24px (sidebar nav, action bars, slider thumbs, standard buttons, `tokens.size.icon = 24`)
  - `lg`: 28–32px (transport play controls, modal headers, `tokens.size.iconLarge = 32`)
  - `xl`: 36–52px (large hero play buttons, empty states)
- **Centralized Registry**: `packages/ui/ui-kit-desktop/src/icons/registry.ts` provides `ICON_ALIASES`, mapping semantic alias keys to official Tabler definitions (an unknown name falls through to the Tabler key itself). The alias keys, grouped:
  - Navigation & search: `home`, `search`, `library` (→ `books`), `compass`
  - Playback & volume: `play`, `play-outline`, `pause`, `pause-outline`, `previous`, `next`, `volume`, `volume-high`, `volume-2`, `volume-3`, `volume-zero`, `mute` / `volume-off`
  - Modes: `shuffle`, `repeat` (`list-loop`), `repeat-once` (`single-loop`), `sequence` (→ `list-numbers`)
  - Curation & actions: `heart`, `heart-filled`, `plus`, `minus`, `trash`, `x` (`close`/`clear`), `pin`, `pencil` (`edit`), `download`, `clock`, `alarm`, `history`, `playlist` (`queue`), `list`, `sort` (→ `arrows-sort`), `dots` (`more`), `dots-vertical`, `folder`, `folder-plus` (`create-folder`), `folder-share` (`move-folder`), `music`, `disc` (`album`), `playlist-add` (`create-playlist`), `list-check`, `check`, `checkbox`
  - **Add-to-list semantics**: "Add to playlist / Add to another playlist / Add (playlist detail)" actions use a bare `plus`; "Add to play queue" (enqueue to the play queue) uses `playlist-add` (list + plus) to keep the two apart.
  - Direction & UI: `chevron-left` (`back`), `chevron-right` (`forward`), `chevron-down` (`expand`), `chevron-up` (`collapse`), `alert`, `settings`, `adjustments` (`tune`), `user`, `lock`, `lock-open`, `copy`, `camera`, `info-circle` (`info`), `share`, `share-box` (`external-link`), `bug`, `sidebar` (→ `layout-sidebar`), `maximize`, `minimize`, `wave-sine` (`equalizer`)
- **Accessible & Test-Friendly**: SVG elements emit `aria-hidden="true"` and `data-icon="{name}"`. Test suites query `[data-icon="..."]` or `data-testid` instead of asserting against text node values — see [rules/ui.md §4.1](../../rules/ui.md#41-tabler-icons--stroke-standard-stroke--125) (L2).

**Component parity is a contract.** Both kits export the same component names with the same props —
`Button`, `IconButton`, `TrackRow`, `Slider`, `Sheet`/`Dialog`, `List`, `EmptyState`, `Toast`,
`TextField`, `Text`, `Artwork`, `JsonTree`. A
plugin author writing both view packages should be transcribing, not redesigning. A parity test in
CI diffs the exported names and prop types of the two kits and fails on divergence, because without
it the kits drift silently and every plugin author pays.

---

## 7. Desktop Settings Center — Layout & Diagnostics

Ownership of the contributed domains is normative in [rules/ui.md §5](../../rules/ui.md#5-desktop-settings-center--diagnostics-specifications) (L2): the settings screen owns none of them.

### 7.1 Layout & Navigation
- **Single-page settings screen**: a fixed, text-only tab rail on the left (pure text labels, no
  icons) and one naturally scrolling main container that exclusively renders the active tab's
  section group — `SettingsScreen` renders only the `activeTab`-matched sections (mutually
  exclusive section rendering), and sections carry stable `section-<id>` anchor ids. Avoid nested
  scroll containers inside sections.
- **Card-level hierarchy**: muted translucent backgrounds (`rgba(255, 255, 255, 0.03)`) for section
  cards with generous whitespace, rather than wrapping individual setting rows into isolated cards.
- **Consistent row components**:
  - `Boolean` → `Switch`
  - `Enum` → `Select` dropdown
  - `Number` → `Slider`
  - `Text` → `Input`
  - `Action` → `Button`
  - `Nested/Expanded` → Chevron expandable row

### 7.2 Dedicated Domains in Settings — who contributes what

| Section | Contributed by | Shape |
|---|---|---|
| `general` — User profile | `plugin-library` (`library.profile`) | card, view in `plugin-library-ui-desktop` |
| `general` — Theme management / Appearance mode | `plugin-theme` (`theme.settings`) | card (view in `plugin-theme-ui-desktop`) |
| `general` — Language, closeToTray | settings service (kept rows) / composition root | kept row + `fields` |
| `playback` — Now-playing style templates | `plugin-now-playing` (`now-playing.styles`) | card, view in `plugin-now-playing-ui-desktop` |
| `playback` — Transition & crossfade | `plugin-player` (`player.transition`) | `fields` (gapless, crossfade, pause-on-unplug) |
| `playback` — Audio engine/exclusive/device | composition root (`apps/*/boot.ts`) | `fields` + `optionsAsync`/`noteAsync` |
| `playback`/`audio` — DSP cards, loudness normalization | `plugin-dsp` | card (already contributed) |
| `playback` — Audio visualization | `plugin-visualizer` | card (already contributed) |
| `lyrics` — Desktop lyrics settings | `plugin-desktop-lyrics` (`desktop-lyrics.settings`) | card with live preview, view in `plugin-desktop-lyrics-ui-desktop` |
| `lyrics` — Lyric source management | `plugin-lyric-sources` (`lyric-sources.manage`) | card, view in `plugin-lyric-sources-ui-desktop` |
| `network` — Third-party music/lyric source master toggles, User-Agent, proxy | `plugin-source-runtime` / `plugin-lyric-sources` / composition root | `fields` (`switch-list` for per-source proxy rules) |
| `sources` — Music sources, import, local folders | `plugin-sources` / `plugin-local-scanner` | link rows (already contributed) |
| `storage` — Downloads directory | `plugin-download` | `fields` (`directory`) |
| `storage` — Cache directory & usage | `plugin-cache` | `fields` (`directory` + `action` with outcome feedback) |
| `plugins` — Plugin management | `plugin-manager` (`manager.view`) | card, view in `plugin-manager-ui-desktop` |
| `shortcuts` — Global shortcuts | `plugin-settings` itself (`settings.shortcuts`) | card, view in `plugin-settings-ui-desktop` |

Domain behaviours that stay with their owners even after the move:

- **Desktop Lyrics**: master enable switch, single/double line mode, alignment, font family and size (16–48px), color with hex input, opacity (0.2–1.0), live floating preview card, and the strict 4-step startup lifecycle (1. check enabled → 2. restore position → 3. push settings & data → 4. show window) — all inside `plugin-desktop-lyrics`'s card view.
- **Global Hotkeys**: registration is headless orchestration owned by the `plugin-settings` feature (`watchGlobalShortcuts`): it lives for as long as the service does — not for as long as the settings screen is mounted — and rebinds on `settings/changed`. The contributed card renders the toggle and key bindings only.
- **Proxy**: the desktop main process applies the config (session proxy, auth, `proxy:test` latency probe); the descriptor — including the Google-probe action and the per-source `switch-list` — is contributed by the composition root.
- **About & Advanced Settings (Diagnostics Guard)**: the one domain the settings screen keeps hardcoding (it is the settings service's own page): app metadata, the "Advanced settings" diagnostics guard housing Developer Diagnostics (`debug.view`, `debug.logs`, `debug.http-logs`), and the Danger Zone (settings reset).

### 7.3 Diagnostics System
- `debug.view`: Debug mode indicator, environment specs (Node, Electron, OS, Chromium, paths), and quick links to log screens.
- `debug.logs`: Live ring-buffer logs (`ctx.logBuffer`) with level filters and search; the full buffer copies to the clipboard as NDJSON (Copy all logs), and Clear logs clears it — there is no file-export action (`LogsScreen.tsx`).
- `debug.http-logs`: Outgoing HTTP requests from third-party music sources, detailing method, status code, latency, and URL.

---

## 8. Library Sidebar Modes & Context Menu Design

Folder/collection semantics and recursive track gathering are normative in [rules/ui.md §6](../../rules/ui.md#6-library-sidebars--context-menus-specification) (L2).

### 8.1 Library Layout Modes
- **Collapsed Mode (72px)**: Minimal compact rail showing icon tiles. Folders render dedicated folder outline SVG icons. Entering a folder reveals a `chevron-left` return button beneath the top logo to return to the root library.
- **Sidebar Mode (260–340px)**: Standard library navigation. Folders feature inline expand/collapse via rotating chevron indicators (`chevron-down` / `chevron-right`), indenting children by 28px left padding. Clicking the folder row navigates into the folder details screen (`chevron-left <folder name>`).
- **Expanded Mode (Full Canvas)**: High-density 3-column table view with breadcrumbs (`Music library < folder name`), interactive search, and responsive sizing.

### 8.2 Context Menu Design Standards
- **Track menus on player surfaces**: the bottom bar's cover and the fullscreen play page both
  right-click to the same track menu model (`trackMenuItems`); the play page passes the playing
  queue entry's id (`state.currentItemId`, queue-row fallback by `trackUrn`) so Remove from queue
  targets the real queue row, and the lyric text it already renders as `TrackMenuOptions.lyrics` —
  that option is what makes Share lyrics offerable; the model never fetches lyrics itself. Both
  surfaces resolve the playing track through `useCurrentTrack`
  (`plugin-now-playing-ui-desktop/src/hooks.ts`). The fullscreen bar renders inside an
  `overflow: hidden` container whose footer slides via `transform` — either clips or re-anchors
  fixed menus — so the shell passes it `portalMenus: true` and the kit mounts
  `ContextMenu`/`SaveToPlaylistPopover` on `document.body` (`portal` prop).
- **Dark Card Theme**: `#242424` background, 8px border radius, 4px padding, `0 12px 32px rgba(0,0,0,0.55)` depth shadow, and 1px border (`rgba(255, 255, 255, 0.08)`).
- **Dividers**: Menu items support `divider: true` to render a 1px translucent separator line (`rgba(255, 255, 255, 0.08)`).
- **Section Headings**: Menu items support `heading: true` to render as a flush-left muted section label (12px padding, no 18px icon slot, no hover highlight, smaller bold type) — use it to name a group of options, with `divider: true` on the preceding item to close the previous group.
- **Outline Icons**: Standard actions map to Tabler SVG icons (`stroke: 1.25`): `pencil`, `trash`, `pin`, `plus`, `folder`, `play-filled`, `download`, `playlist`.
- **Dedicated Modals**:
  - `EditPlaylistModal`: Modify cover art (file picker or URL), title, and multiline description.
  - `RenameFolderModal`: Rename folder title and save via `ctx.library.renameCollection`.
  - `ConfirmDeleteModal`: Secondary confirmation modal for destructive deletion of playlists and albums. Displays entity-specific warning ("Delete playlist "{name}"? This action cannot be undone." / "Remove album "{name}" from the music library?") with a high-danger action button and cancel option; supports `Escape` dismissal. Deletion only executes after explicit confirmation.
- **Album Context Menu**:
  - Album rows support right-click / context menu actions matching playlist aesthetics: `delete-album` (danger tone with divider, opens `ConfirmDeleteModal` to remove from library and folders), `toggle-pin` (pin/unpin album), and `add-to-collection` (move to folder, subfolder, or root).
- **Folder Mobility & Root List Coherence**:
  - Playlists nested inside folders are automatically hidden from the library's root list (`containedPlaylistUrns`). Moving a playlist back to the root level restores it to the root list immediately.
  - Context menus for entities inside folders provide a "Move to root" option and automatically remove the item from the source folder when moving to another destination folder, with instant 0ms optimistic UI updates.
- **Viewport Boundary Awareness**:
  - Context submenus (Flyouts) dynamically compute horizontal (left/right) and vertical (up/down) flipping relative to the viewport.
  - Submenu height is dynamically clamped (`maxHeight = Math.max(120, viewportHeight - flyoutTop - 8)`) with internal scrolling (`overflowY: 'auto'`), guaranteeing that nested menus never overflow the application window boundary.

---

## 9. Detail Screens, Sorting & Playback History

Strict track deduplication, the Favorite Dual-Write Invariant, playback-queue coherence and
playlist-item-id decoupling are normative in [rules/ui.md §7](../../rules/ui.md#7-detail-screens-sorting--playback-history-specifications) (L2).
Cover-tinted header theming is specified in [§6.3](#63-surface-hierarchy--receding-solid-black-chassis) above.

### 9.1 Collapsing Header & Sticky Bar (`AlbumScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, `LocalMusicScreen`)
- **Spotify-style collapsing header**: The detail page's hero and action bar live in the list's `header` slot (`List` from `ui-kit-desktop`), scrolling away with the content. The `StickyDetailBar` slides down from above the viewport as the header's big play button approaches, leaving title + play button + the table header. The **table header pins just below the bar** once scrolled past — via the `List`'s `stickyHeader` slot, because as a direct child of the scroller it is the only placement where `position: sticky` actually holds (nested inside the header it is its parent's last child and can never stick). Local Music's Albums tab, which is not virtualised, reproduces the identical structure with the page's own scroll container.
- **Sticky bar contract**: The bar is passed as the `List`'s `sticky` slot — a **direct child of the scroller** (`position: sticky` only sticks within its parent's box; nesting it in the header would scroll it away exactly when it finishes arriving). The choreography is **measured, not assumed** (`useDetailBarCollapse`): every scroll event reads the anchor's (the big play button's) distance to the scrollport top; the bar slides in over the button's last stretch of approach and **docks when its edge has covered half the button's height** — the bar's own compact play button scales in at that moment (the absorb action), the title has finished fading in, and the table header sits pinned right beneath the bar with a solid background so rows slide under it. `pointer-events` follows the slide so the ghost of the bar never eats a click meant for the hero.
- **Table header hover**: By default the table header shows **no sort arrows at all**. Hovering it reveals hairline column separators (`boxShadow` insets, so no layout shift), lights the sorted column's directional arrow, and shows a dimmed sort hint on every not-currently-sorted column.
- **Shared detail-page primitives**: the four pages are assemblies, not copies. `ui-kit-desktop` owns `DetailTableHeader` (sticky sort header, columns as config — width/flex/align/icon/plain/visible), `DetailPlayButton` (the circular primary play button) and `DetailHero` (eyebrow / two-line-clamped title / subtitle / meta slot / cover slot); `ui-menus` owns `sortMenuItems` (the sort dropdown's entries with check marks, divider, Ascending/Descending); `plugin-library-ui-desktop` owns `LibraryTrackRow` (the track row shared by Local/Favorites/Playlists, with per-page extras as props: album link, added-date column, remove button). A new detail page assembles these instead of re-deriving them.
- **Long titles truncate**: the album/playlist hero title line-clamps at two lines (`-webkit-line-clamp`), never breaking the layout.

### 9.2 Track Table Sorting & Row Interactions
- **Interactive Header Columns & Source Column Sorting**:
  - Clicking column headers (`#`, `Title`, `Artist`, `Album`, `Source`, `Date added`, `Duration` with Tabler `clock` icon, `Play count`) toggles between ascending (`asc`) and descending (`desc`) order.
  - Active sorted column displays a subtle directional arrow indicator (`chevron-up` for ascending, `chevron-down` for descending).
  - `AlbumScreen`, `FavoritesScreen`, and `PlaylistDetailScreen` provide an interactive "Source" column (omitted in `LocalMusicScreen` where all tracks are local).
  - Source names are resolved via `resolveTrackSourceName(ctx, trackUrn)` (in `@BBeBee/toolkit/hooks`; returning `'Local'` for local/file paths, or provider display name e.g.). Sorting uses `localeCompare(..., { numeric: true, sensitivity: 'base' })`.
  - Column headers omit the legacy checkmark, presenting clean column names and the Tabler `clock` icon.
- **Batch Operations Mode & Toolbar (`BatchActionBar`)**:
  - The three-dot action menu in all four detail screens offers a direct "Batch operations" entry (`id: 'batch-operations'`, icon `list-check`) with no nested submenus.
  - Toggling enters batch mode and mounts `BatchActionBar`:
    - Native `<input type="checkbox">` for "Select All", matching track row checkboxes and supporting `indeterminate` (partial) and `checked` states;
    - "Play selected" (`batch-play`): Plays selected tracks in current visual order;
    - "Add to playlist" (`batch-add`): Batch adds selected tracks to a playlist, dynamically incrementing playlist track count by the selected quantity (`delta = active.tracks.length`);
    - "Delete" / "Remove from Favorites" (`batch-delete`): Removes or unfavorites selected tracks concurrently;
    - "Exit batch operations" (`exit-batch`): Cancels selection and restores normal single-track mode.
  - While in batch mode, the three-dot menu flattens all batch operations directly without submenus.
- **Action Bar Sort Dropdown (`ContextMenu`)**:
  - Dedicated sort dropdown button (e.g. `Default order` / `Custom order` / `Title` accompanied by Tabler `arrows-sort` or `list` icon).
  - Clicking reveals a structured `ContextMenu` with sort key options (including "Source") and an asc/desc toggle option.
- **View Mode Section in the Sort Menu (`viewModeMenuItems`)**:
  - The sort menu ends with a View mode section: a hairline divider closes the sort options, then a flush-left `heading` View mode label and one entry per mode with a check icon on the active one.
  - Album / Playlist / Favorites / Local-tracks offer Compact and List; the local-albums tab adds Tiled (the card grid).
  - Compact drops the artwork and promotes artists to their own column (table header included); List matches the historical row.
  - The choice persists per page in `localStorage` (`bbebee_view_mode:<key>` via `useViewMode` from `ui-kit-desktop`).
- **Unified Row Library Action Button (`TrackLibraryActionButton`) & Popover**:
  - Replaces previous static checkmark or favorite icon in track rows across `LocalMusicScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, and `CollectionScreen`.
  - Hidden by default; smoothly fades in on row hover (`opacity: 1`).
  - **Not in library**: displays `plus` icon (`tablerIcon('plus')`), clicking adds track directly to favorites — writing **both stores**: `sources.setLoved(track.urn, true)` first, then `library.setSaved(track.urn, true)` (see the dual-write invariant in rules/ui.md §7).
  - **In library / favorites / playlist / collection**: displays `heart-filled` (green heart via `tablerIcon('heart-filled')`), clicking opens a dedicated Spotify-style `SaveToPlaylistPopover` instead of a raw context menu:
    - Real-time search filter for existing playlists;
    - Clicking "New playlist" seamlessly switches the top "Find playlist" search box into an inline creation input with autofocus, "OK" confirm button, and cancel button, while the list's "New playlist" row is automatically hidden to avoid redundant duplicate actions;
    - The "OK" button enforces `flexShrink: 0`, `whiteSpace: 'nowrap'`, `minWidth: 44`, and the input enforces `minWidth: 0` so button text is never compressed or truncated in Flexbox containers;
    - "Liked songs" group with immediate favorite toggle;
    - Playlist rows with checkbox toggles and folder rows expanding nested sub-playlists;
    - Viewport boundary detection with horizontal/vertical auto-flipping and clamping;
    - A tall, steady presence: minimum height 480px (folder flyout 320px), capped by the viewport — a menu that collapses to three rows reads as broken.
  - **In-library state is live, never a snapshot**: rows take `inLibrary` from `useTrackLibraryInfo.isTrackInLibrary` — the real-time saved set (`useSaved(ctx, 'track')`, reloaded on `library/changed`) with the row's possibly-stale `track.loved` only filling in what live data has not answered yet; the hook re-reads the changed URNs' loved flags from the catalogue on every `library/changed` event. Hardcoding `inLibrary: true` (a row being in a playlist does not mean it is favorited) or trusting a mount-time snapshot is how "unfavorited but still a heart" bugs happen.

### 9.3 Album Screen Customizations (`AlbumScreen`)
- Header Action Bar heart toggle: wired to `library.isSaved(album.urn)` / `library.setSaved(album.urn, isSaved)` with immediate reactivity, synchronizing saved albums to the Library albums tab.
- Local album safety: detects `urn.startsWith('BBeBee:local:')` to omit download button in header and row items, and removes download menu item.
- Three-dot menu: "Add to collection" renamed to "Add to folder", "Add to Favorites" updated to "Add to music library/Remove from music library", redundant "Add to playlist" and "Go to album" items removed.

### 9.4 Favorites Screen Parity (`FavoritesScreen`)
- Aligned with `LocalMusicScreen`: liked-songs purple gradient on the header area (`#450af5` via `headerGradient`, content below solid), no-cover text Hero Header ("Liked songs"), action bar with 56px play button (`play-filled`), shuffle (`shuffle`), search input, and sort dropdown (`arrows-sort`).
- Rows render as `FavoriteTrackTableRow`: index/hover play, 40px cover art, title/artist, album, hover `TrackLibraryActionButton` (`heart-filled` / `heart` submenu), hover `dots` more button, and duration.

### 9.5 Local Music Dual Views & Pagination (`LocalMusicScreen`)
- **Full Loading (No 100 Limit)**: Uses `fetchAllLocalTracks` and `fetchAllLocalAlbums` to recursively paginate in batches of 500 until all scanned files are retrieved, overcoming default 100-item page boundaries.
- **View Toggle**: Segmented toggle in header to switch between "Songs" (Tracks table) and "Albums" (Albums grid).
- **Local Album Grid (`LocalAlbumCard`)**:
  - Groups local tracks by album name, deriving artwork from the first track with artwork.
  - Cards display album cover, title, artist, and track count.
  - Hovering reveals a green play button (`play-filled`) for instant playback of the album's tracks.
  - Clicking the card navigates directly to the album view (`album.view`).
- **Album Grid Sorting**: Action bar sort menu dynamically adapts when album view is active, providing album-specific sort keys: default order, album title, artist, release year, track count.

### 9.6 Playback History & Recent Plays (`HistoryScreen` & `QueueScreen`)
- **Strict Deduplication by `trackUrn`**: Both desktop and mobile `HistoryScreen` and the desktop `QueueScreen` "Recently played" tab de-duplicate playback entries by `trackUrn`, retaining only the most recent playback record. Preserves latest playback timestamp, relative time display, and completion/skipped badges. Headless batch metadata loading (`useTracksByUrn`) only resolves the deduplicated URN list, avoiding redundant catalogue lookups.
- **Play Count Indicator**: `HistoryScreen` calculates cumulative play frequency per track across the history dataset and displays a pill badge (`Played N times`) in the row metadata area.
- **Header Count & Empty State Alignment**: Header record counts (`Recently played records (${uniqueRecords.length} songs)`) and empty state guards evaluate against deduplicated records.

### 9.7 Recommendation Screen & Bent-Ends Shelf Carousel (`RecommendScreen` & `RecommendShelfRow`)
- **Recommendation Shelf Hierarchy**:
  - `RecommendScreen` renders two dynamic personal shelves before third-party music sources:
    1. **"Recently played · Albums"** (`useRecentPlayedAlbums`): Resolves the most recent 20 unique tracks' albums from `ctx.player.getHistory()`, deduplicating track URNs to unique albums, subscribing reactively to `player/history-changed`.
    2. **"Favorites picks · Albums"** (`useFavoriteAlbums`): Randomly selects 20 albums from the user's saved favorite tracks (`ctx.library.listSaved('track')`), dynamically shuffled on mount and reactively updating on `library/changed`.
    3. **Third-Party Source Shelves** (`RecommendShelf`): One shelf per registered music source implementing `recommend` capability, featuring a "Show all" action button navigating to `RecommendAllScreen`.
- **Bent-Ends Shelf Carousel Physics (`RecommendShelfRow`)**:
  - **3D Curved Edge Bending**: Only the currently visible leftmost and rightmost cards bend inward on their outer edges (`perspective(600px) rotateY(±22deg)`), anchored by `transformOrigin: right center / left center` so their inner edges stay flush with neighbouring flat cards.
  - **Cylindrical Shading Illusion**: Each bent edge card applies a directional shading overlay (`linear-gradient(to right/left, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.24) 38%, rgba(0,0,0,0) 70%)`) that darkens the receding outer edge and blends smoothly to transparent inward.
  - **Dynamic Boundary Cancellation**: When the row is scrolled to the beginning (`leftEdgeIdx === 0`), the left bend effect and left scroll arrow are completely disabled; when scrolled to the end (`rightEdgeIdx >= entries.length - 1`), the right bend effect and right scroll arrow are completely disabled. Flat cards return to normal unbent transform seamlessly via CSS `transition: transform 0.28s ease`.
  - **Hover Navigation Arrows**: Frosted-glass circular buttons (❮ / ❯, 40×40px, font size 22px, `backdropFilter: blur(12px)`) float on top of the left and right edges, smoothly fading in on hover (`opacity: 1`, transition `0.18s ease`) and fading out when the mouse leaves.
  - **Vertical Scroll Interception Prevention**: The shelf scroll container enforces `overflowX: 'auto'` and `overflowY: 'hidden'`, ensuring mouse wheel or trackpad vertical gestures pass through cleanly to page vertical scrolling instead of getting trapped in the row.

---

## 10. Mini Player & Dynamic Island

Zero redundant action buttons, the `bbebee-file://` artwork boundary and the Cordis injection
invariant for secondary-window actions are normative in [rules/ui.md §8](../../rules/ui.md#8-mini-player--dynamic-island-desktop-specifications) (L2).

### 10.1 Multi-State Window Model
- **Floating Mini Player (`normal`)**: 380×96px floating pill. Provides album artwork, track title, artist, seek scrubber, and transport controls. Body is draggable (`-webkit-app-region: drag`), controls are interactive (`-webkit-app-region: no-drag`). Includes restore main window (`⤢`) and close (`✕`).
- **Dynamic Island Capsule (`attached`)**: 280×50px pill docked flush at the center top of the active display. Shows track title, artist, and live equalizer wave bars (`IslandWaveBars`). Single click or downward drag expands; double click collapses.
- **Expanded Dynamic Island (`expanded`)**: 420×184px card docked at the top. Shows large artwork, marquee text, animated wave bars, timeline scrubber, and transport controls. Double-clicking background collapses back to capsule; dragging downward past threshold (>60px) detaches into floating mode.
- **Gesture transitions**: dragging the floating player near the top edge (≤40px) automatically snaps to Dynamic Island; dragging the island downwards (>60px) detaches into the floating player; single click on the capsule expands to card; double clicking the background collapses to capsule.

### 10.2 Shadow & Border Luminance Standards
- **Transparent Window Glow Prevention**: Never use wide blur radii (>30px) or `0 0 0 1px` white outer rings on transparent secondary windows, which create exaggerated fuzzy halos.
- **Crisp Multi-Tier Black Shadows**:
  - Floating player: `0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)` (hover: `0 10px 24px rgba(0, 0, 0, 0.55)`).
  - Island capsule: `0 4px 12px rgba(0, 0, 0, 0.45)`.
  - Expanded island: `0 12px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)`.
- **Subtle Glass Border**: Border must use low-opacity white stroke (`1px solid rgba(255, 255, 255, 0.08)`), blending seamlessly with `rgba(18, 18, 18, 0.85)` dark glass and `backdrop-filter: blur(24px)`.

---

## 11. Now Playing Layout Styles

The iframe sandbox, data/action whitelists and injected SDK are security constraints normative in
[rules/ui.md §9.2](../../rules/ui.md#92-sandboxed-external-plugin-dynamic-import-option-b) (L2); the volume-popover portal pattern is in rules/ui.md §9.5.

### 11.1 Built-in Layout Styles
The app provides 5 built-in layout styles managed by `ctx.nowPlaying`:
1. **`classic`** (Default): Centered artwork, song title and artist below, transport controls at bottom, collapsible lyrics panel on the right.
2. **`cinematic`** (16:9 cinematic lyrics):
   - 16:9 centered stage (`aspectRatio: '16 / 9'`), maximum width 1240px.
   - Neutral dark base (`#0D1118`) with large cover backdrop (`opacity: 0.34`, `blur: 3.5px`, `scale 2`, centered) revealing artwork silhouette — cinematic film-reel atmosphere.
   - Left section (~46% width): square album artwork (up to 460px) with crisp white border (`2px solid rgba(255, 255, 255, 0.9)`), sharp corners (`borderRadius: 2`), and pronounced double-layer bottom-right shadow (`12px 16px 5px` + `20px 28px 56px`).
   - Right section: cursive/handwriting title (`Caveat` → `Segoe Print` → `cursive`, 46px, aligned not higher than cover top), muted artist, cinematic subtitle-style synchronized lyrics, then the settings-driven audio visualizer (the shared `visualizer.canvas` view — renders the style & color theme selected in settings) + progress bar + larger cursive italic timestamps with text shadow, aligned not lower than cover bottom.
   - The lyric list (the shared `CinematicLyricsTemplate`, owned by `ui-kit-desktop` so the now-playing cinematic layout and the lyrics panel consume one component) scrolls with the scrollbar hidden in both synced and plain modes (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` via an injected rule) — the list is the stage, not a document; auto-follow pauses on wheel/touch and offers a Back to current lyrics pill.
   - The visualizer sits nested inside the progress bar width; the visualizer's `wave` style is the cinematic organic waveform (layered tapered sine bands, gradient stroke fading at both ends, soft glow, amplitude lifted by live audio).
   - **No playback control buttons and no style switcher button on screen** — pure cinematic immersion; top-left return and top-right window controls auto-hide when mouse is away from top bar.
3. **`full-cover`**: Fullscreen blurred cover background, glassmorphism overlay, floating translucent transport controls.
4. **`vinyl`**: Circular spinning vinyl record animation with concentric groove sheen and center album label.
5. **`compact`**: Side-by-side widescreen layout with large artwork on the left and vertical metadata/controls/lyrics stream on the right.

### 11.2 Settings UI Integration (`NowPlayingStylesSection`)
- Mounted at the top of the "Playback & Audio (`PlaybackSection`)" settings tab.
- **Style Cards Grid**: Displays each style's name, description, tabler icon, author/version, and "Official built-in" vs "Sandboxed 🛡️" badge.
- Clicking any card switches the active style immediately and persists to `settings.nowPlayingStyle` and `ctx.store`.
- Sandboxed plugins provide a delete button; deleting an active plugin automatically falls back to `'classic'`.
- **Import Plugin Modal (`Sheet`)**:
  - Displays sandbox security guarantees and data boundaries.
  - "Load sample template" button provides an instant, fully functioning neon glassmorphic sample template (`sample-neon-player`), demonstrating how external skins bind cover art (with automatic local `bbebee-file://` projection), synced/unsynced lyrics, dynamic progress bar with seek, and playback control actions via `window.BBeBeePlayer.onSnapshot`.
  - Supports direct JSON manifest paste or local `.json` file upload.
  - Validates required fields (`id`, `name`, `htmlContent`) and prevents collisions with built-in style IDs.
  - `buildSandboxedHtml` dynamically injects the `window.BBeBeePlayer` client SDK and base styles into `<head>` for full HTML documents, or wraps bare HTML snippets with the standard document shell.

### 11.3 Track Playback Info Modal & Metadata Inspection (`TrackInfoModal`)
- **Right-Click Context Menu ("See what's playing")**:
  - The now-playing surface hooks `useTrackMenu(ctx, { onShowTrackInfo })` providing a `track-info` item with icon `info-circle`.
  - Opens `TrackInfoModal` (`Sheet`) aggregating technical specifications and storage origin:
    - **Local Tracks**: Title, artist, album, storage category (`Local music file`), filename, absolute filesystem path (with 1-click clipboard copy + feedback), formatted file size, and last modified timestamp.
    - **Third-Party Tracks**: `sourceId`, `sourceTrackId` (parsed from track URN).
    - **Audio Technical Specs**: Track duration, sample rate (e.g. `44,100 Hz`), channels (e.g. `2 (Stereo)`), bitrate (e.g. `920 kbps`), codec (e.g. `FLAC`, `M4A`), tag types (e.g. `Vorbis, ID3v2.3`, `ID3v2` or `Online streaming`).
  - Read sources: the aggregation is headless — `resolveTrackDetails` / `useTrackDetails` in `@BBeBee/plugin-now-playing/hooks` reads `ctx.db` (`media_bindings`, `scan_entries`), `ctx.codec.readMetadata`, `ctx.fs.stat`, and live `ctx.player.currentStream`, falling back stepwise; the modal only renders the returned rows.

### 11.4 Adaptive Title Wrapping
- **Two-Line Title Wrapping**: Across all built-in layouts (`ClassicLayout`, `FullCoverLayout`, `VinylLayout`, `CinematicLayout`), track titles wrap adaptively up to 2 lines (`numberOfLines: 2` or `-webkit-line-clamp: 2`). Longer titles truncate with ellipsis at the end of line 2, preventing horizontal overflow or collision with playback controls.

---

## 12. Share UI & Card Rendering

The canvas-parity architecture constraint (no DOM-tree previews for canvas exports) is normative
in [rules/ui.md §10.1](../../rules/ui.md#101-live-canvas-rendering-architecture-100-dual-engine-parity) (L2).

### 12.1 Live Canvas Preview
- `ShareCardPreview` embeds a live `<canvas width={540} height={960} style={{ width: 252, height: 448 }} />` directly rendering via `drawTrackCard`, `drawPlaylistCard`, `drawAlbumCard`, and `drawLyricsCard`.
- The modal preview is mathematically identical (2x Retina sharpness) to the exported PNG image.

### 12.2 Card Geometry & Typography Hierarchy
- **Non-Distorting Center-Cropped Artwork (`drawImageCover`)**:
  - Image artwork must never be stretched or aspect-ratio distorted. `drawImageCover(ctx, img, x, y, w, h)` performs center-crop object-fit cover based on source and destination aspect ratios.
- **Adaptive Text Wrapping (`wrapText`)**:
  - Titles, artists, composer metadata, and lyric lines wrap gracefully up to 3 lines (`maxLines = 3`).
  - Ellipsis (`…`) is appended if text exceeds the third line.
  - Uses binary search with CJK and Western word boundary detection.
- **Typography Scale**:
  - Card Title: `bold 26px`, line-height `34px`, crisp `#FFFFFF`.
  - Artist / Subtitle: `500 18px`, line-height `26px`, secondary `#B3B9C9`.
  - Lyrics: `bold 22px`, line-height `34px`, crisp `#FFFFFF`.
- **Vertical Spacing & Logo Positioning**:
  - The BBeBee brand logo (`110px` wide, ~`24px` high) is placed directly beneath the artist/subtitle/lyrics with a compact `10px` gap (`gapAboveLogo`).
  - Bottom padding is strictly `18px` (`gapBelowLogo`).
  - Card height adaptively wraps content (`cardH = naturalCardH`), eliminating large empty voids beneath the logo.

### 12.3 Component Extraction & High-Cohesion Modals
Share dialogs (`ShareTrackModal`, `SharePlaylistModal`, `ShareAlbumModal`, `ShareLyricsModal`) are factored into single-responsibility reusable components:
- `ShareModalHeader`: Unified modal header bar with close button.
- `BackgroundModeSelector`: Compact toggle capsule for "Cover theme", "Half-height gradient" (50% transition to black), and "Solid black".
- `LocalSourceWarning`: Red warning banner (`data-testid="local-source-warning"`) alerting that local-only tracks cannot be shared across devices.
- `DisabledReasonToast`: Informative amber toast (`data-testid="copy-disabled-reason-toast"`) explaining why a disabled action cannot proceed when clicked.
- `ShareActionButtons`: Encapsulates "Copy" (Base64) and "Save image" (PNG with LSB steganography), handling copying states, generation spinners, and disabled states.
- `useShareModalState`: Unified hook encapsulating theme color extraction (`useImageColor`), artwork resolution (`useResolvedArtwork`), local source checks (`isLocalSource`), clipboard copy fallbacks, and toast timers.

### 12.4 Lyrics Share Card Dimensions (Full Poster vs Inner Card Only)
- **Scope Toggle**: `ShareLyricsModal` provides a segmented scope selector: **Full poster (large image)** (`full`) vs **Inner card only (small image)** (`card`), controlled by `RenderLyricsCardOptions.cardOnly`.

---

## 13. Source Badges, Pagination & Original Resources

Platform Invariant 1 (`openExternalUrl`, no platform SDK imports in UI packages) is normative in
[rules/ui.md §11](../../rules/ui.md#11-third-party-source-badges-half-page-pagination--original-resources) (L2).

### 13.1 Source Badge in Detail Headers
- **Visual Presentation**: When an album or playlist originates from a third-party source (`isThirdParty`), the header hero node mounts a compact, gray-framed badge in the top-right corner (`top: 24, right: 32`):
  - `album-source-badge` / `playlist-source-badge`
  - Style: `border: '1px solid rgba(255, 255, 255, 0.2)'`, `borderRadius: 4`, `padding: '3px 8px'`, `color: '#A0A0A0'`, font size 12px.
- **Local Source Immunity**: User-created local playlists (`BBeBee:local:playlist:...`) do NOT display a third-party source badge, even if they contain songs sourced from third-party providers.

### 13.2 Half-Page Infinite Scroll Pagination
- **Chunked Loading**: Third-party albums and playlists avoid fetching all tracks at once; requests use `PageRequest` with a default page size of 30.
- **Half-Page Trigger Line**:
  - `ListProps` accepts `pageSize?: number`.
  - When provided, the virtual list computes a threshold index at the halfway mark of the current final page:
    `thresholdIndex = Math.max(0, count - pageSize) + Math.floor((count - Math.max(0, count - pageSize)) / 2)`
  - The scroll listener checks if the scroll offset exceeds `scrollMargin + thresholdIndex * estimateItemHeight`.
  - `onEndReached` triggers only upon real user scroll past this halfway mark, and `firedFor.current = count` prevents re-firing for the same item count.
  - This eliminates infinite fetch loops on initial mount when short lists fit entirely within the viewport.

### 13.3 Context Menu "Open original resource" & Safe External Navigation
- **Menu Registration**: Track, Album, and Playlist right-click / more context menus register `open-original-resource` ("Open original resource") with icon `external-link` (mapped to Tabler `share-box`).
- **Canonical URL Resolution (`resolveOriginalResourceUrl`)**:
  - Automatically parses canonical web URLs from URNs, track metadata, and raw IDs for:
    - Bilibili: Video BV IDs (`https://www.bilibili.com/video/BV...`), AV IDs, seasons (`ss...`), series (`series...`), and user collections/favorites (`ml...`).
    - NetEase Cloud Music: Track / album / playlist web URLs.
    - QQ Music: Song / album / playlist web URLs.
    - YouTube: Watch / playlist URLs.
    - Direct HTTP/HTTPS fallback: Any valid web URL provided in `track.originalUrl` or `item.id`.


