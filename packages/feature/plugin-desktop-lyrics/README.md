# @bbebee/plugin-desktop-lyrics

Layer 4 (feature) — `ctx.desktopLyrics`: the headless state machine and control center for desktop lyrics.

## Overview

`plugin-desktop-lyrics` manages the desktop lyrics' display state, typography settings, and locked mode. It runs as a headless service and broadcasts its state to the UI layer (for example the standalone native desktop lyrics window adapter, or a floating overlay during development).

It also contributes the global command `desktop-lyrics.toggle`, for the main player toolbar, the tray menu, or a keyboard shortcut to call.

## Service declaration

- `class DesktopLyricsService extends Service`, `super(ctx, 'desktopLyrics')` → `ctx.desktopLyrics`.
- **Required injections**: `[]` (no hard lower-layer dependencies; the desktop lyrics UI state can be managed even with no network or offline sources).
- **Optional injections**: `['ui']` (contributes the `desktop-lyrics.toggle` command).
- **Capabilities**: contributes the `desktopLyrics` service.

## Public API

### State snapshot

`ctx.desktopLyrics.state`:
```ts
interface DesktopLyricsState {
  visible: boolean          // whether the desktop lyrics are shown
  showNextLine: boolean     // whether the next-line preview is shown
  fontSize: number          // font size (14 - 40px)
  opacity: number           // background and text opacity (0.2 - 1.0)
  position: { x: number, y: number } // window position
  locked: boolean           // whether locked (locked mode lets mouse events pass through)
}
```

### Methods

| Method | Description |
|---|---|
| `toggleVisible()` | Toggle the desktop lyrics shown/hidden |
| `setVisible(visible: boolean)` | Set desktop lyrics visibility |
| `setShowNextLine(show: boolean)` | Set whether the two-line (next line) lyrics are shown |
| `setFontSize(size: number)` | Set the lyric font size (automatically clamped to 14-40) |
| `setOpacity(opacity: number)` | Set opacity (automatically clamped to 0.2-1.0) |
| `setPosition(pos: DesktopLyricsPosition)` | Set/remember the window position coordinates |
| `setLocked(locked: boolean)` | Set the locked state (enables mouse-event pass-through) |

### Command contribution

- `desktop-lyrics.toggle`: toggle the desktop lyrics shown/hidden.

### Events

| Event | Payload | Description |
|---|---|---|
| `desktop-lyrics/changed` | `DesktopLyricsState` | Broadcast whenever any desktop lyrics state property changes |
