/**
 * Desktop UI views for @BBeBee/plugin-dsp.
 *
 * Registers the DspScreen as 'dsp.view' and 'settings.dsp'.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { DspScreen, type DspScreenProps } from './DspScreen.js'
import { DspSettingsCard } from './components/DspSettingsCard.js'
import { LoudnessNormalizationCard } from './components/LoudnessNormalizationCard.js'

export { DspScreen, type DspScreenProps, DspSettingsCard, LoudnessNormalizationCard }

export const name = 'plugin-dsp-ui-desktop'
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
  ctx.logger.info('plugin-dsp-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('dsp.view', bound(ctx, DspScreen))
    yield ctx.ui.registerView('settings.dsp', bound(ctx, DspSettingsCard))
    yield ctx.ui.registerView('settings.loudness-normalization', bound(ctx, LoudnessNormalizationCard))
  }, 'dsp-ui-desktop')
}

export default { name, inject, apply }
