# @BBeBee/plugin-desktop-taskbar

Desktop taskbar and tray playback controls for BBeBee.

## What it does

- Synchronizes current playback state (`isPlaying`, `canPlayOrPause`, `canPrevious`, `canNext`, `isFavorite`, `canFavorite`, track title, and artist) to the desktop host via `window.BBeBee.taskbar`.
- Coordinates with the desktop host to display Previous, Play/Pause, Next, and Favorite/Unfavorite controls on the Windows thumbnail toolbar (`ITaskbarList3::ThumbBarAddButtons`) and the system tray context menu.
- On Windows, thumbnail buttons dynamically adapt their contrast based on the system theme (`SystemUsesLightTheme` / dark vs. light taskbar) and automatically recover via `TaskbarButtonCreated` message handling if Windows Explorer restarts or taskbars reset.
- Receives user interactions from taskbar thumbnail buttons and tray items, dispatching them to `ctx.player.togglePlay()`, `ctx.player.previous()`, `ctx.player.next()`, and favorite toggling (via `sources.setLoved` / `library.setSaved`).
