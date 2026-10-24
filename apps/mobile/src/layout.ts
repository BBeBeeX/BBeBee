/**
 * Pure layout classification for the mobile shell — no imports, on purpose.
 *
 * `App.tsx` pulls in `react-native` native modules at module scope, so it can
 * never load under Node/vitest. The classification rules are the one piece of
 * the three-layout work (phone / tablet / foldable) that must be provable
 * without a device, which is why it lives here instead of in the shell: the
 * root vitest config collects shell test files anywhere under `apps/`, and a
 * file that imported so much as `react-native`'s types through a value import
 * would fail to collect.
 */

/** What the user picked in settings. P0 always passes 'auto'; P4 wires ctx.store. */
export type MobileLayoutMode = 'auto' | 'tablet' | 'foldable'

/** The layout the shell should render in, after size constraints are applied. */
export type MobileLayout = 'phone' | 'tablet' | 'foldable'

export interface MobileLayoutInput {
  /** window width in dp */
  width: number
  /** window height in dp */
  height: number
  /**
   * 用户持久化选择的布局模式，P0 阶段壳内恒传 'auto'（P4 接 ctx.store）
   */
  layoutMode: MobileLayoutMode
}

/**
 * The window-class breakpoint. 600dp is the Android/Apple canonical divider
 * between phone-class and tablet-class windows — the same number both
 * platforms' own layout guidance uses, so a window that counts as compact on
 * one counts as compact on the other.
 */
const TABLET_MIN_DP = 600

/** The persisted layout mode's key in `ctx.store` — the one source of truth. */
export const MOBILE_LAYOUT_MODE_KEY = 'mobile.layoutMode'

/** Whether a store value is a valid layout mode (guards corrupt/legacy reads). */
export function isMobileLayoutMode(value: unknown): value is MobileLayoutMode {
  return value === 'auto' || value === 'tablet' || value === 'foldable'
}

export function resolveMobileLayout(input: MobileLayoutInput): MobileLayout {
  const { width, height, layoutMode } = input

  /*
   * Foldable is opt-in only: it demands an explicit user choice *and* a
   * window at least 600dp wide. No orientation requirement — the two-pane
   * foldable layout is a portrait posture (cover screen open, or an inner
   * screen folded upright), so asking for landscape would forbid the very
   * posture the layout exists for.
   */
  if (layoutMode === 'foldable' && width >= TABLET_MIN_DP) return 'foldable'

  /*
   * Tablet demands all three of: wide, landscape, *and* tall. Landscape is
   * required because tablet columns are side-by-side; the height floor is
   * what keeps a phone in landscape (wide enough, but short) out — 800×360
   * has tablet width with half tablet height, and two columns there would
   * squeeze each to a sliver. Portrait wide windows fall through to phone
   * the same way: width alone doesn't make columns fit.
   */
  if (
    layoutMode !== 'foldable' &&
    width >= TABLET_MIN_DP &&
    width > height &&
    height >= TABLET_MIN_DP
  ) {
    return 'tablet'
  }

  return 'phone'
}
