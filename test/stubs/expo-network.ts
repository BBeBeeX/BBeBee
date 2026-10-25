/**
 * A stand-in for `expo-network` under Vitest.
 *
 * `core-device-mobile` imports it at module scope, which is right for Metro
 * and impossible in Node. The surface here is exactly what that service uses —
 * `getNetworkStateAsync`, `addNetworkStateListener`, the `NetworkStateType`
 * constants — with a lever to script the answer and to make the module throw,
 * which is the case the service is actually built for: everything degrades
 * rather than throwing (docs/04 §11).
 */

export const NetworkStateType = {
  BLUETOOTH: 'BLUETOOTH',
  CELLULAR: 'CELLULAR',
  ETHERNET: 'ETHERNET',
  NONE: 'NONE',
  VPN: 'VPN',
  WIFI: 'WIFI',
  UNKNOWN: 'UNKNOWN',
} as const

export type NetworkStateTypeValue = (typeof NetworkStateType)[keyof typeof NetworkStateType]

export interface NetworkState {
  type: NetworkStateTypeValue | undefined
  isConnected: boolean
  isInternetReachable: boolean | undefined
}

let scripted: NetworkState | undefined
let shouldThrow = false

/** Script the answer (or a refusal with `false`), and clear with no argument. */
export function __setNetworkForTests(state?: NetworkState | false): void {
  scripted = state === false ? undefined : state
  shouldThrow = state === false
}

export function __resetForTests(): void {
  scripted = undefined
  shouldThrow = false
  listeners.clear()
}

const listeners = new Set<(state: NetworkState) => void>()

export async function getNetworkStateAsync(): Promise<NetworkState> {
  if (shouldThrow) throw new Error('expo-network: permission refused under test')
  return scripted ?? { type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true }
}

export function addNetworkStateListener(
  listener: (state: NetworkState) => void,
): { remove(): void } {
  listeners.add(listener)
  return {
    remove: () => {
      listeners.delete(listener)
    },
  }
}

/** Drive a network transition the way the OS broadcasts one. Test-only. */
export function __emitNetworkChange(state: NetworkState): void {
  scripted = state
  for (const listener of [...listeners]) listener(state)
}
