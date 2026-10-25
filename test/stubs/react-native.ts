/**
 * A stand-in for `react-native` under Vitest.
 *
 * The mobile core packages may read `Platform` at module scope — right for
 * Metro, impossible in Node. This exposes the one surface they use, with
 * mutable constants so a test can pose as an emulator or a physical device;
 * anything beyond `Platform` throws, so a test that strays there fails
 * rather than passing against a fake.
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

export function __setModelForTests(model: string): void {
  Platform.constants['Model'] = model
}

export function __resetForTests(): void {
  Platform.OS = 'android'
  Platform.constants['Model'] = 'Pixel 8'
}
