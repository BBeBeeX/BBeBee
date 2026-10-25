/**
 * `ctx.http` on iOS and Android — the M1 slice.
 *
 * ## Why this extends the desktop implementation rather than duplicating it
 *
 * `core-http-desktop`'s own header says the transport is a seam and everything
 * around it is `fetch`-shaped: the cookie jars, the `net:host` gate, the
 * `http/request` waterfall, the redirect loop that re-checks the host on every
 * hop. None of that is Node — it is the *contract*, and it is roughly six
 * hundred lines of it. Written twice, the two copies would disagree about
 * something subtle within a month, and a source that signs in on desktop and
 * silently does not on mobile is exactly the drift the risk register calls the
 * second most expensive thing that can go wrong.
 *
 * So what is here is what is genuinely different: the transport.
 *
 * ## The transport
 *
 * **`expo/fetch`, not React Native's `fetch`.** RN's is XHR-backed and its
 * `Response.body` is `null` — there is no stream at all. Every one of M1's
 * streaming requirements dies on that: no `Range` seek that starts playing
 * before the file arrives, no `onProgress`, no stall that can be told apart
 * from a slow response. `expo/fetch` is WinterCG-compliant and gives a real
 * `ReadableStream`, which is why docs/04 §17's "verify `ReadableStream` on
 * RN 0.86, polyfill if absent" resolves to a package rather than a polyfill:
 * a polyfilled stream over a buffered XHR is a stream in shape only.
 *
 * See docs/04 §2, docs/04 §17 and docs/11 §4.5.
 */

import { fetch as expoFetch } from 'expo/fetch'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { HttpNode, jarStore, type HttpNodeConfig } from '@bbebee/core-http-desktop'

export type HttpRnConfig = Omit<HttpNodeConfig, 'fetch'> & {
  /** Overrides the transport. Tests, and nothing else. */
  fetch?: typeof fetch
}

export class HttpRn extends HttpNode {
  constructor(ctx: Context, config: HttpRnConfig = {}) {
    super(ctx, {
      ...config,
      fetch: config.fetch ?? (expoFetch as unknown as typeof fetch),
      // A phone changes networks mid-request in a way a desktop rarely does,
      // so a transfer that has stopped receiving bytes is given less rope
      // before it is called dead — it is holding a wake lock while it waits.
      stallTimeoutMs: config.stallTimeoutMs ?? 30_000,
      userAgent: config.userAgent ?? 'BBeBee/0.1 (mobile)',
    })
  }

  /**
   * What the base reads through `Headers`, this transport reads raw.
   *
   * expo/fetch builds `response.headers` as a fresh WHATWG `Headers` from raw
   * pairs, through React Native's `whatwg-fetch` polyfill: repeated values are
   * joined with `", "` on read, and there is no `getSetCookie()`. The base's
   * fallback would therefore see a login's session and CSRF tokens as one
   * mangled string — on the one platform where sign-in state has to survive.
   * The `FetchResponse` keeps what that construction throws away: its
   * `_rawHeaders` is the native `[name, value][]` list, set-cookie entries
   * separate and in order. Reading it here, in the one place that knows this
   * transport, keeps `core-http-desktop` free of expo-shaped knowledge; should
   * expo ever rename it, `conformance.test.ts` pins the premise and fails
   * loudly rather than silently taking the joined fallback again.
   *
   * A response without `_rawHeaders` is not an expo one — `config.fetch` was
   * overridden, which tests do — and takes the base's reading.
   */
  protected override listSetCookies(response: Response): string[] {
    const raw = (response as { _rawHeaders?: [string, string][] })._rawHeaders
    if (Array.isArray(raw)) {
      const cookies: string[] = []
      for (const [name, value] of raw) {
        if (name.toLowerCase() === 'set-cookie') cookies.push(value)
      }
      return cookies
    }
    return super.listSetCookies(response)
  }
}

export { jarStore }

export const name = 'core-http-mobile'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so `await ctx.plugin(thisPlugin)` would resolve before
 * `ctx.http` is usable.
 */
export async function apply(ctx: Context, config: HttpRnConfig = {}) {
  ctx.logger.info('core-http-mobile: loaded')
  const fiber = await ctx.plugin(HttpRn, config)
  return () => void fiber.dispose()
}

export default { name, apply }
