# @BBeBee/plugin-queue-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-queue` (headless): the twin half of `plugin-queue-ui-desktop`.

## Overview

The same hooks, the same behaviour — only the elements and shapes differ. Migrated wholesale from `plugin-player`'s mobile view package. `ctx.player` / `ctx.sources` via `inject`; a runtime dependency on the headless package.

## Source files

### `src/index.tsx`

**Registered view** (generator effect `'queue-ui-mobile'`):

| id | Component |
|---|---|
| `queue.view` | `QueueScreen` |

**`QueueScreen({ ctx })`** — an up-next list isomorphic with the desktop (`List` + `TrackRow`, empty state 🎵 "Nothing queued", `active` keyed by `currentItemId`). Row content comes from the headless `useTracksByUrn` (one batched `getTracks` resolution): **artwork + title + artist**; until the catalogue answers, `queueTrackFallback` fills in — the current item borrows the transport's nowPlaying metadata, the rest show "Loading…", and **a URN is never shown**. Tapping calls `playFromContext(urn)` — the track is by definition already in the queue, so the semantics are jump to that item, queue untouched.

**`bound(ctx, Screen)`** — the same as every view package: closes over the context captured by this plugin's `apply`; `h(Screen, …)` rather than a function call.

## Declarations and exports

```ts
export const name = 'plugin-queue-ui-mobile'
export const inject = ['ui', 'player', 'sources']
export function QueueScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## Tests (`src/screen.test.tsx`)

DOM host components (`configureNative`): empty state, row rendering and jumping, no URN shown while the catalogue has not answered, title/artist shown once it has.

## Related docs

- `packages/ui/plugin-queue-ui-desktop/README.md`: the twin half
- `packages/feature/plugin-queue/README.md`: the headless side
- `packages/ui/plugin-now-playing-ui-mobile/README.md`: now playing (this package's counterpart)
- `apps/mobile/`: `configureNative` and the route mount point
