# UI Architecture & Descriptor Contribution Model

> **Legacy Reference:** Formerly `docs/08-ui-architecture.md §1 – §5, §7 – §9`.

> **What this answers.** **Layer 5** of [02 §1](../architecture/layers.md#1-the-layer-model): how a
> single plugin contributes user interface to two shells that share no component code, how views
> find their data without owning it, and where the boundary between "logic" and "view" is drawn.

Per [ADR-2](../architecture/overview.md#adr-2--the-ui-is-split-react-native-on-mobile-react-dom-on-desktop),
there are two view layers: React Native on mobile and React DOM on desktop. The cost of that
choice is paid entirely here, and this document is about containing it.

---

## 1. The three-package convention

A feature with UI splits into up to three packages. The split is not bureaucracy — it is what
keeps ADR-2 from doubling the *whole* feature instead of just its pixels.

```
@BBeBee/plugin-scrobble               ← headless: service, state, events, persistence
@BBeBee/plugin-scrobble-ui-mobile     ← React Native views
@BBeBee/plugin-scrobble-ui-desktop    ← React DOM views
```

| Package | Layer | Contains | May import |
|---|---|---|---|
| headless | 4 | The Cordis plugin, all logic, all state, all DB access, all networking | `@BBeBee/protocol` only |
| `-ui-mobile` | 5 | Components and the descriptors that name them | `react`, `react-native`, `@BBeBee/ui-kit-mobile`, and the headless package's **public subpaths** — its types plus the shared hooks and view ids (`/hooks`, `/views`) |
| `-ui-desktop` | 5 | Components and the descriptors that name them | `react`, `react-dom`, `@BBeBee/ui-kit-desktop`, and the headless package's **public subpaths** — its types plus the shared hooks and view ids (`/hooks`, `/views`) |

The split is the Layer 4/Layer 5 boundary made concrete. Layer 5 is where business *orchestration*
lives — this button, then that confirmation, then this navigation — while the business *rule* it
orchestrates stays at Layer 4, where it can be tested without a renderer and reused by the other
target's views unchanged.

The rule that makes it work:

> **A UI package contains no logic that would need to be written twice.**

If you are about to write the same `if` in both UI packages, it belongs in the headless one —
usually as a derived value on the service or a selector it exposes. In practice the UI packages
end up thin: layout, gestures, and event wiring.

The headless package works alone. A plugin with no UI package still functions; it simply
contributes nothing visible, which is exactly what happens on a target where its view was not
written.

### 1.1 Package internal organization & component decomposition

To prevent UI packages from turning into monolithic files containing thousands of lines, each UI package is decomposed into single-responsibility submodules:

```
packages/ui/<package>/src/
├── components/          ← Reusable presentation elements, artwork tiles, cards, track rows
│   ├── sections/        ← Partitioned feature sections (e.g. settings panels)
│   └── modals/          ← Dedicated dialogs and modal edit flows
├── screens/             ← Top-level screens / view targets (e.g. SearchScreen, PlaylistDetailScreen)
├── hooks/               ← Local UI state & interaction hooks (e.g. useTrackLibraryInfo)
├── utils/               ← Pure UI data transformers and helpers
└── index.tsx            ← Plugin registration facade (apply(ctx)) and backward-compatible re-exports
```

Reaching beyond basic organization, UI packages and UI infrastructure follow consistent modularization rules:
- **UI Kit Component Structure**: Core UI kit packages (`ui-kit-mobile`, `ui-kit-desktop`) isolate theme tokens and styling primitives into `primitives.ts`, component definitions into atomic files under `src/components/*.tsx` (`Button`, `Text`, `TextField`, `Slider`, `Sheet`, `ContextMenu`, `List`, `Artwork`, `TrackRow`, `Toast`, `JsonTree`, plus desktop-only `StickyDetailBar` and `coverTheme`), and barrel re-export through `src/index.tsx`.
- **Menu Controller Architecture**: Context menu hooks in `ui-menus` separate submenus (`src/submenus/*.ts`), individual entity menus (`src/menus/*.ts`), and anchor positioning utilities (`src/types.ts`).
- **Screen View Decomposition**: Heavy screens with multiple view modes (such as `LibraryScreen`) decouple view renderings into `src/components/views/*` (`CollapsedLibraryView`, `ExpandedLibraryView`, `SidebarFolderView`), action and data hydration into `src/hooks/*` (`useLibraryHydration`, `useLibraryActions`), and control bars/modals into `src/components/*`.
- **Pure Helper Hoisting**: Reusable pure logic that outgrows one feature (such as formatting durations, artwork IDs, and string helpers) belongs in `@BBeBee/toolkit` (Layer 4 pure library), maintaining a single source of truth across desktop and mobile without duplication.
- **Share UI Modal & Canvas Architecture (`plugin-share-ui-desktop`)**: Modal workflows (`ShareTrackModal`, `SharePlaylistModal`, `ShareAlbumModal`, `ShareLyricsModal`) decouple shared presentation (`ShareModalHeader`, `BackgroundModeSelector`, `LocalSourceWarning`, `DisabledReasonToast`, `ShareActionButtons`) and state (`useShareModalState`). Previews render directly onto a live `<canvas>` using identical rendering functions (`drawTrackCard`, `drawPlaylistCard`, `drawAlbumCard`, `drawLyricsCard`) to ensure 100% pixel-perfect synchronization with exported PNGs, using non-distorting cover scaling (`drawImageCover`) and 3-line text wrapping (`wrapText`).

---

## 2. Contributions are descriptors

Plugins never hand components to the shell directly. They register **descriptors** — serialisable
declarations naming a view — and the shell resolves the name against its own registry.

```ts
export type Contribution =
  | RouteContribution
  | SlotContribution
  | CommandContribution
  | SettingsContribution
  | MenuContribution

export interface RouteContribution {
  kind: 'route'
  id: string                       // 'scrobble.history'
  path: string                     // '/scrobble/history'
  title: string                    // i18n key
  icon?: string                    // name from the shared icon set (Tabler icons, stroke 1.25 on desktop)
  /** Where the shell should offer navigation to it. */
  placement?: ('sidebar' | 'tab-bar' | 'more-menu' | 'tray')[]
  order?: number
}

export interface SlotContribution {
  kind: 'slot'
  id: string
  slot: SlotId                     // a well-known extension point
  order?: number
  /** Evaluated against slot context to decide visibility. Pure, cheap, synchronous. */
  when?: (ctx: SlotContext) => boolean
}

export interface CommandContribution {
  kind: 'command'
  id: string                       // 'player.togglePlay'
  title: string
  icon?: string
  defaultKeybinding?: string       // desktop only; ignored on mobile
  run(args?: unknown): void | Promise<void>
}

export interface SettingsContribution {
  kind?: 'settings'
  id: string
  /** Target section/category tab: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'about' or custom ID */
  section: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'about' | (string & {})
  title: string
  description?: string
  order?: number
  icon?: string
  actionText?: string
  /** Presentation mode: 'card' (embedded custom card), 'link' (action navigation row), 'auto' */
  display?: 'card' | 'link' | 'auto'
  action?: () => void | Promise<void>
  /** Auto-rendered form schema (when no custom view is registered) */
  schema?: ParamSchema
}

export interface MenuContribution {
  kind: 'menu'
  id: string
  /** Desktop application menu bar. Mobile maps these into the more-menu. */
  menu: 'file' | 'edit' | 'view' | 'playback' | 'help'
  title: string
  /** The command run when selected — menus never carry their own logic. */
  command: string
  order?: number
  /** Rendered as a checkbox item, driven by this predicate. */
  checked?: () => boolean
}

export interface TrayContribution {
  kind?: 'tray'
  id: string
  title: string
  icon?: string
  targetRoute?: string
  order?: number
  when?: (ctx: SlotContext) => boolean
  action?: () => void | Promise<void>
}

export type Contribution =
  | RouteContribution
  | SlotContribution
  | CommandContribution
  | SettingsContribution
  | MenuContribution
  | TrayContribution

export interface UiService {
  contribute(c: Contribution): Disposable
  /** Called by each shell's view package to bind an id to a component. */
  registerView(id: string, component: unknown): Disposable

  navigate(id: string, params?: Record<string, unknown>): void

  readonly routes: readonly RouteContribution[]
  slotsFor(slot: SlotId): readonly SlotContribution[]
  readonly commands: readonly CommandContribution[]
  readonly menus: readonly MenuContribution[]
  readonly settings: readonly SettingsContribution[]
  readonly tray: readonly TrayContribution[]
  runCommand(id: string, args?: unknown): Promise<void>
  viewFor(id: string): unknown | undefined
  missingViews(): string[]
}
```

`registerView` takes `unknown` deliberately: `@BBeBee/protocol` must not depend on `react`,
`react-native`, or `react-dom`, since it is imported by headless plugins that run in contexts with
no React at all. The shells cast at the boundary — one `as ComponentType` in one place per shell,
rather than a React dependency reaching into the contract layer.

> ⚠️ **Register a component bound to *your* context, never the shell's.** A shell renders a view
> as `h(Component, { ctx })` with the context it was mounted on — `app.ready(['ui'])`, which has
> `ui` injected and nothing else — and a cordis context throws for any property outside its inject
> list. A screen that reads `ctx.player` or `ctx.inspector` off the forwarded prop therefore throws
> *during render*, on a device, while every test that built a plain root context passed. Every view
> package here closes over the context its own plugin was applied with (a local `bound(ctx, Screen)`
> helper) and forwards the shell's other props; the one that did not shipped a page that rendered
> as a black window.
>
> The shells catch it either way — a view that throws is caught per route and rendered as a named
> failure, not as an unmounted app — but the boundary is a net, not the contract.

### Slots

Well-known extension points, enumerated in `@BBeBee/protocol` so both shells implement the same set:

```ts
export type SlotId =
  | 'now-playing.actions'        // buttons beside the transport (e.g. mini-player.button, desktop-lyrics.toggle, queue.button)
  | 'now-playing.panel'          // tabs in the expanded player (lyrics, queue, related)
  | 'now-playing.visualizer'     // audio visualizer canvas slot
  | 'track.context-menu'         // right-click / long-press on a track
  | 'album.context-menu'
  | 'library.sidebar'            // extra library sections
  | 'search.results-section'     // an extra results group
  | 'settings.sources'           // the source list: import, groups, enable, reorder
  | 'source.browse'              // a source's explore tree
  | 'topbar.tray'                // topbar system tray slot (desktop)
  | 'status-bar'                 // desktop only; ignored on mobile
```

> **Decoupled Bottom Bar Actions, Settings, and TopBar Tray**:
> - Icons on the right side of the bottom player bar (Picture-in-Picture/mini player, floating lyrics toggle, play queue) are never hardcoded in `NowPlayingBar`. Instead, each plugin contributes its action button to the `'now-playing.actions'` slot and registers its view. The bar dynamically queries `ctx.ui.slotsFor('now-playing.actions')`, filtering with `when` and sorting by `order`.
> - Feature plugin settings (such as DSP effects, cache management, source configuration) are dynamically contributed via `ctx.ui.contribute({ kind: 'settings', ... })` or `ctx.settings.contribute(...)` instead of hardcoded into the Settings screens.
> - The desktop TopBar includes a Windows-like system tray toggle button beside the "Import & Share" button. It renders a downward arrow (`chevron-down`) when collapsed and an upward arrow (`chevron-up`) when expanded. Plugins self-determine whether they need to display in the main interface tray via `placement: ['tray']` on their route or via `TrayContribution`. Clicking a plugin icon in the tray popover triggers `ctx.ui.navigate(...)` to navigate the main view to that plugin's screen and closes the tray. Settings uses exactly this path: its route carries `'tray'` placement, so 设置 appears in the tray without any TopBar-specific code.

Slot rendering is where a plugin's UI actually shows up:

```tsx
// @BBeBee/ui-kit-desktop
export function Slot({ id, context }: { id: SlotId; context: SlotContext }) {
  const items = useSlot(id, context)
  return <>{items.map((it) => {
    const View = ui.viewFor(it.id) as ComponentType<{ context: SlotContext }> | undefined
    return View ? <View key={it.id} context={context} /> : null
  })}</>
}
```

---

## 3. Resolving a descriptor to a view

The descriptor names a view id. The shell looks it up in a registry populated by whichever UI
package was loaded for *this* target.

```mermaid
flowchart LR
    H["headless plugin<br/>ctx.ui.contribute({ kind:'slot', id:'scrobble.badge', slot:'now-playing.actions' })"]
    UM["-ui-mobile<br/>ctx.ui.registerView('scrobble.badge', RNBadge)"]
    UD["-ui-desktop<br/>ctx.ui.registerView('scrobble.badge', DomBadge)"]
    R["ctx.ui registry"]
    SM["mobile shell renders RNBadge"]
    SD["desktop shell renders DomBadge"]
    H --> R
    UM --> R
    UD --> R
    R --> SM
    R --> SD
```

**Missing views are normal, not an error.** A plugin may ship a desktop view and no mobile one
(a multi-column log inspector), or the reverse (a gesture-driven mini player). The contribution
still registers; the slot simply renders nothing for it. This is a direct, ongoing cost of ADR-2,
and making it a first-class state rather than a crash is what keeps it survivable.

Three consequences worth enforcing:

- A descriptor must carry enough information to be *listed* without its view — a title and icon.
  A settings page with no view for this target can still appear, disabled, with "not available on
  this platform", rather than leaving a hole the user cannot explain.
- `when` predicates run in the shell and must be synchronous and cheap; they run during render.
- A command with no view is fully functional — it appears in the command palette on desktop and
  in the more-menu on mobile. Commands are the cheapest way to make a feature reachable on both
  targets.

---

## 4. Binding services to React

The rule from [02 §6](../architecture/layers.md#6-state-ownership): **React holds no domain state.**
Services own it; components subscribe.

Both `ui-kit-mobile` and `ui-kit-desktop` build on one shared, framework-agnostic hook layer in
`@BBeBee/ui-core`, which depends only on `react` and `@BBeBee/protocol`:

```ts
// @BBeBee/ui-core
export function useService<K extends ServiceKey>(key: K): Context[K] | undefined

/**
 * Subscribe to service state via useSyncExternalStore, so React 18 concurrent
 * rendering cannot tear. `select` must be referentially stable across calls
 * for unchanged inputs — return primitives or memoised objects.
 */
export function useServiceState<K extends ServiceKey, T>(
  key: K,
  events: (keyof Events)[],
  select: (svc: Context[K]) => T,
): T
```

Feature-specific hooks are thin wrappers, and they live in the **headless** package so both shells
share them:

```ts
// @BBeBee/plugin-player/hooks — shared by both UI packages
export const useTransport = () =>
  useServiceState('player', ['player/state-changed'], (p) => p.state)

export const useQueue = () =>
  useServiceState('player', ['queue/changed'], (p) => p.queue)

/** Position updates at 1 Hz; the UI interpolates with rAF between ticks. */
export const usePosition = () =>
  useServiceState('player', ['player/position'], (p) => p.state.positionMs)
```

This is where the three-package split earns its keep. The hooks — the part with actual logic about
which events invalidate which state — are written once. Only the JSX is written twice.

### Rendering rules

- **No `useEffect` for domain work.** An effect that fetches, writes, or mutates domain state
  belongs in a service method the component calls.
- **Optimistic updates live in the service**, not the component, so both shells behave identically
  when a write fails and rolls back.
- **Lists virtualise.** `FlashList` on mobile, `@tanstack/react-virtual` on desktop. A library can
  hold 100k tracks; neither platform survives rendering that.
- **A detail page's header scrolls away with its list.** The desktop `List` owns a `header` slot
  (hero, action bar — whatever scrolls off), a `sticky` slot (the `StickyDetailBar` that slides in
  from above the viewport as the header's play button approaches, leaving title + play button +
  the table header — the Spotify layout), a `stickyHeader` slot (the table header, pinned just
  below the bar), and `onScroll`. The choreography is measured,
  not assumed (`useDetailBarCollapse` reads the play button's distance to the scrollport top per
  scroll event): the bar docks — its compact play button scales in — when its edge has covered
  half the button. The virtualiser is offset by everything above the rows, *measured* off the
  spacer's real position (`scrollMargin`, watched by `ResizeObserver` and a scroll listener —
  a wrapped title makes it unknowable from props). The sticky bar and the pinned table header
  must both be the scroller's **direct children**: `position: sticky` only sticks within its
  parent's box, so nesting them in the header would scroll them away exactly when they finish
  arriving.
- **`player/position` is interpolated, never polled.** The event fires at 1 Hz
  ([07 §5](../data-model/events.md#5-the-event-map)); a progress bar animates between ticks with
  `requestAnimationFrame` and re-syncs on each event.
- **Artwork renders `blurhash` first**, then the image
  ([07 §4.2](../data-model/schema.md#42-artwork)). No layout shift, no grey flash on scroll. A remote
  cover is requested with **no `Referer`**: several CDNs answer a hotlink 403 when the referrer is
  a foreign origin (Bilibili's `hdslb.com` does, and in dev the renderer's referrer is
  `localhost`), which shows every result as a broken image while the same URL opens fine in a tab.
- **A cover is resolved through `ctx.cache` before it renders.** The view packages render the kits'
  `Artwork` through a local `CachedArtwork` that calls `useResolvedArtwork(ctx, ref)`
  (`@BBeBee/plugin-cache/hooks`) — and `TrackRow`, which draws its own `Artwork` internally,
  through a `CachedTrackRow` — so the URL handed to `<img>`/`Image` is a local file whenever the
  cache has one, and the `dominantColor`/identicon fallback covers the fetch in flight: the remote
  URL is never what gets rendered. The cached copy also fills in `artworks.local_uri`, which is
  what lets the lock screen receive a local `Uri` ([04 §7](../services/contracts.md)).
- **Artwork with no image falls back to a generated identicon.** When there is no cover to load —
  a local file without embedded art gets no `artworks` row at all — `Artwork` renders a
  GitHub-identicon-style square derived from the entity's URN: a FNV-1a hash of the seed drives a
  vertically mirrored 5×5 cell grid and a hue, painted as a dark tint behind a vivid pattern. The
  pattern is computed once in `ui-core` (`identicon()`), so both kits hash the same URN to the
  same square; only the elements differ (SVG on desktop, `View`s on mobile — no `react-native-svg`
  native module). Derived data never outranks real data: an image beats an identicon, and a
  `dominant_color` extracted from a real cover beats both. No identity (`seed` absent, no
  `artwork.id`) means no pattern — the plain colour square stands.
- **A detail page takes its theme colour from its cover.** The screens with a single cover
  (Album, Playlist — first track's artwork when the playlist has none) compose
  `useResolvedArtwork` + the kit's `useImageColor`: the ref's `dominantColor` — computed once at
  cache time — wins; a ref without one gets a one-shot canvas extraction (`extractVibrantColor`,
  vividness-scored buckets, run on the same URL the `<img>` shows); an unreadable cover (remote
  URL without CORS taints the canvas) returns `undefined`. `headerGradient(tint)` paints the
  **scrolling header area only** — percentage stops land it exactly on `--bg-primary` at the
  header's bottom edge, so everything below (rows, and the pinned table header) sits on the same
  solid colour with no seam — and the sticky bar's wash tints with it. `undefined` falls back to
  the neutral brand gradient — a missing cover degrades to what the page looked like before,
  never to an error.

---

### Context menus & Library Interaction

Right-click on desktop, long-press on mobile, one menu. `TrackRow.onMore`, `UnifiedLibraryRow.onMore`, and header action controls hand the pointer anchor to the screen; the screen holds a controller from `@BBeBee/ui-menus` and renders the kit's `ContextMenu`. The **model** — which actions exist for a track, a playlist, a collection, and what each one calls — is written once in `@BBeBee/ui-menus`; the kits know how to draw menu rows and nothing about playlists or queues, which is what keeps the shells' menus unified down to the order of the items.

Two model details worth pinning: `TrackMenuOptions.lyrics` (the lyric lines a screen already shows) is what makes the 分享歌词 item offerable — the model never fetches lyrics itself; and a menu rendered inside an ancestor whose `transform`/`overflow` would clip fixed positioning (the play page's hover bottom bar) must pass `portal: true` so the kit mounts it on `document.body`. The fullscreen play page itself right-clicks to the playing track's menu — `useCurrentTrack` (shared with the bottom bar) resolves the track, the transport's `currentItemId` (queue-row fallback) targets 从队列中移除 at the real queue entry, and the lyric text on screen feeds 分享歌词.

#### Visual and Component Model
- **Container styling**: High-contrast dark streaming card (`#242424`), 8px border radius, 4px padding, `0 12px 32px rgba(0,0,0,0.55)` depth shadow, and subtle 1px border (`rgba(255, 255, 255, 0.08)`).
- **Dividers**: Menu items support `divider: true` to draw a 1px translucent separator line above critical or dangerous operations.
- **Icons**: Standard operations (`pencil`, `trash`, `pin`, `plus`, `folder`, `play-filled`, `download`, `playlist`) resolve to Tabler SVG icons (`stroke: 1.25`) with consistent 16px geometry.
- **Submenus & Viewport Clamping**: Submenu triggers render a chevron indicator (`chevron-right`). Submenus dynamically exclude cyclic candidates (e.g. "Add to other playlists" excludes the source playlist, "Move to folder" excludes the current folder and descendant folders). Submenu positioning computes real-time horizontal and vertical viewport flipping, dynamically clamping `maxHeight` and enabling internal scrolling so flyout menus never overflow the screen.

#### Entity Context Menu Specifications
- **Track Context Menu**:
  - `add-to-playlist`: "Add to playlist" submenu. Tracks belong exclusively to playlists or albums and cannot be added directly to folders.
  - `remove-from-playlist`: Danger tone with divider, shown only when the row is rendered within a playlist.
  - `add-favourite` / `remove-favourite`: Heart/unheart track in library and source.
  - `enqueue`: Append track to end of playback queue.
  - `download`: Queue track for offline download.
  - `sleep-timer`: Configure playback sleep timer countdown.
  - `go-to-album`: Navigate to album detail view when `track.albumUrn` is present.
  - `open-original-resource`: "跳转原始资源" (with icon `external-link`). Resolves canonical external web URL (Bilibili video/BV/av, NetEase, QQ Music, YouTube, or direct link) via `resolveOriginalResourceUrl` and launches the system browser/host via `openExternalUrl` without importing platform SDKs.
- **Playlist Context Menu**:
  - `open-original-resource`: "跳转原始资源", opens external playlist, Bilibili series/season/collection, or favorites web page.
  - `edit-details`: Opens `EditPlaylistModal` to modify cover art (via local file chooser or remote URL), title, and description via `ctx.library.updatePlaylist`.
  - `delete-playlist`: Danger tone with top divider, triggers `ConfirmDeleteModal` for explicit secondary confirmation before invoking `ctx.library.deletePlaylist`.
  - `toggle-pin`: Pin/unpin from top of library list.
  - `add-to-playlist`: "Add to other playlists", excluding current playlist.
  - `add-to-collection`: "Move to folder", supports existing folders, creating new folders, or moving to root with automatic source folder cleanup.
- **Album Context Menu**:
  - `open-original-resource`: "跳转原始资源", opens external album, EP, or collection web page in the browser.
  - `delete-album`: Danger tone with top divider, triggers `ConfirmDeleteModal` for explicit secondary confirmation before removing the album from the library (`ctx.library.setSaved(urn, false)`) and any enclosing folder (`ctx.library.removeFromCollection`).
  - `toggle-pin`: Pin/unpin album in library list.
  - `add-to-collection`: "Move to folder", supports existing folders, creating new folders, or moving to root.
- **Folder (Collection) Context Menu**:
  - `rename-collection`: Opens `RenameFolderModal` to update folder title via `ctx.library.renameCollection`.
  - `delete-collection`: Danger tone with divider, deletes collection and cascades child relationships.
  - `toggle-pin`: Pin/unpin folder in library list.
  - `create-playlist` & `create-folder`: Creates items directly within the selected folder.
  - `move-to-folder`: Move folder to another folder or root via `ctx.library.moveCollection`.
  - `add-to-playlist`: "Add to other playlists". Uses `collectAllFolderTracks` to **recursively traverse** all nested playlist tracks, nested album tracks, and all nested subfolder contents without duplicates (folders do not contain direct tracks).
  - `enqueue`: Plays all aggregated tracks across the folder hierarchy.

#### Library Presentation Modes
- **Collapsed mode** (72px rail): Minimalist icon list with consistent folder outline icons. When entering a folder, displays a `chevron-left` return button below the top brand logo to navigate back to the root library.
- **Sidebar mode** (260–340px): Standard view featuring inline expandable folders via rotating chevron controls (`chevron-down` / `chevron-right`), indented child items (28px padding), and dedicated folder detail view (`chevron-left Folder Title`). Playlists inside folders are automatically hidden from the root list (`containedPlaylistUrns`) and restored when moved to root.
- **Expanded mode** (full-canvas): High-density 3-column table view (`Title`, `Date Added`, `Last Played`) with top breadcrumb navigation (`音乐库 < 文件夹名`).

### Detail screens, sorting & media views

1. **Album, Playlist, Local Music & Favorites Track Tables**:
   - **Track Deduplication**: Across `AlbumScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, and `LocalMusicScreen`, raw track items are strictly deduplicated by track URN (`seen = new Set<string>()`), preventing duplicate rows, virtual list key collisions, and batch selection discrepancies.
   - **Table Header Sorting**: Column headers (`#`, `标题`, `艺人`, `专辑`, `来源`, `添加日期`, `时长` with Tabler `clock` icon, `播放量`) support interactive sorting with ascending/descending directional indicators (`chevron-up` / `chevron-down`). Column headers omit the legacy checkmark.
   - **Source Column & Source Sorting**: `AlbumScreen`, `FavoritesScreen`, and `PlaylistDetailScreen` include a dedicated "来源" (Source) column (omitted in `LocalMusicScreen` where all tracks are local), dynamically resolving names via `resolveTrackSourceName(ctx, trackUrn)` (e.g. `'本地'`, `'哔哩哔哩'`). The column header is clickable to toggle asc/desc, and the sort dropdown includes "来源", sorting by display name via `localeCompare(..., { numeric: true, sensitivity: 'base' })`.
   - **Batch Operations Toolbar & Actions**: The three-dot menu on all four detail screens provides a flat "批量操作" entry (`list-check` icon, no nested submenu). Clicking toggles batch mode and reveals `BatchActionBar`:
     - Native `<input type="checkbox">` for "全选" (Select All), matching track row checkboxes and supporting `indeterminate` (partial) and `checked` states;
     - "批量播放" (`batch-play`): Plays selected tracks in current visual order;
     - "添加到歌单" (`batch-add`): Opens popover/menu with accurate track count increments (`delta = active.tracks.length`);
     - "删除" / "从最喜欢中删除" (`batch-delete`): Batch removes or unfavorites selected tracks;
     - "退出批量操作" (`exit-batch`): Cancels selection and exits batch mode.
   - **Action Bar Sort Menu**: Dropdown `ContextMenu` ("默认顺序" / "自定义顺序" with Tabler `arrows-sort` or `list` icon) providing rapid switching between sorting keys and directions.
   - **Row Hover Library Action (`TrackLibraryActionButton`) & Popover**: Across track rows in `LocalMusicScreen`, `PlaylistDetailScreen`, `FavoritesScreen`, and `CollectionScreen`, the static checkmark is replaced with a hover action icon. When hovered, tracks not in library show `plus` (clicking saves to Favorites via `library.setSaved(track.urn, true)`); tracks in library show `heart-filled` (green heart), clicking opens a dedicated Spotify-style `SaveToPlaylistPopover` offering real-time playlist search, inline playlist creation, liked songs toggle, and folder tree navigation:
     - Clicking "新建歌单" smoothly switches the top "查找歌单" search bar into an inline creation input with auto-focus, "确定" confirm button, and cancel button, while the list's "新建歌单" row is automatically hidden to eliminate duplicate actions;
     - Confirm button is reinforced with `flexShrink: 0`, `whiteSpace: 'nowrap'`, and `minWidth: 44` with input `minWidth: 0` so button text is never compressed or truncated in Flexbox containers.
   - **Album Header, Source Badge & Pagination**: `AlbumScreen` displays a gray framed badge (`album-source-badge`) at `top: 24, right: 32` when the album originates from a third-party source (`isThirdParty`). Third-party albums support incremental pagination (`pageSize: 30`) via `useAlbum`: virtual lists compute the halfway mark of the last page (`thresholdIndex = Math.max(0, count - pageSize) + Math.floor((count - Math.max(0, count - pageSize)) / 2)`) and trigger `album.loadMore` when scrolling past it, avoiding upfront bulk fetches and premature initial-mount triggers. Features an Action Bar heart button (`heart` / `heart-filled`) bound to `library.setSaved(album.urn, isSaved)` displaying saved albums in the user's Library. Local albums (`BBeBee:local:`) omit download buttons in header and rows, and omit the download menu item. Three-dot menu and header right-click provide "跳转原始资源", "加入文件夹", "添加到音乐库/从音乐库中删除", "加入播放列表", and "睡眠定时器" (omitting "加入歌单" and "转至专辑").
   - **Playback Queue Alignment**: Playing tracks from a sorted table (single-tap or "Play All") passes the sorted URN sequence to `ctx.player.playFromContext`, ensuring the playback queue matches visual order.
   - **Playlist Item ID Decoupling, Source Badge & Pagination**: In `PlaylistDetailScreen`, rows wrap data as `{ item, track, trackUrn, originalIndex }`, preserving item IDs across sort operations so that removals and context menus act on the correct playlist item. Third-party playlists (`isThirdParty`) display a gray framed badge (`playlist-source-badge`) at `top: 24, right: 32` and support half-page scroll pagination (30 tracks per page). User-created local playlists omit the source badge even when containing third-party tracks. Header right-click and three-dot menu provide "跳转原始资源".
   - **Favorites Parity (`FavoritesScreen`)**: Styled with immersive purple gradient header, 56px play button, shuffle, real-time search filter, and `FavoriteTrackTableRow` with hover `TrackLibraryActionButton` (`heart-filled` / `heart` submenu).

2. **Local Music Dual Views (Tracks & Albums)**:
   - **Full Pagination**: `fetchAllLocalTracks` and `fetchAllLocalAlbums` recursively paginate in batches of 500 until all local items are retrieved, removing the former 100-item truncation.
   - Header segmented toggle allows switching between "歌曲" (table list) and "专辑" (grid view).
   - Album grid view aggregates local tracks into `LocalAlbumCard` components with cover artwork, title, artist, track count, and hover play trigger.
   - Sort dropdown adapts dynamically to album-specific criteria (name, artist, year, track count).

3. **Playback History & Recent Plays**:
   - **Deduplication**: `HistoryScreen` (desktop and mobile) and `QueueScreen` (recent plays tab) de-duplicate tracks by `trackUrn`, retaining only the most recent playback record (with its relative timestamp and completion badge).
   - **Play Count Indicator**: `HistoryScreen` displays a `播放 N 次` capsule badge indicating total plays per track.
   - **Count Consistency**: Header counters (`(${uniqueRecords.length} 首)`) and empty state checks evaluate against deduplicated unique tracks.

### The source surfaces

Four screens carry the whole string model, and they are worth naming because they are the part of
the UI that has no equivalent in a conventional player. The descriptors come from
`plugin-sources` and the views from `plugin-sources-ui-{mobile,desktop}` — all four are ordinary
descriptors, nothing about them is privileged.

| Screen | Does | Notes on the split |
|---|---|---|
| **Source list** | Enable, disable, reorder, group, and see each source's health badge; delete asks once and takes the cached catalogue with it ([06 §4.1](../sources/runtime.md#41-a-sources-lifetime)). The local-files row shows the scanner's folders with the same use/delete controls as **Music folders** | Ordinary list; parity is free |
| **Import review** | Show what a pasted string contains — added / updated / rejected, and the host allowlist — before anything is written ([06 §9](../sources/authoring.md#9-importing-updating-and-sharing)) | The one screen that must never be skipped, so it is a modal route on both, not a slot |
| **Test a source** | Run one feature — search, browse, album, artist, playlist, lyrics, library, stream, a raw HTTP request, or arbitrary script — and show every rule's input, output and timing ([06 §10](../sources/authoring.md#10-diagnosing-a-broken-source)) | The list of test areas is the source's derived capability list, so the screen shows what that source can actually do; the trace is a long scrollable log, the closest thing in the app to a developer tool, and the reason a user can fix a source themselves |
| **Search** | One query fanned out over the selected sources with `searchAll`, one result section per source ([06 §4.1](../sources/runtime.md#41-a-sources-lifetime)) | Before the first search the bar and the interface toggles are a hero; afterwards both collapse to the top and the results take the height. On desktop, search can also be executed directly from the persistent TopBar interactive input with its 2×2 matrix dropdown. The search screen (`sources.search`) accepts incoming `query` parameters and triggers `searchAll` automatically. **One toggle per interface, not per source** — a backend with a separate artist search shows `Source · Songs` and `Source · Artists` independently, and the selection reaches `searchAll` as `typesBySource`. Selections are stored as *exclusions*, so a source imported later joins the next search instead of being silently missed — and a source that failed, timed out or matched nothing keeps its own header instead of vanishing into a merged list. On desktop, results are organized into independent card panels (`SourcePanel`) with sticky headers (`position: sticky; top: 0`) and internal vertical scrolling (`maxHeight: min(520px, 60vh); overflowY: auto`), per-source "Load More" pagination buttons, and global expand/collapse controls. Tapping a track follows single-track playback policy (`urns: [track.urn]`), queuing solely the clicked track to avoid polluting the active playback queue. All panels strictly adhere to the design system color management tokens. |
| **DSP & Equalizer** | 10-band graphic equalizer with preset switching (Flat, Bass Boost, Vocal, Treble), effect chain ordering, individual effect bypass toggles, and parameter editing (normalize, compressor, reverb, etc.). Contributed as `dsp.view`. Opened directly from the player or via an action button in the playback settings card. | Descriptors in `plugin-dsp-ui-*`. Desktop renders a dedicated view with vertical sliders; mobile provides touch-friendly vertical sliders, chip selectors, and full chain navigation |
| **Settings Center** | All-in-one single-page scrolling settings center (`settings.view`) with text anchor tabs: General & Language, Playback & Audio, Desktop Lyrics (line mode, alignment, font, size, color picker, opacity, live preview), Global Hotkeys (master toggle + 10 keybindings), Network & Proxy (HTTP/HTTPS/SOCKS5, Google latency probe, per-source routing switches), Storage & Cache (directory badges with change/open folder buttons), and About with an Advanced Settings toggle guarding the Danger Zone. | Descriptors in `plugin-settings` and rendered by `plugin-settings-ui-*`. |
| **Debug & Diagnostics** | Dedicated diagnostic hub comprising three views: `debug.view` (Debug status, environment specs for Node, Electron, OS, Chromium), `debug.logs` (Discover live ring-buffer logs with search, level filters, NDJSON copy, clear), and `debug.http-logs` (live inspection of third-party source network requests with method, status badge, latency, and URL). | Descriptors in `plugin-settings` and views in `plugin-settings-ui-desktop`. |

A download starts from the **⬇ control on a track row** (`TrackRow.onDownload`, present only where
`ctx.downloads` is loaded) in the library, an album and the search results.

The rule that keeps this affordable is [§1](#1-the-three-package-convention)'s: parsing,
validating, diffing, tracing and redacting all live in the headless package. The view packages
show a list, a text field, and a set of toggles. The library itself is `plugin-library-ui-*`
(playlists, albums and collections side by side), the album page is `plugin-album-ui-*`, and the
four above are the ones the string model added.

---

## 5. Navigation

| | Mobile | Desktop |
|---|---|---|
| Router | Expo Router (file-based) | A small in-memory router in `ui-kit-desktop` |
| Primary chrome | Bottom tab bar + stack | Persistent sidebar + content pane + TopBar |
| Contributed routes | Registered as dynamic routes; `placement` decides tab bar vs. more-menu | Sidebar entries ordered by `order` (excluding Search & Settings, which use TopBar) |
| Back | OS gesture / hardware button | In-app history, plus `Cmd/Ctrl+[` |
| Deep links | `BBeBee://` scheme via `expo-linking` | Same scheme registered with the OS by `main` |

Both shells implement the same `navigate(routeId, params)` used by commands, so a command works on
either target without knowing which router is underneath.

---

## 7. Shell responsibilities

The shells are thin. Everything below is genuinely platform-specific and belongs nowhere else.

| | `apps/mobile` | `apps/desktop/renderer` |
|---|---|---|
| Boot | Create context, register `core-*-expo`, mount inside `ctx.inject(['ui'], …)` | Same with `core-*-node` |
| Chrome | Tab bar, stack headers, safe-area insets | Sidebar, TopBar (central search with collapse-to-magnifier + 2×2 matrix, tray, profile avatar), window controls, resizable panes |
| Player surface | Mini player above the tab bar; expands to full screen | Persistent bottom bar; optional detached mini-player window |
| Platform-only | Gestures, haptics, pull-to-refresh | Right-click menus, drag-and-drop, keyboard shortcuts, tray, command palette |
| Absent | No keyboard shortcuts, no tray | No gestures, no haptics |

The desktop **command palette** (`Cmd/Ctrl+K`) is worth calling out: it renders
`ctx.ui.commands` directly, so every plugin command is reachable with zero UI work from the plugin
author. It is the highest-leverage piece of shell code in the project.

### 7.1 Desktop Shell Navigation & TopBar Interaction

The desktop shell organizes primary navigation between the left sidebar and the top bar:

0. **TopBar placement**: The TopBar is **embedded at the top of the main content pane** (not a
   full-width row above the workspace), so the sidebar and the queue panel run the full window
   height. When the library's expanded mode takes over the workspace, the TopBar moves into the
   expanded library pane instead (sticky, so the window controls stay reachable). There is no
   standalone Home button — Home lives on the brand logo — and the centered search input is
   deliberately narrow (`max-width: 360px`). With the queue panel open, the window controls sit at
   the top-right of the main pane, left of the queue. The left cluster is only the brand logo and
   history Back/Forward — the former ⋯ More menu was removed (its entries live in the sidebar and
   the tray).

1. **Left Sidebar Filtering**:
   - The left navigation rail is dedicated to browsing user content and collections (`library.view`, `history.view`, user playlists).
   - Global utility entries — specifically `settings.view` (Settings Center) and `sources.search` (Search) — are intentionally excluded from sidebar route rendering to avoid visual clutter and maintain Spotify-style navigation parity.
   - The **library sidebar** keeps two quick entries — 喜欢 (heart, with the saved-track count) and 本地和下载 (download, with the local-track count) — between the "音乐库" title and the filter pills; they navigate to `library.favorites` / `library.local`, highlight the active one, and stay visible in the collapsed rail as two icon tiles. The 艺人 filter chip renders only when the library actually holds artists, the 已下载 chip is gone, and the sort label hides while the in-library search field is open.
   - The **filter row** itself is flat: the 歌单/专辑(/艺人) buttons carry no pill background — the active one is marked by an outer glow (`--glow-brand-sm`) — and hairline vertical separators divide them. The create trigger moved out of the header into this row's far right as an icon-only plus (its dropdown — 创建歌单/创建文件夹 — anchors beneath it); the header keeps only the title and the expand button.

1a. **Track & Album View Modes (紧凑/列表/平铺)**:
   - The album, playlist, favourites and local-music pages offer a **视图模式** section at the bottom of the 排序方式 dropdown menu (`viewModeMenuItems` in `ui-kit-desktop`): a flush-left muted heading (`MenuItemSpec.heading`, no icon slot, no hover) behind a hairline divider, then one entry per mode with a check on the active one.
   - **列表 (list)** is the default and matches the historical row: artwork, title with artists beneath, album, date, duration. **紧凑 (compact)** drops the artwork and promotes artists to their own column (header included). The local-albums tab additionally offers **平铺 (tiled)** — the current card grid (`LocalAlbumCard`) — as its default, with 列表/紧凑 rendering album rows instead.
   - The choice persists per page in `localStorage` (`bbebee_view_mode:<key>` via `useViewMode`), so a page the user prefers compact stays compact across restarts.

2. **TopBar Interactive Search & 2×2 Matrix Dropdown**:
   - **Collapse to a magnifier when squeezed**: A `ResizeObserver` on the center group measures
     the search's real width; below 180px the whole search collapses to a single magnifier button
     (`topbar-search-collapsed-button`). Clicking it expands the search across the bar — the tray
     and profile icons are hidden while expanded — and focuses the input. Clicking anywhere
     outside the search, pressing `Escape`, or committing a query restores the collapsed state and
     brings the icons back. The window controls (Minimize/Maximize/Close) are **never** hidden:
     their group is `flexShrink: 0` in both states.
   - **Dynamic Search Icon Shift**:
     - *Idle state*: The search icon (`search`) rests at the left padding (`left: 12px`).
     - *Active / Focused state*: The icon smoothly slides across to the far right (`right: 12px`, with transition `all 200ms cubic-bezier(0.4, 0, 0.2, 1)`) and functions as an interactive submit button (`cursor: pointer`).
     - *Dismissal*: Clicking outside the search area or pressing `Escape` unfocuses the input, dismisses the dropdown, and resets the icon back to the left edge.
   - **2×2 Matrix Floating Dropdown Panel**:
     - Automatically reveals directly beneath the input (`top: calc(100% + 8px)`, width 600px, z-index 1000) when the input is focused or query text is entered.
     - Structured as a 2-row × 2-column grid:
       - **Row 1**: Left header: "搜索范围" (`Search Scope`); Right header: "搜索历史" (`Search History`) accompanied by a subtle, high-transparency "清空" (`Clear`) button (`rgba(255, 255, 255, 0.4)`).
       - **Row 2**:
          - *Left cell (Search Scope)*: Third-party music source toggle buttons connected to `useSearchSourceSelection(ctx)`. Renders individual source interface chips (styled with active green `#1DB954` fill and black text) alongside "全部" (All) and "重置" (None) batch toggles. Source selections are maintained in a shared store backed by `useSyncExternalStore` and persisted as exclusions in `localStorage` (`bbebee_search_sources_excluded`) so that TopBar and `SearchScreen` stay strictly synchronized bi-directionally, and newly installed sources participate automatically.
          - *Right cell (Search History)*: Interactive history tags stored in `localStorage` (`bbebee_search_history`, max 10 entries). Clicking any tag immediately executes that query. When history is empty, a subtle "暂无搜索历史" fallback is displayed.
    - **Search Submission & Screen Routing**:
      - Pressing `Enter`, clicking the shifted right search icon, or clicking a history tag commits the query into history, closes the matrix panel, and calls `navigate('sources.search', { query, sourceIds, typesBySource, searchTimestamp })`.
      - `SearchScreen` (`plugin-sources-ui-desktop`) watches incoming `query`, `sourceIds`, `typesBySource`, and `searchTimestamp` props via `useEffect` and automatically executes `search.searchAll(query, { sourceIds, typesBySource })`, ensuring search scope restrictions chosen in TopBar take immediate effect on the search screen.

3. **TopBar User Profile & Settings Access**:
   - The user profile avatar icon is anchored in the right cluster of the TopBar.
   - Clicking the avatar navigates directly to `settings.view` (Settings Center).
   - Settings is reachable from the tray too: `plugin-settings` contributes its route with
     `placement: ['sidebar', 'tab-bar', 'tray']`, and `Ui.tray` maps tray-placed routes into tray
     items — the shells exclude the id from their sidebars, so the placement only adds
     reachability (the tray icon navigates via `ctx.ui.navigate('settings.view')`).

4. **Safe Service Access in UI Hooks**:
   - Cordis Context instances are strictly scoped (`ctx.inject`). Accessing an un-injected property throws an error at runtime (`cannot get property "<name>" without inject`).
   - Hooks in UI view layers inspecting optional services (e.g., `useSources`, `useLiveSourceIds`, `useSearchSourceOptions`) must always access service instances safely using `serviceOf<T>(ctx, key)` instead of raw member access `(ctx as any)[key]`.

5. **Fullscreen Play Page & Queue Drawer Layering**:
   - The fullscreen play page (`now-playing.view`) is an **overlay stacked on the shell, not a branch swap**: the shell — and every cached page in it — stays mounted underneath (the overlay is `position: fixed`, opaque, z-index 100, rendered as a late child of the shell root). Returning from the play page therefore finds each page exactly as it was left: local state, scroll position and subscriptions intact. Do not reintroduce the early-return branch swap — it unmounted every cached page and was the reason page state evaporated.
   - The **queue drawer floats above the play page**: `ui/navigate 'queue.view'` only toggles the drawer (`isQueueOpen`), never the fullscreen flag, and the drawer renders at z-index 120 while the play page is open (40 otherwise) so it slides over the overlay. Toggling again closes the drawer in place. Above the drawer sit only the share modals (130, via a stacking-context wrapper around `share.host`) and the desktop lyrics window (9999); the queue splitter rides at 125 so the drawer stays resizable over the play page.

6. **Desktop Drag-and-Drop Import & Local Music Navigation**:
   - Dragging audio files or folders from the OS into any part of the desktop window triggers `importDroppedFiles(ctx, files)`.
   - The shell root handles `dragover` and `drop` while displaying an interactive drag overlay; `pointerEvents: 'none'` ensures the drop event reaches the root div while suppressing Chromium's default file navigation.
   - Audio files are imported via `scanner.importFiles`, and their resulting `track_urn` identifiers are queried from `media_bindings`. Folders are registered via `scanner.addSpecifiedDir` with background scan scheduling.
   - After successful import, the shell automatically navigates to `library.local` ("本地文件") passing `{ highlightUrns, highlightUrn: highlightUrns[0] }`.
   - `LocalMusicScreen` automatically switches to the "歌曲" (tracks) view, places the imported tracks at the top of the list in default sort order, auto-scrolls to top (`scrollTop = 0`), and renders a high-visibility accent border and background highlight (`3px solid var(--accent-primary, #5F87FF)` and `rgba(95, 135, 255, 0.18)`) on `LibraryTrackRow` that gracefully fades out after 8 seconds.
   - `LocalMusicScreen` reactively subscribes to `library/changed` and `scan/finished` events to ensure that background folder scans and batch imports immediately reflect in the view.

7. **Recommendation Screen & Bent-Ends Shelf Carousel (`RecommendScreen` & `RecommendShelfRow`)**:
   - **Multi-Source Recommendation Hierarchy**:
     - `RecommendScreen` organizes recommendations into prioritized horizontal shelves:
       1. **Recent Played Albums** (`useRecentPlayedAlbums`): Resolves the 20 most recent unique tracks' albums from `ctx.player.getHistory()`, listening to `player/history-changed`.
       2. **Favorite Albums** (`useFavoriteAlbums`): Shuffles 20 random albums from the user's saved tracks (`ctx.library.listSaved('track')`), listening to `library/changed`.
       3. **Third-Party Source Recommendations** (`RecommendShelf`): Dynamically mounts one shelf per registered music source implementing the `recommend` capability (`useRecommendSources`), with "显示全部" navigating to `RecommendAllScreen`.
   - **Bent-Ends Shelf Carousel Interaction (`RecommendShelfRow`)**:
     - *Curved Outer-Edge 3D Transform*: The currently visible leftmost and rightmost cards bend inward on their outer edges (`perspective(600px) rotateY(±22deg)` with `transformOrigin: right center / left center`), while cards in the middle remain completely flat.
     - *Cylindrical Shading*: Bent cards feature a directional linear-gradient (`rgba(0,0,0,0.62)` fading to transparent) to simulate cylindrical depth and studio lighting.
     - *Boundary-Aware Cancellation*: When the user scrolls to the first card (index 0) or last card (index n-1), the respective side automatically flattens and hides its arrow.
     - *Hover Navigation Arrows*: Large frosted-glass circular buttons (❮ / ❯, 40×40px, font 22px, `backdropFilter: blur(12px)`) float on top of the edges and smoothly fade in on mouse hover (`opacity: 1`, transition `0.18s ease`).
     - *Vertical Scroll Interception Prevention*: Shelf scroll containers enforce `overflowX: 'auto'` and `overflowY: 'hidden'`, ensuring mouse wheel or trackpad vertical gestures pass through cleanly to page vertical scrolling instead of getting trapped in the row.

### 7.2 Secondary Windows and Single-Kernel Preservation

When desktop features require OS-level window detachment — such as **Desktop Lyrics** and the **Mini Player / Dynamic Island** which must float on top of other desktop applications, remain visible when the main window is minimized, support arbitrary multi-monitor dragging, and provide click-through mouse event forwarding when locked:

1. **Single Cordis Kernel Invariant (ADR-3)**: The secondary `BrowserWindow` must **never** call `boot()` or initialize a secondary Cordis Context. Starting a second kernel would split plugin states, duplicate playback hooks, and violate singletons.
2. **Passive View Architecture**: The secondary window runs as a passive React view loaded via query/hash routing (`?window=desktop-lyrics`, `?window=mini-player` or `#mini-player`). It mounts a standalone, lightweight view component directly without activating Cordis plugins.
3. **IPC Forwarding Hub**: The main renderer's UI adapter (`plugin-desktop-lyrics-ui-desktop`, `plugin-mini-player-ui-desktop`) syncs state down to the secondary window through IPC (`window.BBeBee.desktopLyrics.updateData(...)`, `window.BBeBee.miniPlayer.updateData(...)`), and receives user actions back from the secondary window through `sendAction(...)` dispatched to `ctx.player` and the respective feature service.
4. **OS Integration**:
   - Frameless transparent window (`frame: false`, `transparent: true`, `backgroundColor: '#00000000'`, `alwaysOnTop: true`, `skipTaskbar: true`).
   - Free dragging via CSS `-webkit-app-region: drag` and interactive buttons via `-webkit-app-region: no-drag`.
   - Mouse click-through: `setIgnoreMouseEvents(locked, { forward: true })` toggled dynamically upon lock state where applicable.

5. **Desktop Lyrics Interaction Without Drag Regions**:
   - The lyrics window root must never carry `-webkit-app-region: drag`: a drag region swallows the mouse events the hover toolbar depends on (the reason the toolbar once never appeared). Dragging is manual instead — pointer capture plus `desktop-lyrics:set-position` IPC using `screenX/screenY` deltas, and the final position is reported through `desktop-lyrics:commit-position` when the drag ends (programmatic moves are echo-suppressed in main).
   - While locked (click-through), the lyrics window shows a single 解锁 pill at the toolbar spot. Because `forward` is a no-op on Linux, **main polls the OS cursor** (`desktop-lyrics:cursor`) while the window is locked and visible; the renderer shows the pill only while the cursor is over the window and flips mouse handling (`set-ignore-mouse`) as the cursor crosses the pill, so the rest of the window stays click-through.

### 7.3 Mini Player & Dynamic Island Window Architecture

The **Mini Player / Dynamic Island** (`plugin-mini-player` and `plugin-mini-player-ui-desktop`) provides a dedicated secondary floating window with dynamic morphing between a standard floating media pill and an Apple-inspired "Dynamic Island" docked at the screen top:

1. **Three Window States & Seamless Transitions**:
   - **Floating Mini Player (`normal`)**: Compact 380×96px rounded pill with cover artwork, track title, artist, progress scrubber, and media controls. The entire card body is draggable (`-webkit-app-region: drag`), while buttons and interactive sliders opt out (`-webkit-app-region: no-drag`). Includes restore-to-main (`⤢`) and close (`✕`) buttons.
   - **Dynamic Island Capsule (`attached`)**: Ultra-compact 280×50px pill docked flush against the top edge of the active screen. Displays track title, artist, and live audio wave bars (`IslandWaveBars`). Clicking expands into full island view; double-clicking collapses.
   - **Expanded Dynamic Island (`expanded`)**: Expanded 420×184px card docked at the screen top. Features large cover art, track info with marquee scrolling, animated frequency wave bars, timeline scrubber, and transport controls. Double-clicking collapses back to capsule; dragging downward past the detach threshold (>60px) detaches it back into a floating mini player.

2. **Multi-Display Edge Snapping & Detachment**:
   - Handled natively in `MiniPlayerWindowManager` (`apps/desktop/main/mini-player-manager.ts`).
   - When the user drags the floating window within `TOP_SNAP_THRESHOLD` (≤40px) of the top edge of *any* connected display (`screen.getDisplayMatching(bounds)`), the window automatically snaps to horizontal center (`(bounds.width - attachedWidth) / 2`) and transitions to `attached` Dynamic Island mode.
   - Dragging the Dynamic Island downwards past `60px` automatically triggers detachment, resizing and restoring the window back to its previous floating coordinates (`lastFloatingPos`).

3. **Gesture-First Interaction**:
   - Redundant explicit toggle buttons ("折叠灵动岛", "脱离吸附", "吸附到顶部") are omitted to prevent visual clutter.
   - Dragging near the top snaps to island; dragging down detaches; clicking the capsule expands; double-clicking the background collapses back to capsule; clicking the dancing wave bars in the expanded island also collapses back to the capsule.
   - The window is absent from the taskbar (`skipTaskbar: true`) — the main window's entry represents the app in both mini-player and Dynamic Island modes.

4. **Security & Artwork Path Resolution**:
   - Chromium blocks `file://` resources inside renderer documents with `ERR_UNKNOWN_URL_SCHEME` / security violations.
   - `resolveArtworkUri()` in `plugin-mini-player` automatically translates local paths from `file://` to Electron's privileged custom scheme `bbebee-file://`.
   - `IslandArtwork` implements anonymous cross-origin loading (`crossOrigin="anonymous"`, `referrerPolicy="no-referrer"`) and provides error boundary fallback to a crisp vector note icon if an image is corrupted or missing.

5. **Crisp Dark Glass Design Standards**:
   - Translucent dark glass styling (`rgba(18, 18, 18, 0.85)` with `backdrop-filter: blur(24px)`).
   - High-contrast border line (`1px solid rgba(255, 255, 255, 0.08)`).
   - Multi-tier black ambient drop shadows (`0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)`), eliminating excessive fuzzy glow halos or wide white spread rings on transparent windows.

---

## 8. Accessibility

Not a phase-two concern, because retrofitting it is far more expensive than doing it.

- Every interactive element has an accessible name — `accessibilityLabel` on mobile,
  `aria-label` on desktop — supplied through the shared component props so it is written once.
- Desktop is fully keyboard navigable: visible focus rings, logical tab order, `Escape` closes
  every overlay, arrow keys move within lists.
- Mobile respects the OS text-size setting; the token scale is relative, and layouts are tested at
  200%.
- Contrast meets WCAG AA against both palettes — checked in the parity test, not by eye.
- `prefers-reduced-motion` (desktop) and Reduce Motion (mobile) disable the crossfade animations
  and the artwork parallax.
- The visualiser and any flashing element honour reduced-motion and are never the sole indicator
  of state.

---

## 9. Where to go next

[09 — Project Structure](../workflow/structure.md) turns all of this into a directory tree, a
build pipeline, and a set of enforced rules.
