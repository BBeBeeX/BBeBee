# UI Architecture & Design Rules

Rules for writing views, design tokens, hooks, and descriptors in BBeBee.

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

UI packages (`-ui-desktop`, `-ui-mobile`, and UI kit packages) must not be written as giant monolithic files. Instead, code is organized into single-responsibility submodules:

```
packages/ui/<package>/src/
├── components/          ← Reusable presentation components, rows, artwork, cards
│   ├── sections/        ← Partitioned feature sections (e.g. settings categories)
│   └── modals/          ← Dedicated dialogs and modal flows
├── screens/             ← Dedicated view/screen components (e.g. SearchScreen, PlaylistDetailScreen)
├── hooks/               ← UI-specific custom React hooks
├── utils/               ← Pure UI data transformers and helpers
└── index.tsx            ← Thin Cordis plugin entry point (`apply(ctx)` registering views/descriptors)
                         and barrel re-exports of screens/components for backwards compatibility & tests
```

Key rules:
1. **No Monolithic Single-File Packages**: Screens, modals, and row components must be factored into their own files under `src/components/`, `src/components/modals/`, or `src/screens/`.
2. **UI Kit Component Extraction**: UI kit packages (`ui-kit-mobile`, `ui-kit-desktop`) split styling and primitives into `primitives.ts`, individual atomic controls into `src/components/*.tsx` (Button, Text, TextField, Slider, Sheet, ContextMenu, List, Artwork, TrackRow, Toast, JsonTree), and barrel re-export through `src/index.tsx`.
3. **Menu Controller Decomposition**: Complex context menu packages (`ui-menus`) separate submenu builders into `src/submenus/*.ts`, menu hooks into `src/menus/*.ts`, and anchor/controller utilities into `src/types.ts`.
4. **Multi-Mode Screen Decomposition**: Screens with multiple display modes or complex interaction trees (such as `LibraryScreen`) isolate view modes into `src/components/views/*` (`CollapsedLibraryView`, `ExpandedLibraryView`, `SidebarFolderView`), action and hydration logic into `src/hooks/*` (`useLibraryHydration`, `useLibraryActions`, `useTableSort`), and control toolbars into `src/components/*` (`LibraryToolbar`, `LibraryModals`, `LibraryCreateDropdown`).
5. **Pure Helper Hoisting**: Pure helpers that calculate or format domain data across multiple packages (e.g. `formatDuration`, `formatTotalDuration`, `splitArtists`) belong in `@BBeBee/toolkit` (Layer 4 pure library), never copy-pasted or duplicated inside UI packages.
6. **Thin Plugin Entry**: `src/index.tsx` serves as the Cordis plugin lifecycle entry (`apply(ctx)`) registering routes/slots/views, while re-exporting components and public utilities to maintain 100% test compatibility.

---

## 2. Descriptors, Not Components

Plugins never pass React components directly to the shell or core services.
Instead, they register serializable **descriptors** (`route`, `slot`, `command`, `settings`, `menu`, `tray`):
```ts
// Slot contribution (e.g. action button beside player transport)
ctx.ui.contribute({
  kind: 'slot',
  id: 'library.like-button',
  slot: 'now-playing.actions',
  order: 10,
})

// Settings contribution (e.g. feature configuration section or navigation link)
ctx.ui.contribute({
  kind: 'settings',
  id: 'settings.dsp',
  section: 'audio',
  title: '音频音效',
  display: 'card',
  order: 10,
})

// Route with tray placement (shows in desktop TopBar tray popover)
ctx.ui.contribute({
  kind: 'route',
  id: 'dsp.view',
  path: '/dsp',
  title: '音频效果 (DSP)',
  icon: 'tune',
  placement: ['tray'],
  order: 65,
})
```
Each shell resolves the contribution ID against its target view registry via `ctx.ui.registerView(id, bound(ctx, Component))`.

> ⚠️ **Always register a component bound to your plugin context**:
> The shell context only has `ctx.ui`. Reaching for `ctx.player` from the shell context throws.
> Each view package binds to its own context: `bound(ctx, ScreenComponent)`.

> 💡 **Decoupled Bottom Bar Actions, Settings, and TopBar Tray**:
> - Icons on the right side of `NowPlayingBar` (such as `mini-player.button`, `desktop-lyrics.toggle`, `queue.button`) are contributed to `'now-playing.actions'`, never hardcoded.
> - Settings rows and cards are contributed via `ctx.ui.contribute({ kind: 'settings', ... })` or `ctx.settings.contribute(...)`, never hardcoded into Settings screens.
> - Desktop TopBar features a Windows-like system tray toggle button beside the "Import & Share" button (chevron-down when collapsed, chevron-up when expanded). Plugins determine whether to show in the main interface/tray via `placement: ['tray']` on their route or via `TrayContribution`. Clicking an icon navigates to that plugin's view in the main window (`ctx.ui.navigate`) and closes the tray popover.

---

## 3. Hooks & State Binding

- `@BBeBee/ui-core` provides `useService` and `useServiceState(key, events, select)` backed by `useSyncExternalStore`.
- No `useEffect` for domain mutations (call service methods directly).
- Optimistic updates must reside in the service, not in React component state.
- Lists must be virtualized:
  - Mobile: `@shopify/flash-list` (`FlashList`)
  - Desktop: `@tanstack/react-virtual`

---

## 4. Visual Design Language & Color System

The visual presentation is an **immersive, character-inspired dark music player aesthetic** rooted in the brand visual identity:

### 4.1 Primary Visual Identity: Bee Music · Cyber Neon
The default visual identity is extracted directly from the character visual reference:
- **Core Palette**: Black + White high contrast tech body + Ice Blue & Electric Blue glowing wing roots + Periwinkle & Lavender wing feathers + Soft Violet tips & glow + Deep Blue/Navy shadows.
- **Continuous Spectrum**: Gradients (`--gradient-brand`, `--gradient-progress`, `--gradient-blue-violet`, `--gradient-ice`) flow through the continuous blue-violet light spectrum instead of relying on a single static brand color.
- **Subtle Neon Glow & Soft Glass**: Tiered neon glows (`--glow-xs` through `--glow-lg`, `--glow-blue-*`, `--glow-purple-*`) and translucent elevated surfaces create depth without heavy borders.
- **Alternate Themes**: Built-in `Spotify Classic` (`#1DB954` green) and runtime user-imported custom themes via `ctx.theme`.

