/**
 * The left navigation drawer's overlay chrome — the piece that arranges the
 * drawer panel and the tap-to-close backdrop.
 *
 * It lives outside `App.tsx`, on the kit's `configureNative` seam, for one
 * reason: the shell imports `react-native` at module scope and can never load
 * under vitest, and this arrangement is exactly what already shipped
 * backwards once — the `flex: 1` backdrop listed first took the row's left
 * edge and pushed the 320dp panel to the right. Here a jsdom test renders
 * the overlay with DOM host primitives and pins the panel as the first (left)
 * child (nav-drawer.test.tsx).
 *
 * One element serves both hosts: the phone mounts it over the whole window;
 * the foldable mounts it as the left pane's last child, which keeps it inside
 * the pane's bounds (docs/ui/architecture.md §7.4).
 */

import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { nativePrimitives } from '@BBeBee/ui-kit-mobile'
import type { Palette } from '@BBeBee/ui-tokens'

/* ── the drawer's page list, from the registration API ─────────────────── */

/** One page entry in the drawer's list. */
export interface DrawerPage {
  id: string
  title: string
}

/** The slice of a `RouteContribution` the list needs. */
interface RouteLike {
  id: string
  title?: string
  order?: number
}

/**
 * Pages the drawer leaves out: detail surfaces that need parameters a drawer
 * entry cannot carry (the album and collection pages are opened from library
 * rows), transport overlays with their own affordances (the queue via the
 * bar's list button, the player via the bar body), the settings
 * sub-pages — reached only from the settings home's category rows,
 * and standalone utility views (audio converter, dsp) which have dedicated entry
 * points in settings or player chrome.
 */
export const DRAWER_EXCLUDED_ROUTES: ReadonlySet<string> = new Set([
  'album.view',
  'sources.test',
  'sources.import',
  'sources.recommend.all',
  'library.collection',
  'library.playlist',
  'library.favorites',
  'history.view',
  'queue.view',
  'now-playing.view',
  'settings.appearance',
  'settings.playback',
  'settings.network',
  'settings.sources',
  'settings.storage',
  'settings.about',
  'audio-converter.view',
  'dsp.view',
])

/**
 * The drawer's page list, read from the registration API: every contributed
 * route that has a view registered on this shell, deduplicated, in
 * contribution order (ties by id) — minus the ids in `exclude`, the shell's
 * curation of detail/overlay surfaces that have their own entry points
 * (param'd detail pages, transport overlays) and no business as drawer
 * destinations. A view registering late (the deferred plugin pass) joins on
 * the next `ui/changed`.
 *
 * `translate` receives the route id and the contribution's own `title`
 * (which may be a literal or an i18n key) and returns the display string.
 */
export function collectDrawerPages(
  routes: readonly RouteLike[],
  hasView: (id: string) => boolean,
  translate: (id: string, contributed: string) => string,
  exclude?: ReadonlySet<string>,
): DrawerPage[] {
  const seen = new Set<string>()
  const pages: (DrawerPage & { order: number })[] = []
  for (const route of routes) {
    if (!route?.id || seen.has(route.id) || !hasView(route.id)) continue
    if (exclude?.has(route.id)) continue
    seen.add(route.id)
    pages.push({
      id: route.id,
      title: translate(route.id, route.title ?? ''),
      order: route.order ?? Number.POSITIVE_INFINITY,
    })
  }
  pages.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return pages.map(({ id, title }) => ({ id, title }))
}

export interface NavDrawerOverlayProps {
  palette: Palette
  /** The live window width in dp — the panel caps at 320dp or 80% of it. */
  width: number
  /**
   * The status-bar inset in dp. The overlay is absolutely positioned, so it
   * escapes the shell's SafeAreaView padding — the panel stays full-height
   * (its background runs under the status bar) while its content starts
   * below the bar.
   */
  topInset?: number
  /** The drawer body (logo + display mode, heatmap, tabs), built by the shell. */
  children: ReactNode
  /** The backdrop's accessibility label — the shell owns i18n. */
  closeLabel: string
  onClose: () => void
}

export function NavDrawerOverlay({
  palette,
  width,
  topInset = 0,
  children,
  closeLabel,
  onClose,
}: NavDrawerOverlayProps): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        zIndex: 110,
      },
      testID: 'nav-drawer-overlay',
    },
    // Panel FIRST: in a row the first child takes the left edge — the drawer
    // opens from the left, and the flex: 1 backdrop takes what remains. The
    // panel's own right border is the seam between the two. The panel reads
    // the music library background token (palette.bg.sunken / t.bg.primary),
    // matching desktop library sidebar.
    h(
      native.View as never,
      {
        style: {
          width: Math.min(320, Math.round(width * 0.8)),
          paddingTop: topInset,
          backgroundColor: palette.bg.sunken,
          borderRightWidth: 1,
          borderRightColor: palette.border.subtle,
        },
        testID: 'nav-drawer-panel',
      },
      children,
    ),
    h(native.Pressable as never, {
      onPress: onClose,
      accessibilityRole: 'button',
      accessibilityLabel: closeLabel,
      testID: 'nav-drawer-backdrop',
      style: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
    }),
  )
}
