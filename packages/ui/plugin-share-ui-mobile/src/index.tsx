/**
 * React Native views for `@bbebee/plugin-share`.
 *
 * The desktop twin renders share *cards*: a canvas draws the artwork and LSB
 * steganography hides the payload inside a downloadable PNG. React Native has
 * no DOM canvas, so the phone carries the other half of the same envelopes —
 * the share code, Base64 metadata a selectable field exposes for long-press
 * copy, and an import reader that decodes a pasted code and hands the decoded
 * URNs to `ctx.player`. Same events (`share/open`, `share/import`), same
 * envelope format, different medium; a card image made on desktop imports on
 * desktop, a code made anywhere imports anywhere (docs/08 §1 — the actions
 * live in the service, only the views differ).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { SHARE_VIEWS } from '@BBeBee/plugin-share/views'
import { ShareHost } from './components/ShareHost.js'

export { ShareHost }

export const name = 'plugin-share-ui-mobile'
export const inject = ['ui', 'share']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-share-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(SHARE_VIEWS.host, bound(ctx, ShareHost))
  }, 'share-ui-mobile')
}

export default { name, inject, apply }
