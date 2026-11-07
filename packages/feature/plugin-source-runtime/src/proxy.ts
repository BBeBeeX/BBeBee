/**
 * Per-source proxy routing.
 *
 * The *policy* lives in settings (`proxy.enabled` + `proxy.sourceRules`); the
 * transport only understands a per-request flag. This wrapper is the hinge
 * between the two: it marks every request of one source with `useProxy` when
 * that source's settings say so, and passes everything else through
 * untouched.
 *
 * It sits beside `tracedHttp` in the same spot — wrapped once per source in
 * `startOne`, so every HTTP path a document has (the host-side `fetchDocument`
 * calls and the sandbox's `src.get`/`src.post`) picks the decision up without
 * any call site knowing it exists. The `enabled` callback is read per request,
 * live: flipping a source's switch in settings takes effect on the next
 * request, with no realm rebuild and no restart.
 */

import type { HttpRequest, HttpResponse, HttpService } from '@BBeBee/protocol'

/**
 * Wrap an HTTP service so every request may be marked `useProxy`.
 *
 * The returned service keeps the whole `HttpService` surface — callers reach
 * for `.cookies` (the per-source jar) and the journal just as they would the
 * unwrapped one.
 */
export function proxyMarkedHttp(http: HttpService, enabled: () => boolean): HttpService {
  const marked = async (request: HttpRequest): Promise<HttpResponse> => {
    if (!enabled() || request.useProxy !== undefined) return http(request)
    return http({ ...request, useProxy: true })
  }
  const wrapper = Object.assign(marked, {
    get: (...args: Parameters<HttpService['get']>) => http.get(...args),
    post: (...args: Parameters<HttpService['post']>) => http.post(...args),
    download: (...args: Parameters<HttpService['download']>) => http.download(...args),
    setUserAgent: (userAgent: string) => http.setUserAgent?.(userAgent),
    setProxy: (config: Parameters<NonNullable<HttpService['setProxy']>>[0]) =>
      http.setProxy?.(config),
    cookies: http.cookies,
  }) as unknown as HttpService
  // A getter, not a copied value: the journal is the inner service's and must
  // stay the same object its own reads see.
  Object.defineProperty(wrapper, 'requestLog', {
    get: () => http.requestLog,
    enumerable: true,
  })
  return wrapper
}
