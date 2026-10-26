/**
 * A stand-in for `expo-quick-actions` under Vitest.
 *
 * The real module forwards every call to `globalThis.expo.modules
 * .ExpoQuickActions`, which Node cannot load; the stub keeps the shortcut list
 * in memory and poses as the OS at the two moments the service's contract
 * turns on — the synchronous `initial` a cold launch leaves behind, and the
 * warm delivery `addListener` carries. The surface mirrors the SDK's own
 * top-level exports (`initial`, `maxCount`, `setItems`, `isSupported`,
 * `addListener` — see `build/index.d.ts`), so the service imports it exactly
 * as Metro would.
 *
 * `initial` and `maxCount` are `const` in the real module, computed once from
 * the native side; here they are live `let` bindings behind `__setInitial` /
 * `__setMaxCount`, because a const fixed at module load cannot be scripted
 * per-test — ESM's live bindings are what let the service still read them the
 * way it reads the real ones.
 */

/** One shortcut, by the SDK's own shape as far as the stub is concerned. */
export interface Action {
  id: string
  title: string
  /** An Apple built-in name, a `symbol:`/`asset:` id, or null for none. */
  icon?: string | null
  /** iOS-only. */
  subtitle?: string | null
  params?: Record<string, number | string | boolean | null | undefined> | null
}

/** The action the cold launch carried; `undefined` for a plain launch. */
export let initial: Action | undefined = undefined

/** The OS's own menu limit — iOS says four; Android launchers vary. */
export let maxCount: number | undefined = 4

let items: Action[] = []
let supported = true
const listeners = new Set<(action: Action) => void>()

export async function setItems(data?: Action[]): Promise<void> {
  items = data ? [...data] : []
}

export async function isSupported(): Promise<boolean> {
  return supported
}

export function addListener(listener: (action: Action) => void): { remove(): void } {
  listeners.add(listener)
  return { remove: () => void listeners.delete(listener) }
}

/* ── Test levers ─────────────────────────────────────────────────────────── */

/** The list as last handed to `setItems` — what the OS would be showing. */
export function __items(): readonly Action[] {
  return items
}

/** The OS delivered an action while the app was running. */
export function __emitAction(action: Action): void {
  for (const listener of [...listeners]) listener(action)
}

/** Pose as a cold launch caused by this action (`null` clears it). */
export function __setInitial(action: Action | null): void {
  initial = action ?? undefined
}

/** Script the OS's own menu limit (`undefined` — the lib's word for unknown). */
export function __setMaxCount(count: number | undefined): void {
  maxCount = count
}

/** Pose as a build whose OS has no home-screen shortcuts at all. */
export function __setSupported(on: boolean): void {
  supported = on
}

export function __resetForTests(): void {
  initial = undefined
  maxCount = 4
  items = []
  supported = true
  listeners.clear()
}
