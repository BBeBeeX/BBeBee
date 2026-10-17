# UI Architecture & Design Rules

Rules for writing views, design tokens, hooks, and descriptors in BBeBee.
This file is the **normative (L2)** surface: hard constraints, invariants, and conventions.
Design specifications, visual values, and screen-level behaviour live in
[docs/ui/design-system.md](../docs/ui/design-system.md) **(L3)**.

> **L2 · When to read**: when writing or modifying any UI package — the three-package convention, public subpaths, hooks, hard visual constraints, the sandboxed-skin red lines.
> **What goes wrong without it**: business logic written twice across the two UI packages, deep-import boundary violations, hardcoded colors breaking Light Mode, `backgroundColor` swallowing gradients.
> **Deeper reading**: docs/ui/design-system.md (design specs and visual detail), docs/ui/architecture.md (shell and rendering principles).

---

## 1. The Three-Package Convention

Any UI-bearing feature is split into up to three packages:

```
packages/feature/plugin-library/            ← headless (L4): state, services, hooks, logic
packages/ui/plugin-library-ui-mobile/       ← React Native views (L5)
packages/ui/plugin-library-ui-desktop/      ← React DOM views (L5)
```

> **A UI package contains no business logic that would need to be written twice.**
> If an `if` branch would exist identically in both UI packages, it belongs in the headless package.

View packages import from headless packages through **public subpaths only**:
- Types and models
- Shared custom hooks (`@BBeBee/plugin-library/hooks`)
- Descriptor view IDs (`@BBeBee/plugin-library/views`)
- Never deep-import into `src/*` of another package.

### 1.1 Package Internal Organization & Single Responsibility Principle (SRP)

