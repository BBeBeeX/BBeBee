/**
 * The view ids `plugin-car-mode` contributes.
 *
 * Shared by both view packages so a descriptor and the component filling it
 * cannot drift apart (docs/08 §3).
 */
export const CAR_MODE_VIEWS = {
  /** The driving-optimized screen: oversized controls, minimal chrome. */
  carMode: 'car-mode.view',
} as const

/** Routes are the same ids, because a route is what the shells navigate to. */
export const CAR_MODE_ROUTES = CAR_MODE_VIEWS
