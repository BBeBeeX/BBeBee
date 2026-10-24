# @bbebee/plugin-player-ui-desktop

Layer 5 (ui) — the desktop view package of `plugin-player` (headless).

## Overview

Layout, gestures, and event wiring — nothing else. Every value comes from a headless-package hook, and if an `if` here would also hold in the mobile view, it belongs in `plugin-player/hooks` (docs/08 §1).

**The platform-shape difference**: the desktop "now playing" surface is a **persistent bottom transport bar** rather than a full screen — a difference genuinely decided by the platform, and exactly why ADR-2 accepts paying to write the views twice.

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'player-ui-desktop'`, bound to the headless `PLAYER_VIEWS` ids):

| id | Component |
|---|---|
| `player.now-playing` | `NowPlayingBar` |
| `player.queue` | `QueueScreen` |

**Components**:

- **`NowPlayingBar({ ctx })`** — the persistent bottom transport bar (`role="region"` + `aria-label="Now playing"`, top border separator, `bg.raised` background). Fed by the four headless hooks `useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`. Three-section layout:
  - Left: three `IconButton`s ⏮ / ⏯ / ⏭. **⏯ is one control with two states** (`can.canPause ? '⏸' : '▶'`, the label switching with it) — "a play button that sometimes becomes pause is in every player; two controls is wrong"; availability from `useTransportAvailability` decides `disabled`.
  - Middle: the progress area. **`stalled` is not `paused`**: the UI shows "Buffering…", the lock screen keeps reporting playing, and on underrun neither blinks. The `Slider` takes only `onCommit` ("a scrubber that seeks on every frame is unusable"), `disabled: !can.canSeek`; time labels use `formatDuration`.
  - Right: the 🔇/🔊 toggle + a volume `Slider` (0–100, `onCommit` converts back to 0–1).
- **`QueueScreen({ ctx })`** — the up-next list. Empty queue → `EmptyState` (🎵 "Nothing queued"); otherwise `List<QueueItem>` (`estimatedItemSize: tokens.size.row`, `keyExtractor: item.id`) + `TrackRow`, `active: item.id === state.currentItemId`. Two honest compromises (stated in comments):
  1. The queue holds URNs, not tracks — the row component makes do with `{ urn, title: urn, artists: [] }`, "titles arrive with a later milestone's catalogue reads";
  2. `PlayerService` has no "jump to this queue item" yet, so a row click is `playNow([urn])` rather than pretending to reposition the queue — "an affordance that quietly does the wrong thing is worse than one that does less".

**`bound(ctx, Screen)`** — closes over the context at this plugin's `apply` time (the shell's context carries only `ui`; the hooks reading `ctx.player` there throw `cannot get property "player" without inject` — "throws on device, all tests green" is exactly the shape of that bug, because tests build a root context). Must be `h(Screen, …)` rather than a function call (the hook chain would be misassembled).

## Declaration & exports

```ts
export const name = 'plugin-player-ui-desktop'
export const inject = ['ui', 'player']
export function NowPlayingBar / QueueScreen
export async function apply(ctx)      // generator effect: registerView × 2
export default { name, inject, apply }
```

## Tests

`src/index.test.tsx`: markup assertions for the transport bar and queue screen (control accessibility, the `stalled` copy, empty state).

## Related docs

- `docs/05-audio-playback.md`: the transport state (the `stalled` semantics)
- `packages/feature/plugin-player/README.md`: where the hooks and view ids come from
- `packages/ui/plugin-player-ui-mobile/README.md`: the twin half (full-screen version)
