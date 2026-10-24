# @bbebee/plugin-queue-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-queue` (headless): the up-next queue screen.

## Overview

Binds `queue.view` to the desktop kit, migrated wholesale from `plugin-player`'s view package. All domain state comes from `@BBeBee/toolkit/hooks` (React bindings consumed across features are unified in toolkit; the queue model still belongs to player); `ctx.player` / `ctx.sources` are accessed via `inject`. A runtime dependency on the headless package (view ids).

## Source files

### `src/index.tsx`

**Registered view** (generator effect `'queue-ui-desktop'`):

| id | Component |
|---|---|
| `queue.view` | `QueueScreen` |

**`QueueScreen({ ctx, onClose })`** — a drawer page for the play queue and the recently played history, with a two-tab switch at the top:
- **"Queue" tab**:
  - **Now playing**: highlights the currently playing track (green title, waveform indicator); when nothing is queued it says "No more songs queued".
  - **Next up**: shows the upcoming sequence; when it carries a source context it displays "Next up from: {label}".
  - An empty queue shows the `EmptyState` (🎵 "Nothing queued").
  - Row content is resolved via windowed `useTracksByUrn`: artwork + title + artist; until ready, `queueTrackFallback` degrades gracefully and never shows a raw URN.
  - **Large-Queue Scalability (3,000+ tracks)**:
    - **Viewport sliding window hydration**: Tracks the virtual scroll position via `onScroll` on `List` and only queries metadata for current track plus a sliding slice (`[windowStart - 15, windowStart + 60]`). Opening a 3,000-song queue queries $< 150$ tracks instead of 3,000 all at once.
    - **Tab isolation**: When the user switches to "Recently played", queue URN hydration is suspended, avoiding unnecessary catalogue queries and re-renders.
    - **Synchronous artwork cache**: `useResolvedArtwork` yields cached artwork paths synchronously on initial mount, eliminating row layout shifts and re-renders in virtualized lists.
  - Clicking a row calls `playFromContext(urn)` to jump to that item.
- **"Recently played" tab**:
  - reads the history through `usePlayHistory` and strictly **deduplicates** by `trackUrn` (keeping the track's most recent play record and time).
  - The right side shows relative times (e.g. "just now", "5 min ago", "2 hr ago").
  - Clicking a row calls `playFromContext(record.trackUrn, uniqueHistoryUrns)`, playing with the deduplicated history as the context queue.
  - No records shows the `EmptyState` (🎵 "No play records yet").

**`bound(ctx, Screen)`** — closes over the context captured by this plugin's `apply` (the shell's context only has `ui`; hooks reading `ctx.player` would throw `cannot get property "player" without inject`). Must be `h(Screen, …)` rather than a function call.

## Declarations and exports

```ts
export const name = 'plugin-queue-ui-desktop'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)      // generator effect: registerView × 1
export default { name, inject, apply }
```

## Tests (`src/screens.test.tsx`)

- empty state and placeholder copy assertions;
- queue row rendering, green highlight on the current track, and the "Next up" context heading;
- no raw URN shown while the catalogue has not resolved;
- row clicks trigger `playFromContext` to jump rather than re-enqueue;
- Recently played tab switching and list rendering;
- Recently played tab dedup by `trackUrn`: the same song played many times shows only one row with the latest record, and row clicks carry the deduplicated context URN list;
- queue row context-menu action items;
- 3,000-song queue windowing test: ensures mounting a 3,000-track queue issues $< 150$ URN requests instead of fetching all 3,000 tracks.

## Related docs

- `docs/05-audio-playback.md`: transport state and the queue
- `packages/feature/plugin-queue/README.md`: the headless side and view ids
- `packages/ui/plugin-queue-ui-mobile/README.md`: the twin half
- `packages/ui/plugin-now-playing-ui-desktop/README.md`: now playing (this package's counterpart)
