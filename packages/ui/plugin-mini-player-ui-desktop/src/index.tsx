/**
 * Desktop UI views for @BBeBee/plugin-mini-player.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { MiniPlayerWindow } from './components/MiniPlayerWindow.js'
import { MiniPlayerButton } from './components/MiniPlayerButton.js'
import { MiniPlayerFloating } from './components/MiniPlayerFloating.js'
import { MiniPlayerIsland } from './components/MiniPlayerIsland.js'

export {
  MiniPlayerWindow,
  MiniPlayerButton,
  MiniPlayerFloating,
  MiniPlayerIsland,
}

export const name = 'plugin-mini-player-ui-desktop'
export const inject = ['ui', 'miniPlayer']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-mini-player-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView('mini-player.window', bound(ctx, MiniPlayerWindow))
    yield ctx.ui.registerView('mini-player.button', bound(ctx, MiniPlayerButton))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'mini-player.button',
      slot: 'now-playing.actions',
      order: 10,
    })
  }, 'mini-player-ui-desktop')
}

export default { name, inject, apply }