### Surface Hierarchy & Receding Chassis
- `bg.sunken` (`#000000` / `var(--player-bg)`): Outer chassis, desktop sidebar rail, and persistent bottom player bar (solid `#000000`, border-free). Recedes completely so artwork and active content stand out.
- `bg.base` (`#080A10` / `var(--bg-primary)`): Main scrollable canvas.
- `bg.raised` (`var(--surface-1)` / `var(--surface-2)`): Media cards (album/playlist tiles) and elevated panels.
- `bg.overlay` (`var(--surface-hover)` / `var(--surface-selected)`): Modal dialogs, context menus, tooltips, hover states.
- `border.subtle` (`var(--border-subtle)`): Hairline dividers.
- `border.strong` (`var(--border-focus)`): Accessible focus outlines.
- **Dynamic Background Gradients**: Detail views (Album, Favorites, Local Music, Playlist, Settings) use reactive background gradients mapped to `--surface-hover` / `--surface-selected` / `--surface-1` / `--bg-primary`, smoothly adapting whenever the active theme changes.

### CSS Shorthand & Styling Rule
> ⚠️ **Always use `background:` instead of `backgroundColor:` for theme tokens:**
> CSS variables like `--button-primary-bg`, `--playing-item-indicator`, or `--gradient-brand` evaluate to `linear-gradient(...)`.
> In CSS engines, `backgroundColor` discards `linear-gradient` as invalid CSS, rendering elements transparent. Use the shorthand `background:` everywhere theme tokens or gradients can be assigned.

### Signature Accent & Contrast
- **Bee Music Neon Accent**: Electric Blue (`#4D8BFF`), Lavender/Periwinkle (`#9087FF`), Soft Violet (`#B47BFF`), and continuous gradient fills for primary play buttons, active row titles, and progress scrubber fill.
- **High-Contrast Text**: `#FFFFFF` (`text.primary`) for titles and active items; `#C5CAD8` (`text.secondary`) for secondary text; `#8B95B0` (`text.tertiary`); `#4B5368` (`text.disabled`).
- Text on saturated button gradients maintains WCAG AA compliant contrast.

### Typography (Geometric Grotesque)
- Stack: `"Circular Std", Circular, Montserrat, Figtree, system-ui, -apple-system, Roboto, sans-serif`.
- Heavy/Bold (`900`/`700`) for headers, Medium (`500`) for track titles, Regular (`400`) for secondary metadata.

### Controls & Micro-interactions
- Controls are **pill-shaped (`radius.pill: 999`)**; buttons grow slightly on hover (`scale(1.04)` over 120ms).
- Primary play buttons: circular with high-contrast icon over vibrant gradient fill (`background: var(--gradient-brand)`).
- Track rows: 56px height, show play toggle on hover, active playing track glows with brand accent and an equalizer icon.
- Sliders: slim 3px track height, subtle dark track, filled with brand gradient (`var(--gradient-progress)`). Circular thumb handle is hidden on idle (`opacity: 0`) and smoothly reveals on hover or active dragging (`opacity: 1`).
- Scrollbars: 4px width/height, transparent track background, high-transparency thumb (`rgba(255, 255, 255, 0.2)` default, `0.4` on hover).
- Dynamic Theme Management in Settings:
  - Supports switching between built-in themes and importing custom themes via `.json` file upload or raw JSON paste.
  - Automatically merges imported tokens over `midnightPurpleTheme.tokens` to guarantee complete token sets.
  - Allows deleting custom themes with instant fallback to default if currently active; built-in themes are protected from deletion.
- TopBar Search & 2×2 Matrix:
  - Centered input in TopBar with dynamic icon transition (idle: left `12px`; active/focused: slides to far right `12px` as a clickable submit button; resets on outside-click or Escape).
  - 2×2 Matrix floating dropdown reveals below input:
    - Row 1: "搜索范围" (`Search Scope`) | "搜索历史" (`Search History`) + high-transparency "清空" (`Clear`) button.
    - Row 2: Third-party music source toggle buttons (via `useSearchSourceSelection(ctx)` with all/none toggles) | Search history tags (saved in `localStorage`, click to execute).
  - Enter, clicking the right search icon, or selecting a history tag commits to history and routes to `sources.search` with `{ query }`. `SearchScreen` automatically runs `searchAll(query)`.
- Sidebar & Navigation Exclusions:
  - Left navigation rail strictly hosts content and library browsing (`library.view`, `history.view`, playlists).
  - `settings.view` and `sources.search` are explicitly excluded from sidebar rendering. Settings is opened via the TopBar user avatar; Search is driven by the TopBar search bar.
