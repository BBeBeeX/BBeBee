/**
 * Desktop UI views for @BBeBee/plugin-desktop-lyrics.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { DesktopLyrics, type DesktopLyricsProps } from './DesktopLyrics.js'
import { DesktopLyricsToggle } from './DesktopLyricsToggle.js'

export { DesktopLyrics, type DesktopLyricsProps, DesktopLyricsToggle }

export const name = 'plugin-desktop-lyrics-ui-desktop'
export const inject = ['ui', 'desktopLyrics', 'lyrics', 'player']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-desktop-lyrics-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('desktop-lyrics.floating', bound(ctx, DesktopLyrics))
    yield ctx.ui.registerView('desktop-lyrics.toggle', bound(ctx, DesktopLyricsToggle))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'desktop-lyrics.toggle',
      slot: 'now-playing.actions',
      order: 20,
    })
  }, 'desktop-lyrics-ui-desktop')
}

export default { name, inject, apply }
