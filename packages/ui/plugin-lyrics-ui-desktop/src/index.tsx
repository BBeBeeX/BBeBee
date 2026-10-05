/**
 * Desktop UI views for @BBeBee/plugin-lyrics.
 *
 * Registers the LyricsPanel to the now-playing.panel slot and as a standalone view.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LyricsPanel, type LyricsPanelProps } from './LyricsPanel.js'

export { LyricsPanel, type LyricsPanelProps }
// The cinematic template lives in the desktop kit (the now-playing cinematic
// layout shares it); re-exported so this package's public surface is stable.
export {
  CinematicLyricsTemplate,
  CURSIVE_FONT,
  type CinematicLyricsTemplateProps,
} from '@BBeBee/ui-kit-desktop'

export const name = 'plugin-lyrics-ui-desktop'
export const inject = ['ui', 'lyrics', 'player']

/**
 * Register a component bound to this plugin's context.
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
  ctx.logger.info('plugin-lyrics-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('lyrics.panel', bound(ctx, LyricsPanel))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'lyrics.panel',
      slot: 'now-playing.panel',
    })
  }, 'lyrics-ui-desktop')
}

export default { name, inject, apply }
