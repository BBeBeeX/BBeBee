/**
 * A stand-in for `expo-secure-store` under Vitest.
 *
 * `core-secrets-expo` imports the SDK at module scope, which is right for
 * Metro and impossible in Node. Aliasing it here is what lets the *second*
 * `ctx.secrets` implementation be tested at all — and the caller-scoping
 * tests are the ones that most need to run on both twins, because a gate
 * that holds on one platform and not the other is worse than no gate.
 *
 * A real map rather than a mock with opinions: keys are stored verbatim, so
 * the `[A-Za-z0-9._-]` key constraint of the real SDK is *not* enforced here.
 * Tests that care about the constraint assert the sanitising in the service;
 * everything else may not rely on the stub being lax.
 */

const store = new Map<string, string>()

export interface SecureStoreOptions {
  keychainService?: string
  requireAuthentication?: boolean
  authenticationPrompt?: string
}

export async function getItemAsync(
  key: string,
  _options?: SecureStoreOptions,
): Promise<string | null> {
  return store.get(key) ?? null
}

export async function setItemAsync(
  key: string,
  value: string,
  _options?: SecureStoreOptions,
): Promise<void> {
  store.set(key, value)
}

export async function deleteItemAsync(
  key: string,
  _options?: SecureStoreOptions,
): Promise<void> {
  store.delete(key)
}

/** Test-only: the real keychain never empties between tests; this map must. */
export function __resetForTests(): void {
  store.clear()
}
