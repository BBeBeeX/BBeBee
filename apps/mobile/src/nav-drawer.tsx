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

export interface NavDrawerOverlayProps {
  palette: Palette
  /** The live window width in dp — the panel caps at 320dp or 80% of it. */
  width: number
  /** The drawer body (logo + display mode, heatmap, tabs), built by the shell. */
  children: ReactNode
  /** The backdrop's accessibility label — the shell owns i18n. */
  closeLabel: string
  onClose: () => void
}

export function NavDrawerOverlay({
  palette,
  width,
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
    // panel's own right border is the seam between the two.
    h(
      native.View as never,
      {
        style: {
          width: Math.min(320, Math.round(width * 0.8)),
          backgroundColor: palette.bg.base,
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
