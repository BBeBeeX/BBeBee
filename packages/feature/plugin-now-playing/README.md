# @bbebee/plugin-now-playing

Layer 4 (feature) — **the two faces of "now playing"**: the full-screen player and the persistent transport bar, split out of `plugin-player`.

## Overview

A **surface plugin**:

- Owns the route `now-playing.view` (`/now-playing`, tab-bar, order 10) and the **view id** of `now-playing.bar`;
- **Declares no service key** — transport state and the queue belong to `ctx.player`; the hooks that read them (`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`) stay in `plugin-player/hooks`, next to the service;
- The queue page (`queue.view`) lives in `plugin-queue`: "what is up next" and "what is playing now" are two different questions, and the queue model is the player's.

The benefit of the split: `plugin-player` no longer changes because a screen does; the player page can evolve on its own (visualization, lyrics, artwork themes) without touching the transport state machine.

## Source files

### `src/index.ts`

`apply(ctx)`:

1. `ctx.logger.info('plugin-now-playing: loaded')`;
2. `ctx.inject(['ui'], scoped => scoped.effect(function*(){ yield scoped.ui.contribute({ kind: 'route', id: NOW_PLAYING_ROUTES.nowPlaying, path: '/now-playing', title: 'Now playing', icon: 'play', placement: ['tab-bar'], order: 10 }) }, 'now-playing-ui-contributions'))`.

`placement: ['tab-bar']` is unchanged from before the split: on mobile the full-screen player is a tab, on desktop it is opened from the transport bar — a tab for a screen the bar already reaches would be a second door to the same room. A build without `ui` does not get stuck (an inactive child fiber just contributes nothing).

### `src/views.ts`

```ts
NOW_PLAYING_VIEWS = { nowPlaying: 'now-playing.view', bar: 'now-playing.bar' }
NOW_PLAYING_ROUTES = { nowPlaying: 'now-playing.view' }   // the bar is not a route; it is a view the shell takes by id
```

## Tests

`src/index.test.ts` (4) — registers the route descriptor (asserted verbatim), loads fine without `ui`, and two unload snapshots (with/without ui) show no leaks.

## Exports

```ts
// '.'
export const name = 'plugin-now-playing'
export function apply(ctx)
// './views': NOW_PLAYING_VIEWS / NOW_PLAYING_ROUTES
```

## Related docs

- `docs/05-audio-playback.md`: the transport state machine (`ctx.player`)
- `docs/08-ui-architecture.md` §2–§3: descriptors, the two shells, placement
- View halves: `packages/ui/plugin-now-playing-ui-desktop/`, `packages/ui/plugin-now-playing-ui-mobile/`
- The package it was split from: `packages/feature/plugin-player/README.md`
