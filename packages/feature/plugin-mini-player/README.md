# @bbebee/plugin-mini-player

Layer 4 (feature) — `ctx.miniPlayer`: the headless state machine and control center for the desktop floating mini window and the Dynamic Island.

## Overview

`plugin-mini-player` manages the display state, window modes, and interaction communication of the desktop floating mini window (Mini Player) and the top Dynamic Island. It runs as a headless service in the main renderer process and, through the single-Cordis-kernel architecture (ADR-3), stays strictly in sync on data and actions with the native desktop host and the secondary standalone window.

It also contributes global commands (such as `mini-player.toggle` and `mini-player.restore-main`) for the main player screen, the top-bar button, the system tray, or a shortcut to call.

## Architecture and service declaration

- `class MiniPlayerService extends Service implements IMiniPlayerService`, registered at `ctx.miniPlayer`.
- **Required injections**: `static inject = ['player']`, `export const inject = ['player']`.
  - Listens to `player/state-changed`, `player/track-changed`, and `player/position`, streaming the full playback state to the secondary window.
  - Receives user interactions sent back from the secondary window (play, pause, previous, next, seek, volume) and safely calls the matching `ctx.player` methods.
- **Optional injections**: `['ui']` (contributes the `mini-player.*` global commands).
- **Capabilities**: contributes the `miniPlayer` service.

## Three-mode model

The mini window supports three visual and layout modes:
1. **`normal` (floating mini window)**: an independent 380×96px floating capsule showing artwork, title, artist, progress bar, and playback controls, centered. Drag the background to move it freely; dragging near the top edge of the screen auto-snaps it into the Dynamic Island mode.
2. **`attached` (Dynamic Island capsule)**: a minimal 280×50px capsule docked at the top center of the screen. Shows the current track and animated volume wave bars (`IslandWaveBars`). Click or drag down to expand; double-click to collapse.
3. **`expanded` (expanded Dynamic Island)**: a 420×184px expanded card. Contains large artwork, marquee text, a volume bar, a progress bar, and a full control cluster. Double-click collapses back to the capsule; dragging down beyond the threshold (>60px) detaches it from the dock and restores the normal floating mini window.

## Artwork protocol safe rewrite (Chromium Boundary)

Chromium's renderer strictly forbids loading local resources cross-origin via `<img src="file://...">`.
This plugin ships a `resolveArtworkUri()` converter:
- Detects the local `file://` scheme and converts it to the desktop privileged custom protocol `bbebee-file://`;
- Supports falling back from `transport.nowPlaying.artworkUri` to `transport.nowPlaying.artwork.sourceUrl`;
- Works with the UI layer's `IslandArtwork` for cross-origin loading and error fallback (a vector note icon).

## Public API

### State snapshot

`ctx.miniPlayer.state`:
```ts
export interface MiniPlayerServiceState {
  visible: boolean                  // whether the mini window is shown
  mode: 'normal' | 'attached' | 'expanded' // the current display mode
  windowState: 'normal' | 'dragging' | 'near-top' | 'attached' | 'expanded' | 'hidden'
}
```

The streamed data packet `MiniPlayerData`:
```ts
export interface MiniPlayerData {
  trackUrn?: string
  title?: string
  artist?: string
  album?: string
  artworkUri?: string
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  canPlayOrPause: boolean
  canPrevious: boolean
  canNext: boolean
  volume: number
  muted: boolean
}
```

### Methods

| Method | Description |
|---|---|
| `open(options?: { mode?: MiniPlayerDisplayMode })` | Open the mini window, optionally with an initial mode |
| `close()` | Close the mini window and record its current coordinates |
| `toggle()` | Toggle the mini window shown/hidden |
| `setMode(mode: MiniPlayerDisplayMode)` | Manually switch the mini window mode (`normal` / `attached` / `expanded`) |
| `restoreMain()` | Restore and focus the main player window while hiding the mini window |

### Command contributions

- `mini-player.open`: open the mini window.
- `mini-player.close`: close the mini window.
- `mini-player.toggle`: toggle the mini window shown/hidden.
- `mini-player.restore-main`: restore the main player window.

### Events

| Event | Payload | Description |
|---|---|---|
| `mini-player/changed` | `MiniPlayerServiceState` | Broadcast when the mini window's visibility or mode changes |
