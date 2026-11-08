/**
 * The JS half of the native LAN-host binding (`BbebeeLanHost`).
 *
 * Exposes one seam, consumed **only** by `boot.ts` (which registers the
 * `LanMobile` core service when it is present):
 *
 * - `getLanHost()` — the `LanService` over real UDP + TCP sockets. This is
 *   what makes a *mobile* device a first-class listen-together participant:
 *   it can announce, serve its own playback state, and stream local files to
 *   the LAN, the same as the desktop sidecar.
 *
 * ⚠️ Deliberately **not** installed on `globalThis`: a socket server bound to
 * `0.0.0.0` must not be reachable from plugin JS except through the gated
 * `ctx.lan` service. A build without the native module (a dev client
 * predating it, Expo Go) returns `undefined`, the service is simply not
 * registered, and every `ctx.lan` consumer stays inert — the honest
 * behaviour, never a crash. The adapter builders live in `adapter.ts` (no
 * `expo` import) so tests can exercise them directly.
 */

import { requireNativeModule } from 'expo'

import { createLanService, type NativeLanHost } from './adapter'

let probed: NativeLanHost | undefined | 'missing'

function probe(): NativeLanHost | undefined {
  const found = probed
  if (found === 'missing') return undefined
  if (found) return found
  try {
    const native = requireNativeModule<NativeLanHost>('BbebeeLanHost')
    probed = native
    return native
  } catch {
    probed = 'missing'
    return undefined
  }
}

/** The LAN transport, or `undefined` without the native module (Expo Go). */
export function getLanHost(): ReturnType<typeof createLanService> | undefined {
  const native = probe()
  return native ? createLanService(native) : undefined
}
