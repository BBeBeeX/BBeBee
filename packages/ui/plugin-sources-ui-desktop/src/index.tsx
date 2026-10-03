/**
 * React DOM views for `plugin-sources`.
 *
 * The library, search, source list, import and test screens. Every value comes
 * from a hook in the headless package — `useTracks`, `useAlbums`,
 * `useSourceSearch`, … — and this file is layout, gestures and event wiring
 * only (docs/08 1). The album page moved to `plugin-album-ui-desktop`, and the
 * library and search screens navigate to its route id.
 */

import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import { SearchScreen } from './screens/SearchScreen.js'
import { ImportScreen } from './screens/ImportScreen.js'
import { SourcesListScreen } from './screens/SourcesListScreen.js'
import { TestScreen } from './screens/TestScreen.js'
import { RecommendScreen } from './screens/RecommendScreen.js'
import { RecommendAllScreen } from './screens/RecommendAllScreen.js'

export { SearchScreen } from './screens/SearchScreen.js'
export { ImportScreen } from './screens/ImportScreen.js'
export { SourcesListScreen } from './screens/SourcesListScreen.js'
export { TestScreen } from './screens/TestScreen.js'
export { RecommendScreen } from './screens/RecommendScreen.js'
export { RecommendAllScreen } from './screens/RecommendAllScreen.js'
export { RecommendShelfRow } from './components/RecommendShelfRow.js'
export { CachedArtwork, CachedTrackRow } from './components/CachedArtwork.js'
export { SourcePanel, type SourcePanelProps } from './components/SourcePanel.js'

export const name = 'plugin-sources-ui-desktop'
export const inject = ['ui', 'sources']

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
  ctx.logger.info('plugin-sources-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.search, bound(ctx, SearchScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceList, bound(ctx, SourcesListScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.recommend, bound(ctx, RecommendScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.recommendAll, bound(ctx, RecommendAllScreen))
  }, 'sources-ui-desktop')
}

export default { name, inject, apply }
