# @BBeBee/plugin-now-playing-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-now-playing` (headless): the twin half of `plugin-now-playing-ui-desktop`.

## Overview

The same hooks, the same two surfaces — the fullscreen player and the mini-player bar — with only elements and shapes differing. Migrated wholesale from `plugin-player`'s mobile view package. `ctx.player` via `inject`; runtime dependency on the headless package.

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'now-playing-ui-mobile'`):

| id | component |
|---|---|
| `now-playing.view` | `NowPlayingScreen` |
| `now-playing.bar` | `NowPlayingBar` |

- **`NowPlayingScreen({ ctx, onClose? })`** — fullscreen player (centered column on `bg.base`). Same hook set as desktop. **Artwork first and large** (200px) — "on a phone this screen is mostly the artwork, the one thing a bottom bar cannot do"; title `numberOfLines: 2`; `stalled` → "Buffering…"; the progress `Slider` is only wired to `onCommit`; the three transport keys are verbatim the same as desktop (⏯ one control with two states, availability hooks decide `disabled`).
- **`NowPlayingBar({ ctx, onOpenNowPlaying? })`** — the mini-player bar: artwork + title/artist + ⏯, the whole strip a `Pressable` that opens fullscreen (`accessibilityLabel: 'Open now playing'`). When idle with no track it **takes no height** (`display: 'none'`). Opening prefers the shell's `onOpenNowPlaying`, otherwise `ui.navigate(NOW_PLAYING_VIEWS.nowPlaying)`.
- Artwork is resolved uniformly through `CachedArtwork` (`useResolvedArtwork`).

**`bound(ctx, Screen)`** — as in every view package: closes over the context at this plugin's `apply` time; `h(Screen, …)` rather than a function call.

## Declaration and exports

```ts
export const name = 'plugin-now-playing-ui-mobile'
export const inject = ['ui', 'player']
export function NowPlayingBar / NowPlayingScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## Tests (`src/screen.test.tsx`)

DOM host components (`configureNative`): the mini bar renders title/artist and play/pause, tapping ⏯ triggers `togglePlay`, tapping the bar triggers `onOpenNowPlaying` and navigates to `now-playing.view`; the fullscreen screen renders title/artist/album, the close key callback, and Next triggers `next`.

## Related docs

- `packages/ui/plugin-now-playing-ui-desktop/README.md`: the twin half
- `packages/feature/plugin-now-playing/README.md`: the headless side
- `packages/ui/plugin-queue-ui-mobile/README.md`: the queue page (`plugin-queue`)
- `apps/mobile/`: `configureNative` and the route mount points
