/**
 * Desktop UI views for @bbebee/plugin-visualizer.
 *
 * Registers:
 * - `visualizer.canvas` view to `now-playing.visualizer` slot.
 * - `visualizer.settings` view for settings panel integration.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { VisualizerCanvas, type VisualizerCanvasProps } from './components/VisualizerCanvas.js'
import {
  VisualizerSettingsCard,
  type VisualizerSettingsCardProps,
} from './components/VisualizerSettingsCard.js'

export { VisualizerCanvas, type VisualizerCanvasProps }
export { VisualizerSettingsCard, type VisualizerSettingsCardProps }

export const name = 'plugin-visualizer-ui-desktop'
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
  ctx.logger.info('plugin-visualizer-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('visualizer.canvas', bound(ctx, VisualizerCanvas))
    yield ctx.ui.registerView('visualizer.settings', bound(ctx, VisualizerSettingsCard))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'visualizer.canvas',
      slot: 'now-playing.visualizer',
      order: 10,
    })
  }, 'visualizer-ui-desktop')
}

export default { name, inject, apply }
