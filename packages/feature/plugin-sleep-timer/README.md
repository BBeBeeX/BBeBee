# @BBeBee/plugin-sleep-timer

Layer 4 (feature) — `ctx.sleepTimer`: manages the sleep-timer stop-playback logic.

## Overview

Supports stopping playback after a set countdown (e.g. 5min / 10min / 15min / 30min / 45min / 1h / custom minutes), at a specified point in time, or automatically when the current track ends.

Deliberately headless: it only manages the timer state and calls `ctx.player.pause()`, with no platform-specific dependencies.

## Source files

### `src/index.ts`
- `SleepTimer extends Service` (occupies the `ctx.sleepTimer` service key):
  - `startDuration(ms)`: set a countdown in milliseconds; playback pauses when it expires.
  - `startAtEpoch(epochMs)`: set a target timestamp; playback pauses when it expires.
  - `startEndOfTrack()`: listens for track completion (`player/track-completed` or playback ended via `player/state-changed`) and pauses when the track ends naturally.
  - `cancel()`: cancel the currently running timer.
  - `state`: the current timer state `{ active, mode, targetEpochMs, durationMs }`.

### `src/hooks.ts`
- `useSleepTimer(ctx)`: a reactive React hook subscribing to `sleep-timer/changed` and `sleep-timer/fired`.