- TopBar placement & queue drawer:
  - The TopBar sits directly above the main view — inside the main card normally, inside the expanded library pane when that takes over — while the library column runs the full window height (its top edge is the window's top edge).
  - The queue opens as a right-side drawer that overlays the content (`position: absolute` within the workspace grid, below the 48px top bar so the window controls stay reachable). It takes no grid column, so opening it resizes nothing; the queue splitter adjusts its width and double-click resets it to the default (340px).
  - The queue drawer never ejects the page it was opened from: `ui/navigate 'queue.view'` only toggles the drawer. Over the fullscreen play page the drawer rises above the play-page overlay (`zIndex: 120` vs the overlay's 100; 40 otherwise) and the queue splitter with it (125), so the queue is usable from the play page; only the share modals (130) and the desktop lyrics window (9999) sit above it.
  - The fullscreen play page (`now-playing.view`) is an overlay stacked on the shell — opaque, fixed, z-index 100, a late child of the shell root — never an early-return branch swap. The shell and every cached page stay mounted underneath, so returning from the play page finds each page's local state, scroll and subscriptions intact. A branch swap unmounts all cached pages and was the reason page state evaporated (docs/ui/architecture.md §7.1.5).
  - The library sidebar's quick entries (喜欢 / 本地和下载) highlight from the shell's real current route (`activeViewId` prop), never from `ui/navigate` events — shell-internal navigation (album detail, back/forward, home) emits none.
  - Queue rows in the desktop queue drawer drag to reorder (native HTML5 DnD, no dependency) and accept Alt+↑/↓. The drop gap in the visible play order is translated to a queue row index by `upcomingDropToQueueIndex` (`plugin-queue-ui-desktop/src/reorder.ts`); dragging is disabled while shuffle is on because the visible order is then a permutation, not the rows.
- Bottom player bar: Solid black (`#000000`), border-free (`borderTop: none`). Center cluster order is `[PlayMode] [Previous] [Play/Pause] [Next] [Volume]`. Play mode cycles sequence/single-loop/list-loop/shuffle. Volume icon indicates sound state (muted `volume-off` or loudness wave tiers `volume-3` / `volume-2` / `volume`) and clicks to pop up a vertical volume bar with a bottom mute toggle.
- Track context menus on the player surfaces:
  - The bar's cover and the fullscreen play page both right-click to the same track menu model (`trackMenuItems`); the play page passes the playing queue entry's id (`state.currentItemId`, queue-row fallback by `trackUrn`) so 从队列中移除 targets the real queue row, and the lyric text it already renders as `TrackMenuOptions.lyrics` — that option is what makes 分享歌词 offerable; the model never fetches lyrics itself.
  - Both surfaces resolve the playing track through `useCurrentTrack` (`plugin-now-playing-ui-desktop/src/hooks.ts`): catalogue copy when the sources service knows it, a shell built from the transport's now-playing metadata otherwise.
  - The fullscreen bar renders inside an `overflow: hidden` container whose footer slides via `transform` — either clips or re-anchors fixed menus — so the shell passes it `portalMenus: true` and the kit mounts `ContextMenu`/`SaveToPlaylistPopover` on `document.body` (`portal` prop).

### 4.1 Tabler Icons & Stroke Standard (`stroke = 1.25`)
All visual icons across desktop UI components are standardized on **Tabler Icons SVG paths**:
1. **Global Stroke Width**: Standardized strictly to `stroke="1.25"` (`DEFAULT_STROKE_WIDTH = 1.25` in `packages/ui/ui-kit-desktop/src/icons/tabler.ts`).
2. **Zero Handwritten SVG / Unicode Glyphs**: Never use raw unicode/emoji glyphs (e.g. `▶`, `⏸`, `⏮`, `⏭`, `🗑`, `✕`, `＋`, `♡`, `♥`, `⬇`, `⏱`, `📁`, `🗂`, `💿`, `🎵`, `♪`, `⋯`, `📌`, `▲`, `▼`, `✓`, `🕒`, `🔀`, `⚙`, `≣`, `🔍`) or ad-hoc `<svg>` elements in UI components. All icons must be rendered via `tablerIcon(name, props)`, `TablerIcon`, or components consuming `IconName` (e.g. `IconButton`, `EmptyState`). **Mobile exception**: there is no Tabler set on React Native, so `ui-kit-mobile`'s `ContextMenu` maps the shared menus' icon names to unicode glyphs (`MENU_ICON_GLYPHS`); a name without a mapping is hidden rather than rendered as raw text.
3. **Semantic Registry**: `packages/ui/ui-kit-desktop/src/icons/registry.ts` provides centralized alias mappings (`ICON_ALIASES`) mapping semantic names to Tabler definitions:
   - Navigation & search: `home`, `search`
   - Playback & volume: `play-filled`, `pause-filled`, `skip-back`, `skip-forward`, `volume`, `volume-2`, `volume-3`, `volume-off`
   - Modes: `shuffle`, `repeat`, `repeat-once`, `list-numbers`
   - Curation & actions: `heart`, `heart-filled`, `plus`, `minus`, `trash`, `x`, `pin`, `pencil`, `download`, `clock`, `history`, `playlist`, `list`, `arrows-sort`, `dots`, `folder`, `music`, `disc`, `playlist-add`
   - **Add-to-list semantics**: "加入歌单 / 添加至其他歌单 / 添加（歌单详情）" actions use a bare `plus`; "加入播放列表" (enqueue to the play queue) uses `playlist-add` (list + plus) to keep the two apart.
   - Direction & UI: `chevron-left`, `chevron-right`, `chevron-down`, `chevron-up`, `check`, `alert`, `settings`, `adjustments`
4. **Standard Sizing & Scale**: Default icon size is `28px` (`DEFAULT_ICON_SIZE = 28` in `tabler.ts`). Tokens standard: `tokens.size.icon: 24`, `tokens.size.iconLarge: 32`. Sizing scale:
   - `sm`: 16–20px (table row actions, column headers, metadata badges)
   - `md`: 22–24px (sidebar nav, action bars, slider thumbs, standard buttons)
   - `lg`: 28–32px (transport play controls, modal headers)
   - `xl`: 36–52px (large hero play buttons, empty states)
5. **Accessible Rendering**: SVG icons render with `aria-hidden="true"` and `data-icon="{name}"`. Tests assert against `querySelector('[data-icon="..."]')` or `data-testid`, never `textContent`.

### Artwork & Fallback
- Artwork renders `blurhash` first, then falls back to `artworks.dominant_color`.
- If no cover exists, generate a GitHub-style square identicon from entity URN (`identicon()` in `ui-core`).
- Cache integration: Covers resolve through `ctx.cache` (`useResolvedArtwork` in `@BBeBee/plugin-cache/hooks`).

---

## 5. Desktop Settings Center & Diagnostics Specifications

### Layout & Navigation Principles
- **Single-page vertical scrolling**: All setting categories reside simultaneously in the DOM tree, browsed via natural window scrolling. Avoid nested scroll containers inside sections.
- **Text-only tab bar**: Header tab bar contains pure text labels (no icons), providing smooth anchor jumping via `scrollIntoView({ behavior: 'smooth' })`.
- **Card-level hierarchy**: Use muted translucent backgrounds (`rgba(255, 255, 255, 0.03)`) for section cards with generous whitespace, rather than wrapping individual setting rows into isolated cards.
- **Consistent row components**:
  - `Boolean` → `Switch`
  - `Enum` → `Select` dropdown
  - `Number` → `Slider`
  - `Text` → `Input`
  - `Action` → `Button`
  - `Nested/Expanded` → Chevron expandable row

### Dedicated Domains in Settings
- **General & Language**: Language selector; minimize to system tray on window close (`closeToTray`). (Theme selection is omitted on desktop to preserve the immersive dark streaming look).
- **Playback & Audio**: Crossfade, gapless playback, pause on unplug, and an action button to open the dedicated DSP Equalizer view (`dsp.view`).
- **Desktop Lyrics**: Master enable switch, position persistence (`{ x, y }`), locked click-through toggle, single/double line mode, left/center/right alignment, custom font family and size (16–48px), color palette with hex input, opacity (0.2–1.0), live floating preview card, and strict 4-step startup lifecycle (1. check enabled → 2. restore position → 3. push settings & data → 4. show window).
- **Global Hotkeys**: Master toggle (enabled by default) and 10 standard media/navigation bindings (`togglePlay`, `prev`, `next`, `volumeUp`, `volumeDown`, `seekForward`, `seekBackward`, `toggleLyrics`, `toggleApp`, `favorite`), backed by `ctx.device.registerHotkey`.
- **Network & Proxy**: Master toggle, protocol (HTTP/HTTPS/SOCKS5), host/port, latency probe button targeting Google (`https://www.google.com/generate_204`), and per-source proxy bypass switches embedded directly within the proxy card.
- **Storage & Cache**: Download and Cache directories with path badges, native folder picker (`dialog.pickDirectory`), and directory opener (`shell.openPath`).
- **About & Advanced Settings (Diagnostics Guard)**: App metadata, followed by an "Advanced Settings" ("高级设置") expandable toggle button that houses Developer Diagnostics (`debug.view`, `debug.logs`, `debug.http-logs`) and the Danger Zone (settings reset), keeping primary settings clean.

### Diagnostics System
- `debug.view`: Debug mode indicator, environment specs (Node, Electron, OS, Chromium, paths), and quick links to log screens.
- `debug.logs`: Discover live ring-buffer logs (`ctx.logBuffer`) with level filters, search, and NDJSON export.
- `debug.http-logs`: Outgoing HTTP requests from third-party music sources, detailing method, status code, latency, and URL.

---

## 6. Library Sidebars & Context Menus Specification

### Library Layout Modes
- **Collapsed Mode (72px)**: Minimal compact rail showing icon tiles. Folders render dedicated folder outline SVG icons. Entering a folder reveals a `chevron-left` return button beneath the top logo to return to the root library.
- **Sidebar Mode (260–340px)**: Standard library navigation. Folders feature inline expand/collapse via rotating chevron indicators (`chevron-down` / `chevron-right`), indenting children by 28px left padding. Clicking the folder row navigates into the folder details screen (`chevron-left 文件夹名称`).
- **Expanded Mode (Full Canvas)**: High-density 3-column table view with breadcrumbs (`音乐库 < 文件夹名称`), interactive search, and responsive sizing.

### Context Menu Design Standards
- **Dark Card Theme**: `#242424` background, 8px border radius, 4px padding, `0 12px 32px rgba(0,0,0,0.55)` depth shadow, and 1px border (`rgba(255, 255, 255, 0.08)`).
- **Dividers**: Menu items support `divider: true` to render a 1px translucent separator line (`rgba(255, 255, 255, 0.08)`).
- **Section Headings**: Menu items support `heading: true` to render as a flush-left muted section label (12px padding, no 18px icon slot, no hover highlight, smaller bold type) — use it to name a group of options, with `divider: true` on the preceding item to close the previous group.
- **Outline Icons**: Standard actions map to Tabler SVG icons (`stroke: 1.25`): `pencil`, `trash`, `pin`, `plus`, `folder`, `play-filled`, `download`, `playlist`.
- **Folder (Collection) Semantics**: Folders are directory containers for collection-level entities (playlists, albums, artists, child folders). Folders **never** contain individual tracks; individual tracks belong to playlists and albums. Track context menus only offer "添加到歌单" (`add-to-playlist`), never "加入合集 / 移动至文件夹" (`add-to-collection`).
- **Recursive Track Gathering**: When adding a folder's contents to other playlists ("添加至其他歌单") or playing a folder, `collectAllFolderTracks` recursively scans all nested playlist tracks, nested album tracks, and all descendant subfolders without duplicates (folders do not contain direct tracks).
- **Dedicated Modals**:
  - `EditPlaylistModal`: Modify cover art (file picker or URL), title, and multiline description.
  - `RenameFolderModal`: Rename folder title and save via `ctx.library.renameCollection`.
  - `ConfirmDeleteModal`: Secondary confirmation modal for destructive deletion of playlists and albums. Displays entity-specific warning ("确定要删除歌单“{name}”吗？此操作无法撤销。" / "确定要从音乐库中删除专辑“{name}”吗？") with a high-danger action button and cancel option; supports `Escape` dismissal. Deletion only executes after explicit confirmation.
- **Album Context Menu**:
  - Album rows support right-click / context menu actions matching playlist aesthetics: `delete-album` (danger tone with divider, opens `ConfirmDeleteModal` to remove from library and folders), `toggle-pin` (pin/unpin album), and `add-to-collection` (move to folder, subfolder, or root).
- **Folder Mobility & Root List Coherence**:
  - Playlists nested inside folders are automatically hidden from the library's root list (`containedPlaylistUrns`). Moving a playlist back to the root level restores it to the root list immediately.
  - Context menus for entities inside folders provide a "移至根目录" option and automatically remove the item from the source folder when moving to another destination folder, with instant 0ms optimistic UI updates.
- **Viewport Boundary Awareness**:
  - Context submenus (Flyouts) dynamically compute horizontal (left/right) and vertical (up/down) flipping relative to the viewport.
  - Submenu height is dynamically clamped (`maxHeight = Math.max(120, viewportHeight - flyoutTop - 8)`) with internal scrolling (`overflowY: 'auto'`), guaranteeing that nested menus never overflow the application window boundary.

---

## 7. Detail Screens, Sorting & Playback History Specifications

### Collapsing Header & Cover Theming (`AlbumScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, `LocalMusicScreen`)
- **Spotify-style collapsing header**: The detail page's hero and action bar live in the list's `header` slot (`List` from `ui-kit-desktop`), scrolling away with the content. The `StickyDetailBar` slides down from above the viewport as the header's big play button approaches, leaving title + play button + the table header. The **table header pins just below the bar** once scrolled past — via the `List`'s `stickyHeader` slot, because as a direct child of the scroller it is the only placement where `position: sticky` actually holds (nested inside the header it is its parent's last child and can never stick). Local Music's 专辑 (albums) tab, which is not virtualised, reproduces the identical structure with the page's own scroll container.
- **Sticky bar contract**: The bar is passed as the `List`'s `sticky` slot — a **direct child of the scroller** (`position: sticky` only sticks within its parent's box; nesting it in the header would scroll it away exactly when it finishes arriving). The choreography is **measured, not assumed** (`useDetailBarCollapse`): every scroll event reads the anchor's (the big play button's) distance to the scrollport top; the bar slides in over the button's last stretch of approach and **docks when its edge has covered half the button's height** — the bar's own compact play button scales in at that moment (the absorb action), the title has finished fading in, and the table header sits pinned right beneath the bar with a solid background so rows slide under it. `pointer-events` follows the slide so the ghost of the bar never eats a click meant for the hero.
- **Table header hover**: By default the table header shows **no sort arrows at all**. Hovering it reveals hairline column separators (`boxShadow` insets, so no layout shift), lights the sorted column's directional arrow, and shows a dimmed sort hint on every not-currently-sorted column.
- **Shared detail-page primitives**: the four pages are assemblies, not copies. `ui-kit-desktop` owns `DetailTableHeader` (sticky sort header, columns as config — width/flex/align/icon/plain/visible), `DetailPlayButton` (the circular primary play button) and `DetailHero` (eyebrow / two-line-clamped title / subtitle / meta slot / cover slot); `ui-menus` owns `sortMenuItems` (the sort dropdown's entries with check marks, divider, 升序/降序); `plugin-library-ui-desktop` owns `LibraryTrackRow` (the track row shared by 本地/收藏/歌单, with per-page extras as props: album link, added-date column, remove button). A new detail page assembles these instead of re-deriving them.
- **Cover-tinted theming, header-scoped**: The gradient lives on the **scrolling header area only** (`headerGradient(tint)` on the header node) — percentage stops land it exactly on `--bg-primary` at the header's bottom edge, so the tint scrolls away with the header and everything below (rows, pinned table header) sits on the same solid colour. The sticky bar's wash takes the cover's `dominantColor` (Album / Playlist — first track's artwork when the playlist has none), resolved via `useResolvedArtwork` + `useImageColor` with a one-shot canvas extraction fallback; an unreadable or missing cover falls back to the neutral brand gradient. Favorites pins the liked-songs purple (`#450af5`) as its identity tint; Local Music keeps the neutral gradient.
- **Long titles truncate**: the album/playlist hero title line-clamps at two lines (`-webkit-line-clamp`), never breaking the layout.

### Track Table Sorting & Row Interactions (`AlbumScreen`, `PlaylistDetailScreen`, `LocalMusicScreen`, `FavoritesScreen`, `CollectionScreen`)
- **Interactive Header Columns**:
  - Clicking column headers (`#`, `标题`, `专辑`, `添加日期`, `时长` with Tabler `clock` icon, `播放量`) toggles between ascending (`asc`) and descending (`desc`) order.
  - Active sorted column displays a subtle directional arrow indicator (`chevron-up` for ascending, `chevron-down` for descending).
  - Column headers omit the legacy checkmark, presenting clean column names and the Tabler `clock` icon.
- **Action Bar Sort Dropdown (`ContextMenu`)**:
  - Dedicated sort dropdown button (e.g. `默认顺序` / `自定义顺序` / `标题` accompanied by Tabler `arrows-sort` or `list` icon).
  - Clicking reveals a structured `ContextMenu` with sort key options and an asc/desc toggle option.
- **View Mode Section in the Sort Menu (`viewModeMenuItems`)**:
  - The sort menu ends with a 视图模式 section: a hairline divider closes the sort options, then a flush-left `heading` 视图模式 label and one entry per mode with a check icon on the active one.
  - Album / Playlist / Favourites / Local-tracks offer 紧凑 (compact) and 列表 (list); the local-albums tab adds 平铺 (tiled, the card grid).
  - 紧凑 drops the artwork and promotes artists to their own column (table header included); 列表 matches the historical row.
  - The choice persists per page in `localStorage` (`bbebee_view_mode:<key>` via `useViewMode` from `ui-kit-desktop`).
- **Unified Row Library Action Button (`TrackLibraryActionButton`) & Popover**:
  - Replaces previous static checkmark or favorite icon in track rows across `LocalMusicScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, and `CollectionScreen`.
  - Hidden by default; smoothly fades in on row hover (`opacity: 1`).
  - **Not in library**: displays `plus` icon (`tablerIcon('plus')`), clicking adds track directly to favorites — writing **both stores**: `sources.setLoved(track.urn, true)` first, then `library.setSaved(track.urn, true)` (see the dual-write invariant below).
  - **In library / favorites / playlist / collection**: displays `heart-filled` (green heart via `tablerIcon('heart-filled')`), clicking opens a dedicated Spotify-style `SaveToPlaylistPopover` instead of a raw context menu:
    - Real-time search filter for existing playlists;
    - Inline "新建歌单" quick creation input with `plus` icon;
    - "已点赞的歌曲" group with immediate favorite toggle;
    - Playlist rows with checkbox toggles and folder rows expanding nested sub-playlists;
    - Viewport boundary detection with horizontal/vertical auto-flipping and clamping;
    - A tall, steady presence: minimum height 480px (folder flyout 320px), capped by the viewport — a menu that collapses to three rows reads as broken.
  - **In-library state is live, never a snapshot**: rows take `inLibrary` from `useTrackLibraryInfo.isTrackInLibrary` — the real-time saved set (`useSaved(ctx, 'track')`, reloaded on `library/changed`) with the row's possibly-stale `track.loved` only filling in what live data has not answered yet; the hook re-reads the changed URNs' loved flags from the catalogue on every `library/changed` event. Hardcoding `inLibrary: true` (a row being in a playlist does not mean it is favourited) or trusting a mount-time snapshot is how "unfavourited but still a heart" bugs happen.
- **Favourite Dual-Write Invariant**: A track's "loved" lives in two stores — `track_stats.loved` (what the row's heart draws and the catalogue's `onlyLoved` answers) and its `library_items` row (what the Favourites shelf reads). **Every writer writes both**, catalogue first so the `library/changed` event the shelf write fires sees the final state: the row button, the track context menu (`trackMenuItems`), and the popover's liked toggle (`useSaveToPlaylistMenu.onToggleLiked`). A writer that touches only one store leaves a hearted track missing from Favourites — or an unfavourited row still drawing a heart.
- **Playback Queue Coherence**:
  - Playing a single track or clicking "Play All / Play Album" passes the currently sorted/filtered track URN sequence to `ctx.player.playFromContext`.
  - Up-next playback order strictly follows the visual sorted order on screen.
- **Playlist Item ID Decoupling**:
  - `PlaylistDetailScreen` wraps row data as `{ item, track, trackUrn, originalIndex }` so that row actions (removal, context menus) remain bound to `PlaylistItem.id`, immune to active sort orders.
- **Album Screen Customizations (`AlbumScreen`)**:
  - Header Action Bar heart toggle: wired to `library.isSaved(album.urn)` / `library.setSaved(album.urn, isSaved)` with immediate reactivity, synchronizing saved albums to the Library albums tab.
  - Local album safety: detects `urn.startsWith('BBeBee:local:')` to omit download button in header and row items, and removes download menu item.
  - Three-dot menu: "加入合集" renamed to "加入文件夹", "添加至最喜欢的音乐" updated to "添加到音乐库/从音乐库中删除", redundant "加入歌单" and "转至专辑" items removed.
- **Favorites Screen Parity (`FavoritesScreen`)**:
  - Aligned with `LocalMusicScreen`: liked-songs purple gradient on the header area (`#450af5` via `headerGradient`, content below solid), no-cover text Hero Header ("已点赞的歌曲"), action bar with 56px play button (`play-filled`), shuffle (`shuffle`), search input, and sort dropdown (`arrows-sort`).
  - Rows render as `FavoriteTrackTableRow`: index/hover play, 40px cover art, title/artist, album, hover `TrackLibraryActionButton` (`heart-filled` / `heart` submenu), hover `dots` more button, and duration.

### Local Music Dual Views & Pagination (`LocalMusicScreen`)
- **Full Loading (No 100 Limit)**:
  - Uses `fetchAllLocalTracks` and `fetchAllLocalAlbums` to recursively paginate in batches of 500 until all scanned files are retrieved, overcoming default 100-item page boundaries.
- **View Toggle**: Segmented toggle in header to switch between "歌曲" (Tracks table) and "专辑" (Albums grid).
- **Local Album Grid (`LocalAlbumCard`)**:
  - Groups local tracks by album name, deriving artwork from the first track with artwork.
  - Cards display album cover, title, artist, and track count.
  - Hovering reveals a green play button (`play-filled`) for instant playback of the album's tracks.
  - Clicking the card navigates directly to the album view (`album.view`).
- **Album Grid Sorting**: Action bar sort menu dynamically adapts when album view is active, providing album-specific sort keys: default order, album title, artist, release year, track count.

### Playback History & Recent Plays (`HistoryScreen` & `QueueScreen`)
- **Strict Deduplication by `trackUrn`**:
  - Both desktop and mobile `HistoryScreen` and the desktop `QueueScreen` "最近播放" tab de-duplicate playback entries by `trackUrn`, retaining only the most recent playback record.
  - Preserves latest playback timestamp, relative time display, and completion/skipped badges.
  - Headless batch metadata loading (`useTracksByUrn`) only resolves the deduplicated URN list, avoiding redundant catalogue lookups.
- **Play Count Indicator**:
  - `HistoryScreen` calculates cumulative play frequency per track across the history dataset.
  - Displays a pill badge (`播放 N 次`) in the row metadata area.
- **Header Count & Empty State Alignment**:
  - Header record counts (`最近播放记录 (${uniqueRecords.length} 首)`) and empty state guards evaluate against deduplicated records.

---

## 8. Mini Player & Dynamic Island Desktop Specifications

Rules for desktop floating mini player, Dynamic Island secondary windows, and gestures:

### Multi-State Window Model
- **Floating Mini Player (`normal`)**: 380×96px floating pill. Provides album artwork, track title, artist, seek scrubber, and transport controls. Body is draggable (`-webkit-app-region: drag`), controls are interactive (`-webkit-app-region: no-drag`). Includes restore main window (`⤢`) and close (`✕`).
- **Dynamic Island Capsule (`attached`)**: 280×50px pill docked flush at the center top of the active display. Shows track title, artist, and live equalizer wave bars (`IslandWaveBars`). Single click or downward drag expands; double click collapses.
- **Expanded Dynamic Island (`expanded`)**: 420×184px card docked at the top. Shows large artwork, marquee text, animated wave bars, timeline scrubber, and transport controls. Double-clicking background collapses back to capsule; dragging downward past threshold (>60px) detaches into floating mode.

### Gesture-First Interaction & Clutter Elimination
- **Zero Redundant Action Buttons**: Do **not** render explicit buttons for "折叠灵动岛", "脱离吸附", or "吸附到顶部". All mode transitions are driven by natural gestures:
  - Dragging floating player near top edge (≤40px) automatically snaps to Dynamic Island.
  - Dragging Dynamic Island downwards (>60px) automatically detaches into floating player.
  - Single click on Dynamic Island capsule expands to card.
  - Double clicking Dynamic Island background collapses to capsule.

### Shadow & Border Luminance Standards
- **Transparent Window Glow Prevention**: Never use wide blur radii (>30px) or `0 0 0 1px` white outer rings on transparent secondary windows, which create exaggerated fuzzy halos.
- **Crisp Multi-Tier Black Shadows**:
  - Floating player: `0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)` (hover: `0 10px 24px rgba(0, 0, 0, 0.55)`).
  - Island capsule: `0 4px 12px rgba(0, 0, 0, 0.45)`.
  - Expanded island: `0 12px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)`.
- **Subtle Glass Border**: Border must use low-opacity white stroke (`1px solid rgba(255, 255, 255, 0.08)`), blending seamlessly with `rgba(18, 18, 18, 0.85)` dark glass and `backdrop-filter: blur(24px)`.

### Secondary Window Artwork Safety
- **Chromium Local Resource Boundary**: Secondary window renderers block raw `file://` URLs.
- All local cover image paths must be translated from `file://` to `bbebee-file://` via `resolveArtworkUri()`.
- Artwork elements (`IslandArtwork`) must specify `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"`, with graceful SVG fallback on image load errors.

### Cordis Injection Invariant in Secondary Window Actions
- When dispatching playback actions from a secondary window service, the service class must declare `static inject = ['player']` and the plugin module must export `inject = ['player']`.
- Accessing `this.ctx.player` without explicit injection throws Cordis proxy violations at runtime (`cannot get property "player" without inject`).

---

## 9. Now Playing Layout Styles & Sandboxed Dynamic Import

Rules for full-screen player layout templates, sandboxed plugin execution, and settings integration:

### 9.1 Built-in Layout Styles
The app provides 5 built-in layout styles managed by `ctx.nowPlaying`:
1. **`classic`** (Default): Centered artwork, song title and artist below, transport controls at bottom, collapsible lyrics panel on the right.
2. **`cinematic`** (16:9 映画歌词):
   - 16:9 centered stage (`aspectRatio: '16 / 9'`), maximum width 1240px.
   - Neutral dark base (`#0D1118`) with large cover backdrop (`opacity: 0.34`, `blur: 3.5px`, `scale 2`, centered) revealing artwork silhouette — cinematic film-reel atmosphere.
   - Left section (~46% width): square album artwork (up to 460px) with crisp white border (`2px solid rgba(255, 255, 255, 0.9)`), sharp corners (`borderRadius: 2`), and pronounced double-layer bottom-right shadow (`12px 16px 5px` + `20px 28px 56px`).
   - Right section: cursive/handwriting title (`Caveat` → `Segoe Print` → `cursive`, 46px, aligned not higher than cover top), muted artist, cinematic subtitle-style synchronized lyrics, then organic waveform + progress bar + larger cursive italic timestamps with text shadow, aligned not lower than cover bottom.
   - The lyric list (shared `CinematicLyricsTemplate`) scrolls with the scrollbar hidden in both synced and plain modes (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }` via an injected rule) — the list is the stage, not a document; auto-follow pauses on wheel/touch and offers a 回到当前歌词 pill.
   - Waveform is shorter than progress bar with fine tapered ends.
   - **No playback control buttons and no style switcher button on screen** — pure cinematic immersion; top-left return and top-right window controls auto-hide when mouse is away from top bar.
3. **`full-cover`**: Fullscreen blurred cover background, glassmorphism overlay, floating translucent transport controls.
4. **`vinyl`**: Circular spinning vinyl record animation with concentric groove sheen and center album label.
5. **`compact`**: Side-by-side widescreen layout with large artwork on the left and vertical metadata/controls/lyrics stream on the right.

### 9.2 Sandboxed External Plugin Dynamic Import (Option B)
External developers can create custom HTML/CSS/JS player skins and users can dynamically import them.

- **Strict Iframe Sandbox Isolation**:
  - Rendered using `<iframe sandbox="allow-scripts" />` (strictly omitting `allow-same-origin`, resulting in `origin: null`).
  - Completely blocks access to host DOM, `parent.window`, cookies, local storage, Electron/Node runtime, and arbitrary network/filesystem access.
- **Strict Data Whitelist (`SandboxPlayerSnapshot`)**:
  - The host only pushes a sanitized, read-only playback snapshot via `postMessage`:
    - `cover`: Safe artwork URL or `null`.
    - `coverThemeColor`: Vibrant dominant cover theme hex color extracted via `useImageColor` (e.g. `'#3A5F7D'`).
    - `title`: Song title.
    - `artist`: Author / artist name.
    - `album`: Album name.
    - `lyrics`: Array of synchronized `{ timeMs, text, translation }` lines and current `activeIndex`.
    - `positionMs` & `durationMs`: Playback position and total length in milliseconds.
    - `isPlaying`: Playback active status.
    - `isLoved`: Track favorite status.
- **Strict Action Whitelist (`SandboxPlayerAction`)**:
  - Sandboxed scripts may only emit whitelisted actions back to the host:
    - `action:play`, `action:pause`, `action:togglePlay`
    - `action:previous`, `action:next`
    - `action:seek` (with `positionMs`)
    - `action:toggleFavorite`
  - Host validates all incoming messages before calling transport services.
- **Injected Client SDK (`window.BBeBeePlayer`)**:
  - The iframe host automatically injects a lightweight SDK bridge:
    - `window.BBeBeePlayer.onSnapshot(callback)`
    - `window.BBeBeePlayer.play()` / `pause()` / `togglePlay()`
    - `window.BBeBeePlayer.previous()` / `next()`
    - `window.BBeBeePlayer.seek(positionMs)`
    - `window.BBeBeePlayer.toggleFavorite()`

### 9.3 Settings UI Integration (`NowPlayingStylesSection`)
- Mounted at the top of the "播放与音频 (`PlaybackSection`)" settings tab.
- **Style Cards Grid**: Displays each style's name, description, tabler icon, author/version, and "官方内置" vs "沙箱 🛡️" badge.
- Clicking any card switches the active style immediately and persists to `settings.nowPlayingStyle` and `ctx.store`.
- Sandboxed plugins provide a delete button; deleting an active plugin automatically falls back to `'classic'`.
- **Import Plugin Modal (`Sheet`)**:
  - Displays sandbox security guarantees and data boundaries.
  - "载入示例模板" button provides an instant, fully functioning neon glassmorphic sample template.
  - Supports direct JSON manifest paste or local `.json` file upload.
  - Validates required fields (`id`, `name`, `htmlContent`) and prevents collisions with built-in style IDs.

### 9.4 Track Playback Info Modal & Metadata Inspection (`TrackInfoModal`)
- **Right-Click Context Menu ("查看播放内容")**:
  - The now-playing surface hooks `useTrackMenu(ctx, { onShowTrackInfo })` providing a `track-info` item with icon `info-circle`.
  - Opens `TrackInfoModal` (`Sheet`) aggregating technical specifications and storage origin:
    - **Local Tracks**: Title, artist, album, storage category (`本地音乐文件`), filename, absolute filesystem path (with 1-click clipboard copy + feedback), formatted file size, and last modified timestamp.
    - **Third-Party Tracks**: `sourceId` (e.g. `bilibili`), `sourceTrackId` (parsed from track URN).
    - **Audio Technical Specs**: Track duration, sample rate (e.g. `44,100 Hz`), channels (e.g. `2 (立体声 Stereo)`), bitrate (e.g. `920 kbps`), codec (e.g. `FLAC`, `M4A`), tag types (e.g. `Vorbis, ID3v2.3`, `ID3v2` or `在线流媒体`).
  - Read sources: `ctx.db` (`media_bindings`, `scan_entries`), `ctx.codec.readMetadata`, and live `ctx.player.currentStream`.

### 9.5 Adaptive Title Wrapping & Chrome Clipping Preventions
- **Two-Line Title Wrapping**:
  - Across all built-in layouts (`ClassicLayout`, `FullCoverLayout`, `VinylLayout`, `CinematicLayout`), track titles wrap adaptively up to 2 lines (`numberOfLines: 2` or `-webkit-line-clamp: 2`). Longer titles truncate with ellipsis at the end of line 2, preventing horizontal overflow or collision with playback controls.
- **Volume Popover Portal Pattern**:
  - `VolumeControl` in `NowPlayingBar` supports `portal: true`. When active, it computes the trigger button's screen coordinates via `getBoundingClientRect()` and mounts the vertical slider via React `createPortal` to `document.body` at `zIndex: 1000`.
  - Prevents the volume popover from being clipped by bottom bar parent containers with `overflow: hidden` or full-screen now playing pane transitions.

---

## 10. Share UI & Card Rendering Engine (`plugin-share-ui-desktop`)

Rules and design standards governing music sharing modals, live canvas rendering, and visual steganography generation.

### 10.1 Live Canvas Rendering Architecture (100% Dual-Engine Parity)
- **Eliminating Dual-Engine Divergence**:
  - Previews must **not** use HTML/CSS DOM trees if the final exported asset is a Canvas image. Flexbox layout, font baseline alignment, kerning, and subpixel rounding inevitably diverge between HTML DOM and Canvas 2D contexts.
  - `ShareCardPreview` embeds a live `<canvas width={540} height={960} style={{ width: 252, height: 448 }} />` directly rendering via `drawTrackCard`, `drawPlaylistCard`, `drawAlbumCard`, and `drawLyricsCard`.
  - The modal preview is mathematically identical (2x Retina sharpness) to the exported PNG image.

### 10.2 Card Geometry & Typography Hierarchy
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

### 10.3 Component Extraction & High-Cohesion Modals
Share dialogs (`ShareTrackModal`, `SharePlaylistModal`, `ShareAlbumModal`, `ShareLyricsModal`) are factored into single-responsibility reusable components:
- `ShareModalHeader`: Unified modal header bar with close button.
- `BackgroundModeSelector`: Compact toggle capsule for "纯主题色" (Cover theme), "半高渐变" (50% transition to black), and "纯黑底色" (Black).
- `LocalSourceWarning`: Red warning banner (`data-testid="local-source-warning"`) alerting that local-only tracks cannot be shared across devices.
- `DisabledReasonToast`: Informative amber toast (`data-testid="copy-disabled-reason-toast"`) explaining why a disabled action cannot proceed when clicked.
- `ShareActionButtons`: Encapsulates "复制" (Base64) and "保存图片" (PNG with LSB steganography), handling copying states, generation spinners, and disabled states.
- `useShareModalState`: Unified hook encapsulating theme color extraction (`useImageColor`), artwork resolution (`useResolvedArtwork`), local source checks (`isLocalSource`), clipboard copy fallbacks, and toast timers.

### 10.4 Lyrics Share Card Dimensions (Full Poster vs Inner Card Only)
- **Scope Toggle**:
  - `ShareLyricsModal` provides a segmented scope selector: **整张海报 (大图)** (`full`) vs **仅内部卡片 (小图)** (`card`).
  - Controlled by `RenderLyricsCardOptions.cardOnly`.
---

## 11. Third-Party Source Badges, Half-Page Pagination & Original Resources

Rules for third-party indicators in detail screens, infinite scroll pagination, and navigation to original web resources:

#### 11.1 Source Badge in Detail Headers
- **Visual Presentation**: When an album or playlist originates from a third-party source (`isThirdParty`), the header hero node mounts a compact, gray-framed badge in the top-right corner (`top: 24, right: 32`):
  - `album-source-badge` / `playlist-source-badge`
  - Style: `border: '1px solid rgba(255, 255, 255, 0.2)'`, `borderRadius: 4`, `padding: '3px 8px'`, `color: '#A0A0A0'`, font size 12px.
- **Local Source Immunity**: User-created local playlists (`BBeBee:local:playlist:...`) do NOT display a third-party source badge, even if they contain songs sourced from third-party providers.

#### 11.2 Half-Page Infinite Scroll Pagination
- **Chunked Loading**: Third-party albums and playlists avoid fetching all tracks at once; requests use `PageRequest` with a default page size of 30.
- **Half-Page Trigger Line**:
  - `ListProps` accepts `pageSize?: number`.
  - When provided, the virtual list computes a threshold index at the halfway mark of the current final page:
    `thresholdIndex = Math.max(0, count - pageSize) + Math.floor((count - Math.max(0, count - pageSize)) / 2)`
  - The scroll listener checks if the scroll offset exceeds `scrollMargin + thresholdIndex * estimateItemHeight`.
  - `onEndReached` triggers only upon real user scroll past this halfway mark, and `firedFor.current = count` prevents re-firing for the same item count.
  - This eliminates infinite fetch loops on initial mount when short lists fit entirely within the viewport.

#### 11.3 Context Menu "跳转原始资源" & Safe External Navigation
- **Menu Registration**: Track, Album, and Playlist right-click / more context menus register `open-original-resource` ("跳转原始资源") with icon `external-link` (mapped to Tabler `share-box`).
- **Canonical URL Resolution (`resolveOriginalResourceUrl`)**:
  - Automatically parses canonical web URLs from URNs, track metadata, and raw IDs for:
    - Bilibili: Video BV IDs (`https://www.bilibili.com/video/BV...`), AV IDs, seasons (`ss...`), series (`series...`), and user collections/favorites (`ml...`).
    - NetEase Cloud Music: Track / album / playlist web URLs.
    - QQ Music: Song / album / playlist web URLs.
    - YouTube: Watch / playlist URLs.
    - Direct HTTP/HTTPS fallback: Any valid web URL provided in `track.originalUrl` or `item.id`.
- **Platform Invariant 1 Preservation (`openExternalUrl`)**:
  - UI packages must NEVER import Electron or platform SDKs.
  - `openExternalUrl(url)` calls `window.BBeBee?.shell?.openExternal(url)` if present, gracefully falling back to `window.open(url, '_blank')`.
