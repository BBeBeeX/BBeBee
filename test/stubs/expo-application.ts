/**
 * A stand-in for `expo-application` under Vitest.
 *
 * `core-device-mobile` reads `nativeApplicationVersion` once, at construction,
 * and answers `'0.0.0'` when it is missing — the same degradation rule the rest
 * of the service follows. The stub makes the value a mutable export so a test
 * can pose as a build without one.
 */

export let nativeApplicationVersion: string | null = '1.2.3'

export function __setApplicationVersionForTests(version: string | null): void {
  nativeApplicationVersion = version
}

export function __resetForTests(): void {
  nativeApplicationVersion = '1.2.3'
}
