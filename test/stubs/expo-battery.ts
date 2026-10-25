/**
 * A stand-in for `expo-battery` under Vitest.
 *
 * `core-device-mobile` imports it at module scope. The service's whole
 * contract around the battery is degradation: a simulator, or a device that
 * will not say, must answer `undefined` — never a throw and never a fabricated
 * level — so the stub's lever scripts both the happy numbers and the refusal.
 */

export const BatteryState = {
  UNPLUGGED: 0,
  CHARGING: 1,
  FULL: 2,
} as const

export type BatteryStateValue = (typeof BatteryState)[keyof typeof BatteryState]

let level = 0.75
let state: BatteryStateValue = BatteryState.CHARGING
let shouldThrow = false

/** Script the answer (or a refusal with `false`), and clear with no argument. */
export function __setBatteryForTests(
  battery?: { level?: number; state?: BatteryStateValue } | false,
): void {
  if (battery === false) {
    shouldThrow = true
    return
  }
  shouldThrow = false
  level = battery?.level ?? 0.75
  state = battery?.state ?? BatteryState.CHARGING
}

export function __resetForTests(): void {
  level = 0.75
  state = BatteryState.CHARGING
  shouldThrow = false
}

export async function getBatteryLevelAsync(): Promise<number> {
  if (shouldThrow) throw new Error('expo-battery: unavailable under test')
  return level
}

export async function getBatteryStateAsync(): Promise<BatteryStateValue> {
  if (shouldThrow) throw new Error('expo-battery: unavailable under test')
  return state
}
