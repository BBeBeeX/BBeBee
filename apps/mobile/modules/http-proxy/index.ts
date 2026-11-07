/**
 * The JS half of the native http-proxy binding (`BbebeeHttpProxy`).
 *
 * Installs one seam:
 *
 * - `globalThis.bbebeeProxyHttp` — the `fetch`-shaped transport
 *   (`buildProxyTransport`) that `HttpRn` uses for requests the settings
 *   marked `useProxy`, handed to the service through `boot.ts` as
 *   `proxyTransport`.
 *
 * ⚠️ Loaded for its side effect from `boot.ts` and nowhere else: a build
 * without the native module (a dev client predating it, a JS-only run) must
 * leave the seam unset rather than crash — `HttpRn` then routes marked
 * requests direct through `expo/fetch`, which is the honest behaviour for a
 * build that cannot proxy. The adapter itself lives in `adapter.ts` (no
 * `expo` import) so tests can exercise it directly.
 */

import { requireNativeModule } from 'expo'

import { buildProxyTransport, type NativeHttpProxy } from './adapter'

function install(): void {
  const globals = globalThis as { bbebeeProxyHttp?: unknown }
  if (globals.bbebeeProxyHttp) return

  let native: NativeHttpProxy
  try {
    native = requireNativeModule<NativeHttpProxy>('BbebeeHttpProxy')
  } catch {
    // No native module in this build — marked requests stay direct.
    return
  }

  globals.bbebeeProxyHttp = buildProxyTransport(native)
}

install()
