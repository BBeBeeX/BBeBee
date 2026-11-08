/**
 * The JS half of the native http-proxy binding (`BbebeeHttpProxy`).
 *
 * Exposes two seams, both consumed **only** by `boot.ts` (which hands them to
 * the services as constructor config):
 *
 * - `getProxyHttpTransport()` — the `fetch`-shaped transport `HttpRn` uses
 *   for requests the settings marked `useProxy`;
 * - `getStreamRelay()` — the registration seam `core-audio-mpv`'s
 *   `streamProxyResolver` uses to give proxy-marked streams a loopback URL.
 *
 * ⚠️ Deliberately **not** installed on `globalThis`: a fetch that dials an
 * arbitrary host through an arbitrary proxy must not be reachable from
 * plugin JS, which is exactly what a global would be. A build without the
 * native module (a dev client predating it, a JS-only run) returns
 * `undefined` from both getters, and every marked request/stream degrades to
 * direct — the honest behaviour, never a crash. The adapter builders live in
 * `adapter.ts` (no `expo` import) so tests can exercise them directly.
 */

import { requireNativeModule } from 'expo'

import {
  buildProxyTransport,
  createStreamRelay,
  type NativeHttpProxy,
  type NativeStreamRelay,
  type ProxyTransport,
  type StreamRelay,
} from './adapter'

/** The Expo module implements both seams; probing happens once. */
type NativeSurface = NativeHttpProxy & NativeStreamRelay

let probed: NativeSurface | undefined | 'missing'

function probe(): NativeSurface | undefined {
  const found = probed
  if (found === 'missing') return undefined
  if (found) return found
  try {
    const native = requireNativeModule<NativeSurface>('BbebeeHttpProxy')
    probed = native
    return native
  } catch {
    probed = 'missing'
    return undefined
  }
}

/** The proxy-capable fetch transport, or `undefined` without the native module. */
export function getProxyHttpTransport(): ProxyTransport | undefined {
  const native = probe()
  return native ? buildProxyTransport(native) : undefined
}

/** The stream-relay registration seam, or `undefined` without the native module. */
export function getStreamRelay(): StreamRelay | undefined {
  const native = probe()
  return native ? createStreamRelay(native) : undefined
}
