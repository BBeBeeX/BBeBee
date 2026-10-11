# @BBeBee/plugin-desktop-lyrics-ui-desktop

Layer 5 (UI) — the desktop lyrics controller, the native secondary-window IPC bridge, and the UI adapter.

## Overview

`plugin-desktop-lyrics-ui-desktop` handles rendering and interaction wiring for desktop lyrics in the Electron desktop environment.

To deliver the ultimate desktop experience — **desktop lyrics draggable outside the main window, still on screen while the main window is minimized, and click-through once locked** — this plugin uses a dual-mode adapter architecture that both preserves BBeBee's single-Cordis-kernel invariant (ADR-3) and carries the full system-level capability of a native secondary window.

## Registration & dependencies

- Registered views: `ctx.ui.registerView('desktop-lyrics.floating', DesktopLyrics)`
- Required injections: `['ui', 'desktopLyrics', 'lyrics', 'player']`

## The dual-mode adapter architecture

### 1. Electron native standalone-window mode (Native Mode)

When the `window.BBeBee.desktopLyrics` IPC bridge is detected:
- **No duplicate DOM rendering**: the main window's render function returns `null` and occupies no main-window DOM.
- **Data push**: when the playing track, timeline, lyric line, font size, or lock state changes, the render payload is pushed in real time through `window.BBeBee.desktopLyrics.updateData(...)` to the secondary window (a secondary `BrowserWindow`) managed by the main process.
- **Reverse dispatch of actions**: the floating toolbar of the standalone lyrics window (previous track, next track, play/pause, font size up/down, lock toggle, close) is listened to and mapped onto the corresponding service methods of `ctx.player` and `ctx.desktopLyrics`.

### 2. Web/test-environment fallback mode (DOM Fallback Mode)

In a pure-browser test (e.g. the Vitest suite) or an environment without the Electron native bridge:
- Automatically degrades to a floating DOM container rendered inside the main window.
- Supports DOM-event-based mouse dragging, floating-button actions, and font-size adjustment, keeping 100% of the unit-test automation passing.

## The player bottom-bar entry

A desktop lyrics quick-toggle button sits in the main player's bottom bar (`NowPlayingBar`), to the left of the volume control on the right side:
- It reflects the current show/hide state of desktop lyrics in real time;
- Clicking it calls `ctx.desktopLyrics.toggleVisible()` or the global command `desktop-lyrics.toggle`.
