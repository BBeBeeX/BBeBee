/**
 * React DOM views for `plugin-audio-converter`.
 *
 * Implements the desktop audio conversion and compression workbench,
 * registering the view for `AUDIO_CONVERTER_VIEWS.page`.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { AUDIO_CONVERTER_VIEWS } from '@BBeBee/plugin-audio-converter/views'
import { ConverterWorkbench } from './components/ConverterWorkbench.js'

export { ConverterWorkbench }

export const name = 'plugin-audio-converter-ui-desktop'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'audioConverter']

export async function apply(ctx: Context) {
  ctx.logger?.info?.('plugin-audio-converter-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(AUDIO_CONVERTER_VIEWS.page, bound(ctx, ConverterWorkbench))
  }, 'audio-converter-ui-desktop')
}

export default { name, inject, apply }
