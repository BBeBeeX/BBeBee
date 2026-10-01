/**
 * Mobile UI views for @BBeBee/plugin-dsp.
 *
 * Registers the DspScreen as 'dsp.view' and 'settings.dsp'.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { DspScreen, type DspScreenProps } from './DspScreen.js'
import { DspSettingsCard } from './components/DspSettingsCard.js'

export { DspScreen, type DspScreenProps, DspSettingsCard }

export const name = 'plugin-dsp-ui-mobile'
export const inject = ['ui', 'dsp']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-dsp-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('dsp.view', bound(ctx, DspScreen))
    yield ctx.ui.registerView('settings.dsp', bound(ctx, DspSettingsCard))
  }, 'dsp-ui-mobile')
}

export default { name, inject, apply }
