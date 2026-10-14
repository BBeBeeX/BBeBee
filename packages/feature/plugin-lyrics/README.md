# @BBeBee/plugin-lyrics

Layer 4 (feature) — `ctx.lyrics`: lyrics fetching, multi-level caching, progress sync, and unified state.

## Overview

`plugin-lyrics` manages the lyrics lifecycle during audio playback. It bridges the playback transport, the source system, and the local persistence layer, providing consistent sync state and event subscriptions for UI consumers (such as the full-screen lyrics panel on the now-playing page and desktop floating lyrics).

When the track changes, the plugin automatically starts the lyrics fetch flow, and as playback advances (via the `player/position` event and internal algorithms) it computes the index of the currently sung lyric line and broadcasts it to the whole app.

## Service declaration

- `class LyricsPlugin extends Service implements LyricsService`, `super(ctx, 'lyrics')` → `ctx.lyrics` (interface defined in `@BBeBee/protocol`).
- **Required injections**: `['player', 'db', 'sources']`.
- **Optional injections**: `['ui']` (if present, declares the `now-playing.panel` slot descriptor).
- **Capabilities**: `db:read:core`, `db:write:core` (reads/writes the `lyrics` table of the core SQLite catalog).

## Core mechanics

### 1. Multi-level caching and fetch strategy

Calling `getLyricsForTrack(trackUrn)` follows a three-level cache fallback strategy:

```
[ Request lyrics ]
    │
    ▼
1. In-memory LRU cache (memoryCache) ──── hit ───► return
    │ miss
    ▼
2. Local SQLite (lyrics table) ───────── hit ───► fill memory ───► return
    │ miss
    ▼
3. Source provider (ctx.sources.forUrn) ── hit ───► persist to DB & memory ───► return
    │ failure / no provider
    ▼
[ State set to no-lyrics or error ]
```

1. **Memory cache**: quickly handles switching back and forth within a list, with a default capacity limit, avoiding repeated deserialization.
2. **SQLite storage**: persists fields `(track_urn, format, content, synced, offset_ms, language)` in the `lyrics` table; available offline and saves user bandwidth.
3. **Source resolution**: finds the matching source provider via `ctx.sources.forUrn(trackUrn)`. If the provider supports `getLyrics(trackId)`, a request is made and parsed (e.g. subtitles converted to LRC, or the Subsonic lyrics API); the result is automatically written back to the database.
4. **Negative caching**: if the source provider has no lyrics or returns empty content, the system writes an empty marker (`format: 'none'`) into both the in-memory `negativeCache` and the SQLite database, with a default TTL of 1 day (24 hours). While valid, replaying that track short-circuits network requests entirely, preventing wasted network overhead from single-track loops or replays. Calling `retry()` automatically clears the corresponding empty marker.

### 2. Playback progress and sync alignment

- Listens to `player/track-changed`: increments the internal generation counter (guarding against track-switch races), resets state, and asynchronously loads the new track's lyrics.
- Listens to `player/position`: uses a binary-search algorithm (`findActiveLyricIndex` from `@BBeBee/toolkit`) to compute the matching timestamp line, and fires `lyrics/active-changed` when the active line changes.
- Listens to `player/state-changed`: responds to transport states such as loading and idle, showing a friendly loading hint or clearing the canvas.

## Public API

### State snapshot

`ctx.lyrics.state`:
```ts
interface LyricsState {
  status: 'idle' | 'loading-song' | 'loading-lyrics' | 'ready' | 'no-lyrics' | 'error'
  trackUrn?: string
  lyrics?: Lyrics
  activeIndex?: number
  offsetMs: number
  error?: string
}
```

### Methods

| Method | Description |
|---|---|
| `getLyricsForTrack(trackUrn)` | Fetch lyrics for the given URN (memory → SQLite → sources) |

### Events

| Event | Payload | Description |
|---|---|---|
| `lyrics/changed` | `LyricsState` | Overall lyrics state change (track change, load finished, error, etc.) |
| `lyrics/active-changed` | `number` | The highlighted (currently sung) line index changed |
