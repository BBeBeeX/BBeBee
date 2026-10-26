/**
 * A stand-in for `expo-splash-screen` under Vitest.
 *
 * The real module closes over a native view controller, which Node cannot
 * load; the stub carries only the two bits of state the lifecycle service's
 * policy depends on — whether hiding was held off, and whether it happened —
 * so a test can assert the ordering the splash exists to guarantee (never
 * hidden before the app is ready).
 *
 * The surface mirrors the SDK's own top-level exports
 * (`preventAutoHideAsync`, `setOptions`, `hide`, `hideAsync` — see
 * `build/SplashScreen.d.ts`), so the service imports it exactly as Metro
 * would; the options bag exists for shape, not behaviour, and a fade the
 * stub never plays is the least of what a native view controller does.
 */

/** The SDK's own shape, as far as the stub is concerned. */
export interface SplashScreenOptions {
  /** The duration of the fade out animation in milliseconds. */
  duration?: number
  /** Whether to hide with a fade out animation. iOS only. */
  fade?: boolean
}

const state = {
  prevented: false,
  hidden: false,
  /** Hide calls before `preventAutoHideAsync` are the bug this surfaces. */
  hideWithoutPrevent: false,
}

export async function preventAutoHideAsync(): Promise<boolean> {
  state.prevented = true
  return true
}

export function setOptions(_options: SplashScreenOptions): void {
  /* animation behaviour has no observable meaning in Node */
}

export function hide(): void {
  if (!state.prevented) state.hideWithoutPrevent = true
  state.hidden = true
}

export async function hideAsync(): Promise<void> {
  hide()
}

/* ── Test levers ─────────────────────────────────────────────────────────── */

export function __state(): Readonly<typeof state> {
  return state
}

export function __resetForTests(): void {
  state.prevented = false
  state.hidden = false
  state.hideWithoutPrevent = false
}
