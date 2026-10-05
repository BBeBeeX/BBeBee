/**
 * React DOM views for `@BBeBee/plugin-now-playing`.
 *
 * Two surfaces, moved here together from `plugin-player-ui-desktop`: the
 * persistent bottom bar, and the full-pane player it opens. They are one
 * presentation — a bar with no page behind it is a dead control, and the
 * page's close button returns to the bar.
 *
 * Layout, gestures and event wiring only: every value comes from
 * `@BBeBee/toolkit/hooks`, and anything that would also be true on
 * mobile belongs in the headless package instead (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { NOW_PLAYING_VIEWS } from '@BBeBee/plugin-now-playing/views'
import { NowPlayingBar } from './components/NowPlayingBar.js'
import { NowPlayingScreen } from './components/NowPlayingScreen.js'

export { DesktopLyricsToggle } from './components/DesktopLyricsToggle.js'
export {
  NowPlayingBar,
  type NowPlayingBarProps,
  CachedArtwork,
  PLAY_MODE_INFO,
  renderPlayModeIcon,
  renderVolumeIcon,
  VerticalSlider,
  PlayModeButton,
  VolumeControl,
} from './components/NowPlayingBar.js'
export {
  NowPlayingScreen,
  type NowPlayingScreenProps,
} from './components/NowPlayingScreen.js'
export {
  StyleSwitcher,
  type StyleSwitcherProps,
} from './components/StyleSwitcher.js'
export {
  TrackInfoModal,
  type TrackInfoModalProps,
} from './components/TrackInfoModal.js'
export { type NowPlayingLayoutProps, NOW_PLAYING_LAYOUT_MAP } from './styles/index.js'

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-now-playing-ui-desktop'

export const inject = ['ui', 'player', 'nowPlaying']

/**
 * Register a component bound to **this** context, not the shell's.
 *
 * The shell renders views with the context it was mounted on, and a Cordis
 * context throws for any property outside its inject list; every view package
 * closes over its own plugin context for exactly this reason (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-now-playing-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.bar, bound(ctx, NowPlayingBar))
  }, 'now-playing-ui-desktop')
}

export default { name, inject, apply }
