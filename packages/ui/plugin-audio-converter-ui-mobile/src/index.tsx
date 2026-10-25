/**
 * React Native views for `@bbebee/plugin-audio-converter`.
 *
 * One screen: the conversion workbench (staging, options, queue, outputs).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { AUDIO_CONVERTER_VIEWS } from '@bbebee/plugin-audio-converter/views'
import { ConverterScreen, type ConverterScreenProps } from './ConverterScreen.js'

export { ConverterScreen, type ConverterScreenProps }
export { applyPreset, defaultConvertOptions, withOption, parseNumberField } from './options.js'
export { pickFilesCapability, toStagedFiles, type StagedFile } from './pick.js'

export const name = 'plugin-audio-converter-ui-mobile'
export const inject = ['ui', 'audioConverter']

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

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-audio-converter-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(AUDIO_CONVERTER_VIEWS.page, bound(ctx, ConverterScreen))
    /*
     * The workbench's mobile entrance. The headless plugin contributes the
     * route with `placement: ['tray']` — a desktop-only surface — so on a
     * phone the page would ship unreachable. The settings link row is the
     * answer the history screen already shipped: a contribution with no
     * `action` renders as a row whose button hands the id to `ui.navigate`,
     * and the shell resolves any registered view id. Contributed here, not in
     * the headless plugin, because the desktop keeps its own entrances.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: AUDIO_CONVERTER_VIEWS.page,
      section: 'general',
      title: 'converter:index.title',
      order: 72,
    })
  }, 'audio-converter-ui-mobile')
}

export default { name, inject, apply }
