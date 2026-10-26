/**
 * A stand-in for `react-native` under Vitest.
 *
 * The mobile core packages may read `Platform` at module scope — right for
 * Metro, impossible in Node. This exposes the surfaces they use, with mutable
 * constants so a test can pose as an emulator or a physical device; anything
 * beyond those surfaces throws, so a test that strays there fails rather than
 * passing against a fake.
 *
 * `AppState` is the one piece of behaviour beyond `Platform`: the background
 * service's suspend checkpoint and its foreground-resume tick are wired to
 * it, and neither is testable if the emitter is only ever read. It is a real
 * emitter over a mutable status — a test drives the OS by emitting a status,
 * and subscriptions behave exactly as on device, removal included, so a
 * leaked subscription is visible as a listener that still fires.
 */

export const Platform = {
  OS: 'android',
  select<T>(choices: Record<string, T>): T | undefined {
    return (choices['android'] ?? choices['default']) as T | undefined
  },
  constants: {
    Model: 'Pixel 8',
  } as Record<string, unknown>,
}

/**
 * The native-module registry, as the live-activity probe reads it: absent
 * unless a test links one in, which is exactly the shape under test — a
 * package whose native half is not built yet must degrade to `supported:
 * false`, never to a crash.
 */
export const NativeModules: Record<string, unknown> = {}

/** Pose as a build with this native module linked. Test-only. */
export function __linkNativeModule(name: string, module: unknown): void {
  NativeModules[name] = module
}

export function __resetNativeModulesForTests(): void {
  for (const key of Object.keys(NativeModules)) delete NativeModules[key]
}

/** The statuses the real `AppState` reports; `unknown` is never emitted here. */
export type AppStateStatus = 'active' | 'inactive' | 'background'

const stateListeners = new Set<(status: AppStateStatus) => void>()
let currentState: AppStateStatus = 'active'

export const AppState = {
  get currentState(): AppStateStatus {
    return currentState
  },
  /** Only `'change'`, the only event the codebase listens to. */
  addEventListener(
    _type: 'change',
    listener: (status: AppStateStatus) => void,
  ): { remove(): void } {
    stateListeners.add(listener)
    return {
      remove: () => {
        stateListeners.delete(listener)
      },
    }
  },
}

/** Drive a status change the way the OS delivers one. Test-only. */
export function __emitAppState(status: AppStateStatus): void {
  currentState = status
  for (const listener of [...stateListeners]) listener(status)
}

export function __resetAppStateForTests(): void {
  currentState = 'active'
  stateListeners.clear()
}

export function __setModelForTests(model: string): void {
  Platform.constants['Model'] = model
}

export function __resetForTests(): void {
  Platform.OS = 'android'
  Platform.constants['Model'] = 'Pixel 8'
  __resetAppStateForTests()
  __resetNativeModulesForTests()
}
