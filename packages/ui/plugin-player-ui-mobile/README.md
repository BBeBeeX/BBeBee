# @BBeBee/plugin-player-ui-mobile

Layer 5 (ui) — the mobile view package of `plugin-player` (headless): the twin half of the desktop version.

## Overview

The same hooks, the same view ids, the same behavior — only the elements and the **shape** differ. Mobile "now playing" is a **full screen**, not a bottom bar; that is the platform difference ADR-2 accepts paying for. Anything beyond layout and event wiring goes back into `plugin-player/hooks`.

## Source files

### `src/index.tsx`

**Registered views** (generator effect `'player-ui-mobile'`):

| id | Component |
|---|---|
| `player.now-playing` | `NowPlayingScreen` |
| `player.queue` | `QueueScreen` |

**Components**:

- **`NowPlayingScreen({ ctx })`** — the full-screen player (centered vertical stack, `bg.base` background). Uses the same hook set as the desktop transport bar (`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`). Differences:
  - **Artwork first, and large**: `Artwork size: 280, radius: lg` — "on a phone this screen is mostly the artwork; that is the one thing a bottom bar cannot do";
  - Track title `Text variant:'xl' numberOfLines:1` (queue entries behave like desktop: they show the URN, titles arriving with a later milestone's catalogue reads);
  - `stalled` → "Buffering…" (`stalled` is not `paused`, same semantics as desktop);
  - Progress `Slider` (takes only `onCommit`) + times at both ends; the three transport buttons are verbatim the desktop's — ⏯ is still one control with two states, still disabled by the availability hook, with the primary key at `tokens.size.iconLarge`.
- **`QueueScreen({ ctx })`** — the up-next list isomorphic to desktop (`List` + `TrackRow`, empty state 🎵 "Nothing queued", `active` by `currentItemId`, click → `playNow([urn])` — the affordance narrowed for the same reason: `PlayerService` has no "jump to queue item").

**`bound(ctx, Screen)`** — the same as every view package: closes over the context at this plugin's `apply` time; `h(Screen, …)` rather than a function call. The file-header comment records the real on-device incident: the hooks reading `ctx.player` threw `cannot get property "player" without inject` on the device while all tests stayed green (tests build a root context, where an absent service answers `undefined`).

## Declaration & exports

```ts
export const name = 'plugin-player-ui-mobile'
export const inject = ['ui', 'player']
export function NowPlayingScreen / QueueScreen
export async function apply(ctx)
export default { name, inject, apply }
```

## Related docs

- `packages/ui/plugin-player-ui-desktop/README.md`: the twin half (the full description of the transport-bar semantics)
- `packages/feature/plugin-player/README.md`: hooks, view ids, the transport state machine
- `apps/mobile/`: `configureNative` and the route mount points
