/**
 * @BBeBee/plugin-audio-converter
 *
 * Audio format conversion, compression, and batch processing service.
 */

import type { Context } from 'cordis'
import { AudioConverter } from './service.js'
import { AUDIO_CONVERTER_VIEWS } from './views.js'
import type { AudioConverterConfig } from '@BBeBee/protocol'

export * from './service.js'
export * from './queue.js'
export * from './compression.js'
export * from './security.js'
export * from './views.js'
export * from './hooks.js'

export const name = 'plugin-audio-converter'
export const inject = ['codec', 'fs', 'paths']

export async function apply(ctx: Context, config: Partial<AudioConverterConfig> = {}) {
  ctx.logger.info('plugin-audio-converter: loading')

  const fiber = await ctx.plugin(AudioConverter, config)

  const uiFiber = ctx.inject(['ui'], (scoped) => {
    return scoped.effect(function* () {
      yield scoped.ui.contribute({
        kind: 'route',
        id: AUDIO_CONVERTER_VIEWS.page,
        path: '/audio-converter',
        title: 'converter:index.title',
        icon: 'transform',
        placement: ['tray'],
        order: 35,
      })
    }, 'audio-converter-ui-contributions')
  })

  return () => {
    fiber.dispose()
    uiFiber.dispose()
  }
}

export default { name, inject, apply }
