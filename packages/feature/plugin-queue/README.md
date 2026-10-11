# @BBeBee/plugin-queue

Layer 4 (feature) — **the up-next queue page**, split out of `plugin-player`.

## Overview

A **surface plugin**:

- Owns the route `queue.view` (`/queue`, tab-bar + sidebar, order 20) and its view id;
- **Declares no service key** — the queue model (ordered items, the current item, jump semantics) belongs to `ctx.player`; the hooks that read it (`useQueue`/`useTracksByUrn`/`queueTrackFallback`) stay in `plugin-player/hooks`, next to the service;
- Division of labor with `plugin-now-playing`: that plugin handles "what is playing now" (full screen + transport bar), this one handles "what plays next".

The benefit of the split: `plugin-player` now has no route/view at all (only three commands remain), and the transport service no longer changes because a screen does.

## Source files

### `src/index.ts`

`apply(ctx)`: `ctx.logger.info('plugin-queue: loaded')`, then `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: QUEUE_ROUTES.queue, path: '/queue', title: 'Queue', icon: 'list', placement: ['tab-bar', 'sidebar'], order: 20 }) }, 'queue-ui-contributions'))`.

A build without `ui` does not get stuck (an inactive child fiber just contributes nothing).

### `src/views.ts`

```ts
QUEUE_VIEWS = { queue: 'queue.view' }
QUEUE_ROUTES = QUEUE_VIEWS   // same values
```

## Tests

`src/index.test.ts` (4) — registers the route descriptor (asserted verbatim), loads fine without `ui`, and two unload snapshots (with/without ui) show no leaks.

## Exports

```ts
// '.'
export const name = 'plugin-queue'
export function apply(ctx)
// './views': QUEUE_VIEWS / QUEUE_ROUTES
```

## Related docs

- `docs/05-audio-playback.md` §2: the queue and transport state
- `docs/08-ui-architecture.md` §2–§3: descriptors, the two shells, placement
- View halves: `packages/ui/plugin-queue-ui-desktop/`, `packages/ui/plugin-queue-ui-mobile/`
- The package it was split from: `packages/feature/plugin-player/README.md`
