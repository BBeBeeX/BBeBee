/**
 * React Native views for `@bbebee/plugin-lyrics`.
 *
 * The synchronized lyrics panel for the full-screen player, registered under
 * the same view id the desktop twin uses (`lyrics.panel`) and contributed into
 * the `now-playing.panel` slot — the id must not drift between the two shells,
 * because the slot consumer resolves contributions by id.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { LyricsPanel, type LyricsPanelProps } from './components/LyricsPanel.js'

export { LyricsPanel, type LyricsPanelProps }

/**
 * The view id the desktop package registers and the headless `plugin-lyrics`
 * contributes into `now-playing.panel`. `plugin-lyrics` carries no `views.ts`,
 * so the id is declared here once — keep it identical to
 * `plugin-lyrics-ui-desktop` and `plugin-lyrics`.
 */
const LYRICS_PANEL_VIEW = 'lyrics.panel'

export const name = 'plugin-lyrics-ui-mobile'
export const inject = ['ui', 'lyrics', 'player']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin, and the reason this closure exists (docs/08 §3).
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
  ctx.logger.info('plugin-lyrics-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(LYRICS_PANEL_VIEW, bound(ctx, LyricsPanel))
    // Mirrors the desktop package's contribution; the headless `plugin-lyrics`
    // contributes the same descriptor, and a slot consumer that dedupes by id
    // sees one panel either way.
    yield ctx.ui.contribute({
      kind: 'slot',
      id: LYRICS_PANEL_VIEW,
      slot: 'now-playing.panel',
      order: 10,
    })
  }, 'lyrics-ui-mobile')
}

export default { name, inject, apply }
