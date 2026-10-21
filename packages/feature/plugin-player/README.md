# @BBeBee/plugin-player

Layer 4 (feature) — `ctx.player`: transport, queue, resolution, history.

## Overview

The player decides "**what to play and when**"; `ctx.dsp` decides how it sounds, and `ctx.audio` owns the audio graph — the only point where this plugin touches the latter two is `chainInput` (the source node always connects to it rather than to the destination; the gap in between is the DSP chain, so sources and effects each keep independent lifecycles).

It is the initiator of the `player/before-resolve` waterfall: **the Player does not know where the bytes come from** — `plugin-download` hooks in to swap in a local file, failover retries with a linked URN, and the Player does not change by a single line (this is the control arm of the "playback behaves identically with or without plugin-download" comparison test).

## Service declaration

- `class Player extends Service implements PlayerService`, `super(ctx, 'player')` → `ctx.player` (interface in `protocol/src/services/audio.ts`).
- Required injections: `['audio', 'sources', 'db']`.
- Optional injections (nested `ctx.inject`, degrades instead of crashing when missing): `['mediaSession']` (lock screen / system media controls), `['ui']` (contributes route/command), `['background']` (wake lock and pre-suspend checkpoint).
- Implicit reads (duck typing): `ctx.device.network()` (metered network → `saveData`), `ctx.codec.supportedFormats()`.

**Capabilities**: `audio`, `mediaSession`, `background`, `db:read:core`, `db:write:core` (the queue/state/history tables all live in the `core` namespace; the two verbs do not nest, so both are required).

## Source files

### `src/index.ts` — the main `Player` service

**Public API (the `ctx.player` surface)**:

| Method | Purpose |
|---|---|
| `state` / `queue` | Transport state snapshot / queue items (storage order) |
| `play()` / `pause()` / `togglePlay()` / `stop()` | Basic transport. Pausing during `loading` relies on `playIntent=false` being honored once loading finishes; `stalled` counts as playing. |
| `seek(ms)` | While paused, uses the play-then-pause trick to make the media element seek |
| `next()` / `previous()` | previous seeks to 0 and "replays the current track" when position > `previousThresholdMs` (default 3s) |
| `setVolume/setMuted/setRepeat/setShuffle` | Delegates to `ctx.audio` + state + persistence; enabling shuffle generates a new seed |
| `playNow(urns, opts?)` | **Replaces the whole queue**: filtered through the `player/before-enqueue` waterfall → swap queue → locate the target song (in shuffle mode calls `rotateShuffle` to rotationally shift the permutation so the target song lands on top as track 0 while preserving the rest of the random upcoming sequence) → plays the target track |
| `playFromContext(urn, contextUrns?, opts?)` | **On-demand playback in a list context**: if the URN is already in the queue (in play order, including shuffle) → the queue is untouched, jump to that item; if not → replace the whole queue with `contextUrns` (the list the clicked row belongs to, e.g. album/local library) and start from the clicked position; if context is missing or does not contain the song → single-track playback |
| `enqueueNext / enqueueLast / removeItems / moveItem / clearQueue` | Queue operations. Removing the currently playing track calls `stop()` rather than silently skipping; `moveItem` writes exactly one row (the payoff of fractional index) |
| `upcoming()` / `refresh()` | The "up next" in play order; one tick of the 1 Hz clock (emits `player/position`, drives prefetch/crossfade/throttled persistence) |

**Playback resolution flow (URN → playable stream)**: end the previous track → set `loading`, emit `player/track-changed` → **gapless fast path** (attach directly if prefetch hit) → otherwise `resolveStream` (build `StreamPrefs` → `player/before-resolve` waterfall → `ctx.sources.forUrn(...).resolveStream`) → `ctx.audio.load(handle.target, { strategy, ... })` → attach to `chainInput`. Strategy selection: remote → `stream`; local larger than `bufferMaxBytes` (default ~150MB) → `stream` (a buffered node holds decoded PCM, roughly 10x the file size); otherwise `buffer`.

**Error handling**: dispatched by `SourceError.code` — `auth` → emit `source/auth-expired` (serial) then stop; `rate-limit` → retry once after `retryAfterMs`; `network` → exponential backoff, 3 retries; `not-found` → `markUnavailable` (grey out) then skip. `maxSkipStreak` (default 10) prevents an infinite skip storm under repeat-all.

