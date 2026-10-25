/**
 * React Native views for `@bbebee/plugin-visualizer`.
 *
 * Registers the mobile canvas and its settings card, and contributes the
 * canvas into the `now-playing.visualizer` slot — the same slot id and view
 * descriptor ids as the desktop twin, so the now-playing shells on both
 * platforms resolve the same plumbing.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { VISUALIZER_VIEWS } from '@bbebee/plugin-visualizer/views'
import { VisualizerCanvas, type VisualizerCanvasProps } from './components/VisualizerCanvas.js'
import {
  VisualizerSettingsCard,
  type VisualizerSettingsCardProps,
} from './components/VisualizerSettingsCard.js'

export { VisualizerCanvas, type VisualizerCanvasProps }
export { VisualizerSettingsCard, type VisualizerSettingsCardProps }
export {
  colorForTheme,
  decayPeaks,
  liveEnergy,
  sampleBars,
  smoothEnergy,
  stepParticle,
  wavePoint,
} from './frame-math.js'

export const name = 'plugin-visualizer-ui-mobile'
export const inject = ['ui', 'visualizer', 'player', 'settings']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-visualizer-ui-mobile: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(VISUALIZER_VIEWS.canvas, bound(ctx, VisualizerCanvas))
    yield ctx.ui.registerView(VISUALIZER_VIEWS.settings, bound(ctx, VisualizerSettingsCard))
    // The slot read is the now-playing screen's; mobile's now-playing renders
    // whatever is contributed here, exactly as the desktop shell does.
    yield ctx.ui.contribute({
      kind: 'slot',
      id: VISUALIZER_VIEWS.canvas,
      slot: 'now-playing.visualizer',
      order: 10,
    })
  }, 'visualizer-ui-mobile')
}

export default { name, inject, apply }
