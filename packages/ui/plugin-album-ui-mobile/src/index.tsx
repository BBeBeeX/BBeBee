/**
 * React Native views for `@bbebee/plugin-album`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@bbebee/plugin-album/views'
import { AlbumScreen } from './screens/AlbumScreen.js'

export { AlbumScreen }

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-album-ui-mobile'

/**
 * `sources` is required (the album read goes through it); `player`, `downloads`,
 * `library`, and `share` are read with `serviceOf`, so a build without either draws the
 * screen without the control that would call it.
 */
export const inject = ['ui', 'sources']

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
  ctx.logger.info('plugin-album-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(ALBUM_VIEWS.album, bound(ctx, AlbumScreen))
  }, 'album-ui-mobile')
}

export default { name, inject, apply }

