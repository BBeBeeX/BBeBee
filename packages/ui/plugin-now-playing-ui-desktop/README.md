# @bbebee/plugin-now-playing-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-now-playing` (headless): the two "Now playing" surfaces.

## Overview

Binds `now-playing.bar` and `now-playing.view` onto the desktop kit; migrated wholesale from `plugin-player`'s desktop view package. All domain state comes from `@bbebee/plugin-player/hooks`; `ctx.player` is accessed via `inject`. Runtime dependency on the headless package (hooks and view ids).

**Platform shape difference**: on desktop the "Now playing" surface is a **persistent bottom transport bar** (bar) from which the fullscreen play page is opened — a genuinely platform-decided difference, and exactly why ADR-2 accepted writing the views twice.

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'now-playing-ui-desktop'`):

| id | component |
|---|---|
| `now-playing.bar` | `NowPlayingBar` |
| `now-playing.view` | `NowPlayingScreen` |

- **`NowPlayingBar({ ctx, onOpenNowPlaying? })`** — the persistent bottom transport bar (`role="region"` + `aria-label="Now playing"`). Fed by the four headless hooks `useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`. Three-part layout: artwork on the left (click/Enter opens the play page) with the ⏮ / ⏯ / ⏭ `IconButton` trio (**⏯ is one control with two states**, its label flips accordingly); the progress `Slider` in the middle (only wired to `onCommit`, `disabled: !can.canSeek`) with `formatDuration` times on both ends — **`stalled` shows "Buffering…" rather than paused**; volume on the right. Opening the play page prefers the shell's `onOpenNowPlaying`, otherwise `ui.navigate(NOW_PLAYING_VIEWS.nowPlaying)`.
- **`NowPlayingScreen({ ctx, onClose? })`** — the fullscreen play page (centered column). Large artwork (280px), title/artist/album, `Buffering…`, the progress bar and the same three transport keys (same semantics as the bar); close key in the top-left corner (`aria-label="Close now playing"`). When the title cannot be resolved it shows "Loading…" and **never the URN**.
- Artwork is resolved uniformly through `CachedArtwork` (`useResolvedArtwork`): on a cache miss the fallback paints first, and the remote URL is never handed to a second request.

**`bound(ctx, Screen)`** — closes over the context at this plugin's `apply` time (the shell's context has only `ui`; hooks reading `ctx.player` would throw `cannot get property "player" without inject`); must be `h(Screen, …)` rather than a function call.

## Declaration and exports

```ts
export const name = 'plugin-now-playing-ui-desktop'
export const inject = ['ui', 'player']
export function NowPlayingBar / NowPlayingScreen
export async function apply(ctx)      // generator effect: registerView × 2
export default { name, inject, apply }
```

## Tests (`src/screens.test.tsx`)

Static markup assertions (`renderToStaticMarkup`): every transport control's `aria-label`, one play/pause control with two states, `stalled` showing Buffering while still pausable, Seek disabled with no duration, Next disabled at the end of the queue, the `--:--` placeholder, title/artist and the artwork's open button, the fullscreen close key and time display.

## Related docs

- `packages/feature/plugin-now-playing/README.md`: the headless side and view ids
- `packages/ui/plugin-now-playing-ui-mobile/README.md`: the twin half
- `packages/ui/plugin-queue-ui-desktop/README.md`: the queue page (`plugin-queue`)