**Platform policy (interruption table, docs/05 §5)**: interruption `began` pauses and remembers "we were the one who paused"; `ended + shouldResume` resumes only in that case; **route `device-removed` (headphones unplugged / Bluetooth dropped) pauses immediately and never resumes on its own** — not configurable.

**Key invariants**: `playIntent` resolves the race where "the autoplay flag is stale by the time loading finishes" (pressing play then immediately pause must not start playing on its own); teardown order: clear ticker → cancel prefetch → clear fading → settle the in-flight play → detach → release wake lock → force persistence; mediaSession teardown must `clear()`, otherwise the lock screen keeps a "ghost track".

### `src/queue.ts` — queue model (pure logic, no audio/DB/clock)

`QueueModel` + `permute` (seeded Fisher–Yates). Core decisions:

1. **Position is a fractional index key** (base-36 string, from the protocol's `between`/`sequence`, Greenspan midpoint algorithm): after `move()` computes the new key it **UPDATEs exactly one row**; keys are `ORDER BY` lexicographically — sorting is left to SQLite. Dragging one song in a 5000-track queue does not rewrite the tail.
2. **Shuffle = seed + deterministic permutation**: `mulberry32` PRNG. A new seed is generated each time shuffle is enabled (re-shuffling is not the same order), and the seed is persisted (same order after restart) — so `previous()` is meaningful and the UI can faithfully show upcoming.
3. **Shuffle on-demand rotation (`rotateShuffle(firstId)`)**: when a specific song in the list is requested in shuffle mode, the current pseudo-random permutation is cyclically rotated so the target song plays immediately first while the rest keep their established random upcoming order, avoiding skipping to unrelated songs when requesting a track in shuffle mode.
4. **$O(1)$ Hash Index & $O(N)$ Upcoming Guarantee**: `QueueModel` maintains an internal `entryMap = new Map<string, QueueEntry>()` and lazy `itemsCache` (invalidated on mutation). `entry(id)` is an $O(1)$ map lookup instead of an $O(N)$ linear scan, guaranteeing `upcoming()` and queue traversal run in linear $O(N)$ time instead of quadratic $O(N^2)$ slowdowns when the queue contains thousands of tracks (e.g. 3,000+ songs).

`next()`/`previous()` respect `repeat`: `'one'` repeats in place (no re-resolve; reuses the loaded buffer); wrap-around only under `'all'`.

### `src/store.ts` — `PlayerStore`: SQL persistence layer (pure SQL, no events)

| Method | Table | Notes |
|---|---|---|
| `loadQueue / replaceQueue / insertQueue / removeQueue` | `queue_items` | replace is a DELETE + re-insert inside one transaction; `playback_state.current_item_id` is `ON DELETE SET NULL`, so **swap the queue first, then save state**. Corrupted `source_context_json` only loses one row of "came from" info; it does not take down plugin init. |
| `moveQueueItem` | `queue_items` | **one-row** UPDATE |
| `loadState / saveState` | `playback_state` | single-row table UPSERT (currentItemId, positionMs, repeat, shuffle, seed, volume, muted) |
| `recordPlay(record)` | `play_history` + `track_stats` | **one transaction**: append the fact row (`scrobble_state='pending'`) + UPSERT derived stats |
| `markUnavailable(urn)` | `tracks` | `available = 0`: grey out rather than hide |
| `nowPlaying(urn)` | tracks ⋈ albums ⋈ artworks | lock-screen metadata; artwork only for local Uri |

### `src/hooks.ts` — React hooks shared by the two UI shells

Logic written once (ADR-2: logic lives in the headless package, JSX written twice), built on `ui-core`'s `useServiceState`:

| Export | Description |
|---|---|
| `useTransport(ctx)` | Subscribes to `player/state-changed` + `player/track-changed` |
| `useQueue(ctx)` | Subscribes to `queue/changed`; element-wise comparison, so no re-render of a 5000-row list when content is unchanged |
| `useTracksByUrn(ctx, urns)` | Batch resolution of URN → catalog rows (`ctx.sources.getTracks`, one chunked read). Cached in a Context-scoped `WeakMap<Context, Map<string, Track>>` with `shallowArrayEqual` comparison to eliminate duplicate queries across renders and prevent cross-context test leakage; `library/changed` clears the cache. Read via `serviceOf` — the catalog is an **enhancement, not a dependency**: a missing sources service or a URN the catalog cannot answer yields an empty map, and the view falls back to `queueTrackFallback` |
| `queueTrackFallback(item, nowPlaying, isCurrent)` | What a queue row shows before the catalog answers / when it is absent: **never show the URN** — the current item borrows the transport's nowPlaying (artwork/title/artist, which the player already resolves for the lock screen), everything else shows "Loading…". Being stuck on Loading… forever is a cache bug, not a reason to fall back to the URN |
| `usePosition(ctx)` | **rAF interpolation hook**: anchored on the 1 Hz `player/position`, with `requestAnimationFrame` filling frames. Updates ~60 times per second; only for progress bars/time labels |
| `useTransportAvailability(ctx)` | `{ canPlay, canPause, canSeek, canNext, canPrevious }` — control availability decided in one place |
| `useDuration(ctx)` | Returns only when `durationMs > 0`, distinguishing "unknown" from live streams |
| `isPlayingLike(status)` | The user's view: `playing \|\| stalled \|\| loading`. ⚠️ **Intentionally different** from the service-side private version (no `loading`): that one is audio semantics, this one is the user's view |
| `formatDuration(ms?)` | `mm:ss` / `h:mm:ss`; invalid input `--:--` |

### `src/contributions.ts` — contributed id constants

```ts
PLAYER_COMMANDS = { togglePlay: 'player.togglePlay', next: 'player.next', previous: 'player.previous' }
```

Init registers only three commands (`togglePlay` defaults to the `Space` key; commands do not depend on views — the command palette on desktop, the more-menu on mobile). **No route, no slot, no view**.

> All three playback surfaces have been split into surface plugins: the full-screen player and the persistent transport bar/mini bar live in `plugin-now-playing` (`now-playing.view` / `now-playing.bar`), the up-next queue in `plugin-queue` (`queue.view`). The transport service should not change because one screen changed. The hooks (`useTransport`/`usePosition`/`useDuration`/`useTransportAvailability`/`useQueue`/`useTracksByUrn`) stay in `plugin-player/hooks`, alongside the service.

## Events

| Direction | Events |
|---|---|
| Emits | `player/state-changed`, `player/track-changed`, `player/position` (1 Hz; UI interpolates with rAF, polling forbidden), `player/error`, `queue/changed` |
| Dispatched (others listen) | `player/track-completed` (`ctx.parallel`, consumed by the scrobbler), `source/auth-expired` (`ctx.serial`) |
| Initiates waterfalls | `player/before-resolve`, `player/before-enqueue` (listeners mutate the argument in place then call `next()` — Cordis's `next` takes no argument) |

## Configuration (`PlayerConfig`)

`previousThresholdMs=3000`, `transition='gapless'` (`'gapless'|'crossfade'|'neither'` — mutually exclusive; doing both would double-fade), `crossfadeMs=0`, `tickMs=1000`, `saveThrottleMs=5000`, `retryBackoffMs=500`, `bufferMaxBytes≈150MB`, `maxSkipStreak=10`, `stallTimeoutMs=30000`, `deviceId='this-device'` (reserved for multi-device sync).

**Prefetch/gapless/crossfade**: the prefetch window is `max(15s, crossfadeMs+5s)`, resolving the **next** track inside `refresh()` and it must preload with the buffer strategy (a seamless handover cannot wait on a network read); during crossfade the outgoing source goes into `fading` and is reclaimed by a timer later (disposing immediately would mute the ramp forever); **identity moves with the audio** — on handover update `currentItemId` and emit `track-changed`, otherwise the transport/lock screen/history all believe the previous track is still playing.

## Related docs

- `docs/05-audio-playback.md`: transport state machine, interruption table, DSP
- `docs/07-data-model.md`: `queue_items`/`playback_state`/`play_history`/`track_stats`
- `packages/core/core-audio-mpv/`: the audio engine implementation
