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
  /** True only when the transport is the real expo one (not a test override). */
  private readonly isExpoTransport: boolean
  /** The "expo shape changed" warning is logged once per instance, not per response. */
  private warnedMissingRawHeaders = false

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
    this.isExpoTransport = config.fetch === undefined
  }

  /**
   * What the base reads through `Headers`, this transport reads raw.
   *
   * Order of preference, most reliable first:
   *
   * 1. The standard `Headers.getSetCookie()` when the runtime provides it
   *    (the base already does this, but it must win over the expo-private
   *    field below: a future expo that grows `getSetCookie` must not keep
   *    reading through a private field that may then change shape).
   * 2. expo's `_rawHeaders`: expo/fetch builds `response.headers` as a
   *    fresh WHATWG `Headers` from raw pairs, through React Native's
   *    `whatwg-fetch` polyfill: repeated values are joined with `", "` on
   *    read, and (on the expo shape this code was written against) there is
   *    no `getSetCookie()`. The base's fallback would therefore see a
   *    login's session and CSRF tokens as one mangled string — on the one
   *    platform where sign-in state has to survive. The `FetchResponse`
   *    keeps what that construction throws away: its `_rawHeaders` is the
   *    native `[name, value][]` list, set-cookie entries separate and in
   *    order. Reading it here, in the one place that knows this transport,
   *    keeps `core-http-desktop` free of expo-shaped knowledge.
   * 3. The base's joined-header reading, as a last resort — but never
   *    silently on the real expo transport: if expo answers with neither
   *    `getSetCookie` nor `_rawHeaders`, its shape has changed, and a
   *    warning is logged once (per instance) instead of letting multi-cookie
   *    sign-ins silently degrade. A response without either field from an
   *    overridden transport (which tests do) takes the base's reading
   *    without the warning.
   */
  protected override listSetCookies(response: Response): string[] {
    const headers = response.headers as Headers & { getSetCookie?(): string[] }
    if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
    const raw = (response as { _rawHeaders?: [string, string][] })._rawHeaders
    if (Array.isArray(raw)) {
      const cookies: string[] = []
      for (const [name, value] of raw) {
        if (name.toLowerCase() === 'set-cookie') cookies.push(value)
      }
      return cookies
    }
    if (this.isExpoTransport && !this.warnedMissingRawHeaders) {
      this.warnedMissingRawHeaders = true
      this.ctx.logger?.warn(
        'core-http-mobile: expo response has neither getSetCookie nor _rawHeaders — ' +
          'the expo response shape has changed and multi Set-Cookie headers may degrade to a joined fallback',
      )
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
