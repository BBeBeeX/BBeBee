# @bbebee/plugin-theme-ui-mobile

React Native views for `@bbebee/plugin-theme`.

Two responsibilities, both mobile-only:

1. **The theme management card** — fills the headless package's
   `theme.settings` descriptor (`THEME_VIEWS.settingsCard`) so the mobile
   settings screen renders real theme controls instead of the
   "not available on this platform" placeholder: appearance mode
   (system/dark/light), builtin + dynamic + custom categories, custom theme
   import (paste, or file pick when `ctx.fs.pickFiles` exists), and a link
   into the registry's Discover route for browsing theme packs. Glass
   settings are desktop-only (CSS-variable backed) and are deliberately not
   offered here.
2. **The mobile palette driver** (`wirePaletteDrive`) — the RN-native
   counterpart of the desktop shell's `wireThemeSync`: it resolves the active
   `ThemeDefinition` under the effective scheme (the RN `Appearance` API for
   `system` mode, injected through `ui-kit-mobile`'s `configureNative`) and
   installs it as the kit-wide palette via `setPalette`. Screens re-render
   through `usePalette`.
