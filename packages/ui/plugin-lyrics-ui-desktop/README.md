# @BBeBee/plugin-lyrics-ui-desktop

Layer 5 (UI) — the standalone lyrics panel for the desktop's full-screen / now-playing detail page.

## Overview

`plugin-lyrics-ui-desktop` provides the desktop with a lyrics panel embedded in the now-playing screen. It registers the view `lyrics.panel` and contributes it to the `now-playing.panel` slot; when the user opens the playback detail page, it appears on the right as the second of two columns.

## View & slot registration

- Registered view: `ctx.ui.registerView('lyrics.panel', LyricsPanel)`
- Slot contribution: `ctx.ui.contribute({ kind: 'slot', id: 'lyrics.panel', slot: 'now-playing.panel' })`
- Required injections: `['ui', 'lyrics', 'player']`

## Interaction & visual features

1. **Viewport centering and smooth scrolling**:
   - As `lyrics/active-changed` fires or playback time advances, the highlighted line is kept in the vertically centered region of the lyrics container.
   - Uses CSS `scrollIntoView({ behavior: 'smooth', block: 'center' })` to avoid jarring jumps.
2. **Layered visual texture**:
   - The active line: larger font size, glowing highlight (glow filter), accent-color gradient.
   - Played and unplayed lines: reduced opacity, visually quieter.
3. **Click-a-line to seek (Interactive Seek)**:
   - Clicking any timestamped line immediately calls `ctx.player.seek(line.timeMs)`; the progress bar and the lyrics jump together.
4. **State feedback and fault tolerance**:
   - `loading-lyrics`: a gentle spinner.
   - `no-lyrics`: a clear, friendly plain-text empty state.
   - `error`: an error message with retry logic that never disturbs normal transport playback.