UI packages (`-ui-desktop`, `-ui-mobile`, and UI kit packages) must not be written as giant monolithic files; code is organized into single-responsibility submodules (the canonical directory tree is in [docs/ui/architecture.md §1.1](../docs/ui/architecture.md#11-package-internal-organization--component-decomposition)):

1. **No Monolithic Single-File Packages**: Screens, modals, and row components must be factored into their own files under `src/components/` (incl. `components/modals/`, `components/sections/`) or `src/screens/`.
2. **UI Kit Component Extraction**: UI kit packages split styling primitives into `primitives.ts` and atomic controls into `src/components/*.tsx`, barrel re-exported through `src/index.tsx`.
3. **Menu Controller Decomposition**: complex context menu packages separate submenu builders into `src/submenus/*.ts`, menu hooks into `src/menus/*.ts`, and anchor/controller utilities into `src/types.ts`.
4. **Multi-Mode Screen Decomposition**: screens with multiple display modes isolate view modes into `src/components/views/*`, action and hydration logic into `src/hooks/*` (`useLibraryHydration`, `useLibraryActions`, `useTableSort`), and control toolbars into `src/components/*`.
5. **Pure Helper Hoisting**: pure helpers that calculate or format domain data across multiple packages belong in `@BBeBee/toolkit`, never copy-pasted inside UI packages. Shared React service *bindings* (the hooks that read a service and need `ctx`) live in the `@BBeBee/toolkit/hooks` subpath — `serviceOf`, `useServiceState`, `useResolvedArtwork`, `useTransport`, … — so a view package never has to import *another* feature package for one; a feature's own `./hooks` subpath stays its public surface.
6. **Thin Plugin Entry**: `src/index.tsx` is the Cordis plugin lifecycle entry (`apply(ctx)`) registering routes/slots/views, and the barrel re-export surface for backwards compatibility and tests.

---

## 2. Descriptors, Not Components

Plugins never pass React components directly to the shell or core services.
Instead, they register serializable **descriptors** (`route`, `slot`, `command`, `settings`, `menu`, `tray`):

```ts
// Minimal shape only — the full contribution contract (every kind, every field,
// and the UiService surface) is specified in
// [docs/ui/architecture.md §2](../docs/ui/architecture.md#2-contributions-are-descriptors).
ctx.ui.contribute({ kind: 'slot', id: 'library.like-button', slot: 'now-playing.actions', order: 10 })
ctx.ui.contribute({
  kind: 'settings',
  id: 'player.transition',
  section: 'playback',
  title: 'Transition & crossfade',
  order: 20,
  fields: [/* simple key/value config is declared as data — never a hand-written form component */],
})
```
Each shell resolves the contribution ID against its target view registry via `ctx.ui.registerView(id, bound(ctx, Component))`.

> ⚠️ **Always register a component bound to your plugin context**:
> The shell context only has `ctx.ui`. Reaching for `ctx.player` from the shell context throws.
> Each view package binds to its own context: `bound(ctx, ScreenComponent)`.

> 💡 **Decoupled Bottom Bar Actions, Settings, and TopBar Tray**:
> - Icons on the right side of `NowPlayingBar` (such as `mini-player.button`, `desktop-lyrics.toggle`, `queue.button`) are contributed to `'now-playing.actions'`, never hardcoded.
> - Settings rows and cards are contributed via `ctx.ui.contribute({ kind: 'settings', ... })` or `ctx.settings.contribute(...)`, never hardcoded into Settings screens. The settings screen does exactly three things: group contributions by `section`, sort by `order` and render them; subscribe to `settings/contributions-changed` (and `ui/changed`) to refresh; render empty/disabled states. Its source must contain no business field names owned by other plugins (no `desktopLyrics`, `keybindings`, `proxy`, …) and must not import any `plugin-*` business package — unloading a plugin makes its section disappear with no hole and no error.
> - Desktop TopBar features a Windows-like system tray toggle button beside the "Import & Share" button (chevron-down when collapsed, chevron-up when expanded). Plugins determine whether to show in the main interface/tray via `placement: ['tray']` on their route or via `TrayContribution`. Clicking an icon navigates to that plugin's view in the main window (`ctx.ui.navigate`) and closes the tray popover.

> 🔒 **Declarative Source Configuration Modals**:
> Source configuration forms (`SourceConfigureModal` in desktop and mobile) must only render input fields explicitly declared by the source (`doc.params`, `doc.loginUi`, `doc.loginType`, `doc.sourceGroup`). They must never include freeform key-value dictionary editors (e.g. "Add variable" rows) for undeclared variables, nor show host fields for fixed-endpoint sources. When no configurable parameters are declared, render a localized empty-state notice (`sources:sourceConfigure.noConfigurableParams`).

---

## 3. Hooks & State Binding

- `@BBeBee/toolkit/hooks` provides `useService` and `useServiceState(key, events, select)` backed by `useSyncExternalStore`; `@BBeBee/ui-core` re-exports them, so existing imports keep working.
- No `useEffect` for domain mutations (call service methods directly).
- Optimistic updates must reside in the service, not in React component state.
- Lists must be virtualized:
  - Mobile: `@shopify/flash-list` (`FlashList`)
  - Desktop: `@tanstack/react-virtual`

### Service access through `serviceOf`
- UI components must access services through `serviceOf(ctx, key)`; raw member access such as `(ctx as any)[key]` is forbidden.
- `serviceOf` returns a Cordis proxy — **never** place it in a `useEffect` / `useCallback` dependency array; resolve it inside the effect body, or depend only on stable primitives.

---

## 4. Visual Design Language & Color System

> Design spec and details: see [docs/ui/design-system.md §6](../docs/ui/design-system.md#6-multi-theme-color-system--visual-identity) (L3). This section keeps only the hard constraints.

### Component Tokenization & Contrast Protection Rule
- **No Hardcoded Foreground Colors**: Components in `packages/ui/*` must never hardcode `#FFFFFF` or `#000000` for general text, titles, borders, or icons. Always use semantic CSS variables (`var(--bb-text-primary, #FFFFFF)`, `var(--bb-text-secondary, #8E8E93)`, `var(--bb-bg-overlay)`, `var(--bb-border-subtle)`, `currentColor`).
- **Fixed Dark Container Exception**: Containers with fixed black backgrounds (e.g. Dynamic Island `#000000` / `#0A0A0F`, floating translucent HUDs, error/danger badges, or artwork overlays) must preserve light/white foregrounds or use on-color tokens (`var(--bb-accent-on, #FFFFFF)`, `var(--bb-state-error-on, #FFFFFF)`). Never convert text inside fixed black containers to `var(--bb-text-primary)` as it would produce dark text on black in light mode.

### CSS Shorthand & Styling Rule
> ⚠️ **Always use `background:` instead of `backgroundColor:` for theme tokens:**
> CSS variables like `--button-primary-bg`, `--playing-item-indicator`, or `--gradient-brand` evaluate to `linear-gradient(...)`.
> In CSS engines, `backgroundColor` discards `linear-gradient` as invalid CSS, rendering elements transparent. Use the shorthand `background:` everywhere theme tokens or gradients can be assigned.

### 4.1 Tabler Icons & Stroke Standard (`stroke = 1.25`)

> The icon registry list (`ICON_ALIASES`) and the size scale: see [docs/ui/design-system.md §6.9](../docs/ui/design-system.md#69-iconography--stroke-standard-tabler-icons-stroke--125) (L3).

1. **Global Stroke Width**: Standardized strictly to `stroke="1.25"` (`DEFAULT_STROKE_WIDTH = 1.25` in `packages/ui/ui-kit-desktop/src/icons/tabler.ts`).
2. **Zero Handwritten SVG / Unicode Glyphs**: Never use raw unicode/emoji glyphs (e.g. `▶`, `⏸`, `🗑`, `✕`, `♡`, `⚙`, `🔍`) or ad-hoc `<svg>` elements in UI components. All icons must be rendered via `tablerIcon(name, props)`, `TablerIcon`, or components consuming `IconName` (e.g. `IconButton`, `EmptyState`). **Mobile exception**: there is no Tabler set on React Native, so `ui-kit-mobile`'s `ContextMenu` maps the shared menus' icon names to unicode glyphs (`MENU_ICON_GLYPHS`); a name without a mapping is hidden rather than rendered as raw text.
3. **Accessible Rendering**: SVG icons render with `aria-hidden="true"` and `data-icon="{name}"`. Tests assert against `querySelector('[data-icon="..."]')` or `data-testid`, never `textContent`.

---

## 5. Desktop Settings Center & Diagnostics Specifications

> Layout spec, the contribution-domain list and diagnostics details: see [docs/ui/design-system.md §7](../docs/ui/design-system.md#7-desktop-settings-center--layout--diagnostics) (L3).

The settings screen owns none of the contributed domains. Each is contributed by the
plugin that owns the behaviour; platform settings with no owning feature are
contributed by the composition roots, which are also where they are applied.
Section ids are stable, so the tab list is the union of the kept settings-own
sections (`general`, `about`) and whichever sections currently have
contributions — a plugin's section disappears when the plugin does.

---

## 6. Library Sidebars & Context Menus Specification

> Layout modes and menu visual spec: see [docs/ui/design-system.md §8](../docs/ui/design-system.md#8-library-sidebar-modes--context-menu-design) (L3).

### Context Menu Design Standards
- **Folder (Collection) Semantics**: Folders are directory containers for collection-level entities (playlists, albums, artists, child folders). Folders **never** contain individual tracks; individual tracks belong to playlists and albums. Track context menus only offer "Add to playlist" (`add-to-playlist`), never "Add to collection / Move to folder" (`add-to-collection`).
- **Recursive Track Gathering**: When adding a folder's contents to other playlists ("Add to another playlist") or playing a folder, `collectAllFolderTracks` (exported from `@BBeBee/plugin-library/hooks`) recursively scans all nested playlist tracks, nested album tracks, and all descendant subfolders without duplicates (folders do not contain direct tracks).

---

## 7. Detail Screens, Sorting & Playback History Specifications

> Layout spec, sorting interactions, batch operations, local-music dual views, play history and the recommendation shelves: see [docs/ui/design-system.md §9](../docs/ui/design-system.md#9-detail-screens-sorting--playback-history) (L3).

### Track Table Sorting & Row Interactions (`AlbumScreen`, `PlaylistDetailScreen`, `LocalMusicScreen`, `FavoritesScreen`, `CollectionScreen`)
- **Strict Track Deduplication**:
  - `AlbumScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, and `LocalMusicScreen` filter raw tracks/items by track URN (`seen = new Set<string>()`), ensuring duplicate rows are never rendered, preventing virtual list key collisions, and eliminating multi-selection count discrepancies.
- **Favorite Dual-Write Invariant**: A track's "loved" lives in two stores — `track_stats.loved` (what the row's heart draws and the catalogue's `onlyLoved` answers) and its `library_items` row (what the Favorites shelf reads). **Every writer writes both**, catalogue first so the `library/changed` event the shelf write fires sees the final state: the row button, the track context menu (`trackMenuItems`), and the popover's liked toggle (`useSaveToPlaylistMenu.onToggleLiked`). A writer that touches only one store leaves a hearted track missing from Favorites — or an unfavorited row still drawing a heart.
- **Playback Queue Coherence**:
  - Playing a single track or clicking "Play All / Play Album" passes the currently sorted/filtered track URN sequence to `ctx.player.playFromContext`.
  - Up-next playback order strictly follows the visual sorted order on screen.
- **Playlist Item ID Decoupling**:
  - `PlaylistDetailScreen` wraps row data as `{ item, track, trackUrn, originalIndex }` so that row actions (removal, context menus) remain bound to `PlaylistItem.id`, immune to active sort orders.

### 7.1 Synchronized Page Marquee & Truncation Tooltip Standards
- **Responsive Hover Delay**: `HoverLabel` display delay is standardized to 200～300ms (default 250ms), dismissed immediately on pointer leave. Tooltips only trigger when text is genuinely truncated (`isElementTruncated`: `scrollWidth > clientWidth` or line clamped); fully visible text remains quiet without duplicate popovers.
- **Unified 15-Second Page Marquee Timeline & Uniform Pixel Speed**:
  - Across detail screens (`AlbumScreen`, `PlaylistDetailScreen`, `LocalMusicScreen`), Now Playing full-screen views (`NowPlayingScreen`), sticky headers, and the bottom transport bar (`NowPlayingBar`), all visible truncated titles participate in a unified **15-second cycle timeline** (`PageMarqueeProvider`).
  - **Uniform Pixel Speed (40px/s)**: All titles scroll forward and return at strictly the same actual pixel speed (`sharedSpeed = 40px/s`). Titles must NEVER vary their velocity to stretch or compress into arbitrary percentages.
  - **15-Second Time Window Allocation**:
    - `0 ~ 2.25s (0% ~ 15%)`: Initial static pause at origin for reading.
    - `2.25s ~ 7.5s (15% ~ 50%)`: Forward scroll at uniform 40px/s. Short/medium titles reach their end early, stop moving, and hold still.
    - `7.5s ~ 9.75s (50% ~ 65%)`: Standardized end-pause phase.
    - `9.75s ~ 15.0s (65% ~ 100%)`: Return scroll at uniform 40px/s. Titles reaching origin early hold still at origin until the 15s cycle completes.
  - **Oversized Title Overflow Strategy**: Titles with overflow exceeding standard single-cycle capacity (>210px) smoothly continue scrolling at 40px/s, execute a 2.25s end pause, return at 40px/s, and harmonic-align to an exact multiple of 15s ($N \times 15\text{s}$, e.g. 30s) without jumping or secretly changing speed.
  - **Bottom Bar Inclusion**: The desktop shell (`Shell.tsx`) provides `PageMarqueeProvider` at the root, ensuring `NowPlayingBar` shares the identical time base, phase, and speed as page content.
  - Non-truncated titles remain completely static. Virtualization via `IntersectionObserver` suspends off-screen animations.
  - Tooltip interaction must not interrupt or reset the running marquee timeline. System `prefers-reduced-motion` degrades to static ellipsis.

---

## 8. Mini Player & Dynamic Island Desktop Specifications

Rules for desktop floating mini player, Dynamic Island secondary windows, and gestures.
Window states, sizes, shadows and glass material spec: see [docs/ui/design-system.md §10](../docs/ui/design-system.md#10-mini-player--dynamic-island) (L3).

### Gesture-First Interaction & Clutter Elimination
- **Zero Redundant Action Buttons**: Do **not** render explicit buttons for "Collapse Dynamic Island", "Detach", or "Snap to top". All mode transitions are driven by natural gestures.

### Secondary Window Artwork Safety
- **Chromium Local Resource Boundary**: Secondary window renderers block raw `file://` URLs.
- All local cover image paths must be translated from `file://` to `bbebee-file://` via `resolveArtworkUri()`.
- Artwork elements (`IslandArtwork`) must specify `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"`, with graceful SVG fallback on image load errors.

### Cordis Injection Invariant in Secondary Window Actions
- When dispatching playback actions from a secondary window service, the service class must declare `static inject = ['player']` and the plugin module must export `inject = ['player']`.
- Accessing `this.ctx.player` without explicit injection throws Cordis proxy violations at runtime (`cannot get property "player" without inject`).

---

## 9. Now Playing Layout Styles & Sandboxed Dynamic Import

Rules for full-screen player layout templates, sandboxed plugin execution, and settings integration.
Layout templates, settings integration and the track-info modal: see [docs/ui/design-system.md §11](../docs/ui/design-system.md#11-now-playing-layout-styles) (L3).

### 9.1 Built-in Layout Styles
> The five built-in layout templates: see [docs/ui/design-system.md §11.1](../docs/ui/design-system.md#111-built-in-layout-styles) (L3).

### 9.2 Sandboxed External Plugin Dynamic Import (Option B)
External developers can create custom HTML/CSS/JS player skins and users can dynamically import them. The security boundary is a hard constraint:

- **Strict Iframe Sandbox Isolation**: rendered with `<iframe sandbox="allow-scripts" />` — `allow-same-origin` is strictly omitted, resulting in `origin: null`. This completely blocks access to the host DOM, `parent.window`, cookies, local storage, the desktop host/Node runtime, and arbitrary network/filesystem access.
- **Strict Data Whitelist (`SandboxPlayerSnapshot`)**: the host only pushes a sanitized, read-only playback snapshot via `postMessage` (`{ type: 'NOW_PLAYING_SNAPSHOT', payload }`), with exactly these fields: `cover` (local file URIs are automatically projected to `bbebee-file://` to prevent Chromium local origin blocks), `coverThemeColor`, `title`, `artist`, `album`, `lyrics` (synchronized `{ timeMs, text, translation }[]` plus `activeIndex`), `positionMs`, `durationMs`, `isPlaying`, `isLoved`.
- **Strict Action Whitelist (`SandboxPlayerAction`)**: sandboxed scripts may only emit whitelisted actions back to the host — `action:play`, `action:pause`, `action:togglePlay`, `action:previous`, `action:next`, `action:seek` (with `positionMs`), `action:toggleFavorite`. The host validates all incoming messages before calling transport services.
- **Injected Client SDK (`window.BBeBeePlayer`)**: the iframe host automatically injects a lightweight SDK bridge via `buildSandboxedHtml` (injecting into `<head>` for full HTML documents or wrapping HTML fragments):
  - `onSnapshot(callback)` (aliased as `onStateChange(callback)`): registers state listener, immediately triggers with current snapshot if already available, and returns an unsubscribe disposer `() => void`.
  - `getState()`: synchronously returns the latest `SandboxPlayerSnapshot | null`.
  - Controls: `play()`, `pause()`, `togglePlay()`, `previous()`, `next()`, `seek(positionMs)`, `toggleFavorite()`.
  - Lifecycle: dispatches `{ type: 'BBEBEE_SANDBOX_READY' }` on mount to request initial snapshot.

### 9.3 Settings UI Integration (`NowPlayingStylesSection`)
> See [docs/ui/design-system.md §11.2](../docs/ui/design-system.md#112-settings-ui-integration-nowplayingstylessection) (L3).

### 9.4 Track Playback Info Modal & Metadata Inspection (`TrackInfoModal`)
> See [docs/ui/design-system.md §11.3](../docs/ui/design-system.md#113-track-playback-info-modal--metadata-inspection-trackinfomodal) (L3).

### 9.5 Adaptive Title Wrapping & Chrome Clipping Preventions
- **Volume Popover Portal Pattern**:
  - `VolumeControl` in `NowPlayingBar` supports `portal: true`. When active, it computes the trigger button's screen coordinates via `getBoundingClientRect()` and mounts the vertical slider via React `createPortal` to `document.body` at `zIndex: 1000`.
  - Prevents the volume popover from being clipped by bottom bar parent containers with `overflow: hidden` or full-screen now playing pane transitions.

---

## 10. Share UI & Card Rendering Engine (`plugin-share-ui-desktop`)

Rules and design standards governing music sharing modals, live canvas rendering, and visual steganography generation.
Card geometry, typography and component decomposition spec: see [docs/ui/design-system.md §12](../docs/ui/design-system.md#12-share-ui--card-rendering) (L3).

### 10.1 Live Canvas Rendering Architecture (100% Dual-Engine Parity)
- **Eliminating Dual-Engine Divergence**: Previews must **not** use HTML/CSS DOM trees if the final exported asset is a Canvas image. Flexbox layout, font baseline alignment, kerning, and subpixel rounding inevitably diverge between HTML DOM and Canvas 2D contexts — the preview renders through the same canvas draw functions as the export.

### 10.2 Card Geometry & Typography Hierarchy
> See [docs/ui/design-system.md §12.2](../docs/ui/design-system.md#122-card-geometry--typography-hierarchy) (L3).

### 10.3 Component Extraction & High-Cohesion Modals
> See [docs/ui/design-system.md §12.3](../docs/ui/design-system.md#123-component-extraction--high-cohesion-modals) (L3).

### 10.4 Lyrics Share Card Dimensions (Full Poster vs Inner Card Only)
> See [docs/ui/design-system.md §12.4](../docs/ui/design-system.md#124-lyrics-share-card-dimensions-full-poster-vs-inner-card-only) (L3).

---

## 11. Third-Party Source Badges, Half-Page Pagination & Original Resources

Rules for third-party indicators in detail screens, infinite scroll pagination, and navigation to original web resources.
Badge visuals, the pagination formula and original-resource resolution details: see [docs/ui/design-system.md §13](../docs/ui/design-system.md#13-source-badges-pagination--original-resources) (L3).

#### 11.1 Source Badge in Detail Headers
> See [docs/ui/design-system.md §13.1](../docs/ui/design-system.md#131-source-badge-in-detail-headers) (L3).

#### 11.2 Half-Page Infinite Scroll Pagination
> See [docs/ui/design-system.md §13.2](../docs/ui/design-system.md#132-half-page-infinite-scroll-pagination) (L3).

#### 11.3 Context Menu "Open original resource" & Safe External Navigation
> Menu registration and URL resolution details: see [docs/ui/design-system.md §13.3](../docs/ui/design-system.md#133-context-menu-open-original-resource--safe-external-navigation) (L3). Platform Invariant 1 is preserved here:

- **Platform Invariant 1 Preservation (`openExternalUrl`)**:
  - UI packages must NEVER import platform SDKs (such as `@tauri-apps/*`, `expo-*`, `react-native` native modules).
  - `openExternalUrl(url)` calls `window.BBeBee?.shell?.openExternal(url)` if present, gracefully falling back to `window.open(url, '_blank')`.
