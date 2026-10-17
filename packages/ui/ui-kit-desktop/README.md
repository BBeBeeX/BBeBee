# @BBeBee/ui-kit-desktop

Layer 5 (ui) — the desktop half of the React DOM parity component set.

## Overview

Twinned with `ui-kit-mobile`: same component names, same props (the types live in `ui-core/props.ts`, consumed by both ends and overridden by neither), the same `ui-tokens`. It is **not a plugin** (no `BBeBee.plugin.json`) — a pure component library consumed by the `plugin-*-ui-desktop` view packages and the host shell.

- Runtime dependencies: `react` + `react-dom`, `@tanstack/react-virtual` (virtualization), `ui-core` (types), `ui-tokens`, `protocol` (`Track`/`ArtworkRef` types).
- Desktop may use the DOM, but it is equally forbidden from touching platform **capabilities** — "a component that needs fs is in the wrong layer".
- exports subpaths: `.`, `./manifest` (the parity declaration), `./testing` (monorepo tests only), `./package.json`.

## Source files

### `src/index.tsx` — the 11 parity components

Every component carries `CommonProps` (`testID` → `data-testid`; `accessibilityLabel` → `aria-label`). Colors always come from `palettes[scheme]` (the module-level `scheme` defaults to `'dark'`, set by the shell's `setScheme()` at boot; rendering outside a scheme it is the fallback), **never inline color values** — the two kits look like one product because they read the same numbers.

| Component | Props | Responsibility & notes |
|---|---|---|
| `Button` | `children*`, `onPress*`, `variant?` (primary/secondary/ghost/danger), `disabled?`, `loading?` | A real `<button type="button">`. `loading` both disables and shows `aria-busy="true"`, swapping the label for `…` (guards against double-submit). **The focus ring cannot be removed** — `outline: none` is the #1 way a kit breaks keyboard navigation, and a test pins it. |
| `IconButton` | `icon*`, `onPress*`, `accessibilityLabel*` (required), `variant?`, `disabled?`, `size?` | The whole surface is one icon. Square, `width = tokens.size.touchTarget` (44px) — however small the icon, the platform's minimum touch target is met (a test pins that size=8 is still 44px). |
| `TextField` | `value*`, `onChange*`, `placeholder?`, `multiline?`, `rows?`, `secure?`, `disabled?`, `error?`, `autoCorrect?` | **Controlled on both ends.** `multiline` → `<textarea rows>` (pasted source documents), otherwise `<input type=text\|password>` (single-line rules — a textarea that swallows Enter will not do). `spellCheck={autoCorrect ?? false}` defaults off: rules/URLs are spelling-sensitive. `error` renders as a red Text under the field, **not a hover title** (touch has no hover, screen readers cannot read a title). multiline uses a mono font (only a monospace face reveals an unclosed bracket). |
| `Text` | `children?`, `variant?` (xs…display), `tone?`, `numberOfLines?` | **The only place in the whole app allowed to decide font size**, accepting scale names only. `numberOfLines` uses `-webkit-line-clamp`. |
| `Artwork` | `artwork?`, `size*`, `radius?` | Cover art. `dominantColor` renders as the **background** before the image — no grey flash while loading, no layout shift while scrolling. Without a `sourceUrl` only the color block renders. `<img loading="lazy" alt="">` — the `alt=""` is deliberate: the row component already speaks the track name; a decorative image should be silent to screen readers. |
| `TrackRow` | `track*`, `onPress?`, `onMore?`, `active?`, `showArtwork?`, `showAlbum?` | **The most-rendered component in the app.** Title + comma-joined artists; `active` = now playing (not selected). `onMore` binds **right-click** on desktop (`onContextMenu`). Keyboard reachable: `tabIndex=0` + Enter/Space, `role="row"`. |
| `Slider` | `value*`, `max*`, `onChange?` (while dragging), `onCommit?` (on release), `disabled?` | A native `<input type="range">`; keyboard stepping comes free; `onPointerUp`/`onKeyUp` commit, `onBlur` clears dragging; `aria-valuenow`/`aria-valuemax`. |
| `Sheet` | `open*`, `onClose*`, `title?`, `children?` | The modal interrupt surface: full-screen scrim + centered panel (width 320–560), `role="dialog"` + `aria-modal`; **Escape closes**; clicking the scrim closes, `stopPropagation` inside the panel. |
| `List<T>` | `items*`, `renderItem*`, `keyExtractor*`, `estimatedItemSize?`, `onEndReached?`, `empty?`, `header?`, `sticky?`, `stickyHeader?`, `onScroll?` | `@tanstack/react-virtual` windowing (`overscan: 8`), a spacer stretching the full scroll height (the scrollbar reflects the whole library). **`aria-setsize` (the real total) + `aria-posinset`** — windowing is invisible to the sighted and a disaster for screen readers unless the true length is spoken. `onEndReached` is decided by the "last rendered row" inside an effect, and a `firedFor` ref guarantees **one request per page**. `count === 0 && empty` renders the empty state — "a blank pane cannot say whether it is loading, broken, or truly empty". **`header`** scrolls away with the list (the detail pages' collapsing fading header). **`sticky`** is the sticky bar — it must be a **direct child** of the scroll container: `position: sticky` only sticks within its parent box, and nesting it in the header would scroll it away exactly as it takes shape; a net-zero flow height (`marginBottom: -height`) keeps it out of the offset math. **`stickyHeader`** is the frozen table header — likewise a direct child of the scroll container; nested inside the header box it would be the parent's last child and could not stick at all; the virtualization offset is computed from the **spacer's measured position** (`scrollMargin`, measured at mount and kept fresh by a `ResizeObserver` + internal scroll listener), with the row transform cancelled accordingly. **`onScroll`** reports `scrollTop` on every scroll event, driving the sticky bar's slide-in and docking. |
| `EmptyState` | `title*`, `description?`, `action?`, `icon?` | What a screen shows when it has no content yet — **never a blank area**. |
| `Toast` | `message*`, `tone?`, `action?`, `onDismiss?` | Transient feedback, "announced but not focus-stealing": `role="status"` + `aria-live="polite"`. |

**Kit-level export**: `setScheme(next: Scheme)` (called by the shell at boot).

**Desktop-only extensions** (not in the parity manifest; mobile has no counterpart): `ContextMenu` (right-click menu + fly-out submenus, with search filtering and an inline New playlist row at the top), `SaveToPlaylistPopover` (the heart button's "Add to playlist" popover, min height 480px, folder fly-out 320px, capped by the viewport; clicking "New playlist" seamlessly expands the create input in place of the top search field, auto-focused and answering Escape/Enter, while the list's New playlist row hides itself to avoid confusion; the confirm button uses `flexShrink: 0` and `whiteSpace: 'nowrap'` so it cannot be squeezed into wrapping), `StickyDetailBar` (the sticky bar after a detail page collapses on scroll: title + play button, slide-in and docking both functions of `progress`, `pointer-events` following the fade so the invisible bar cannot eat the hero's clicks), `useImageColor` / `headerGradient` / `tintRgba` / `extractVibrantColor` (cover-derived theme color: `dominantColor` first, else one canvas sampling pass, `undefined` on failure → the caller's neutral gradient; the gradient tapers off the header's bottom edge by percentage, content below and the frozen table header both solid `--bg-primary`), `DetailTableHeader` (the sticky table header: declarative columns (width/flex/alignment/icon/plain columns/visible columns/source sort keys), hover divider and sort arrows kept inside the component, no arrows by default, letting each detail page interactively sort the "Source" column), `DetailPlayButton` (the circular primary play button, disabled rather than hidden) and `DetailHero` (the hero header: eyebrow/two-line truncating title/subtitle/meta slot/cover slot; column stacking without a cover, bottom-aligned row with one). The sort dropdown's entry builder lives in `ui-menus` (`sortMenuItems`). `viewModeMenuItems` / `useViewMode`.

### `src/manifest.ts` — the parity declaration

Writes the kit's exported components and props as **data** (`KIT_TARGET = 'desktop'`, `COMPONENT_PROPS`, `COMPONENT_EXPORTS`). Zero imports except `import type { KitPropMap }` — React's parameter names are erased at runtime, and runtime reflection "is more suspect than this manifest itself". **Verbatim isomorphic** with the mobile manifest (except the target); `ui-parity` uses it to enforce parity in CI with no DOM and no device.

### `src/testing.ts` — `withListLayout(body)` (not shipped with the package)

The desktop `List`'s virtualizer measures the scroll container's `offsetHeight/offsetWidth`, and jsdom does no layout (measuring zero → rendering an empty window → every row-count test failing for an unrelated reason). This helper temporarily stubs those two properties: `role="list"` elements report a viewport height of 400, everything else a row height of 56 (exactly `tokens.size.row`). **Async bodies are supported** — the virtualizer measures in a layout effect, and restoring the sizes too early makes the second measurement zero. The original descriptor is restored afterwards; nothing leaks across tests. Philosophy: **measure rather than mock away the virtualizer** — a test that stubs the virtualizer only proves the stub can window correctly. There is exactly one virtualizer, so fake it once.

## Tests

`src/index.test.tsx` (jsdom): most components use `renderToStaticMarkup` for **static markup assertions** — what is worth pinning is the *accessible* output (controls have names, roles a screen reader can use, focus ring not removed); `List` is the exception, running in a real DOM + `withListLayout`: 10000 items render only the window, `aria-setsize="10000"`, the spacer covering the whole library, the empty state rendering, `onEndReached` firing once. Per-component coverage details are on each component's row.

## Related docs

- `docs/08-ui-architecture.md` §6/§8: the parity contract and the accessibility gate
- `packages/ui/ui-kit-mobile/README.md`: the twin half
- `packages/ui/ui-parity/README.md`: the gate itself
