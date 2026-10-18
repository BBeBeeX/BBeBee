/**
 * Serving URL for a `bbebee-file://` URI.
 *
 * The desktop host owns the platform-specific mapping (`window.BBeBee.files.toServableUrl`,
 * implemented once in the Tauri preload shim): on Windows the custom scheme is served
 * over `http://bbebee-file.localhost` because WebView2 cannot resolve custom schemes
 * natively, while macOS/Linux handle the scheme as-is. This helper only reads that
 * surface structurally — when it is absent (tests, SSR, non-desktop hosts) the input
 * is returned unchanged.
 *
 * Fallback: if the host surface is unavailable but we can detect Windows via the
 * user agent, apply the Windows mapping directly. This covers the case where the
 * preload shim hasn't exposed the API yet (timing) or failed to load.
 *
 * Pure, total, never throws: safe to call in render paths.
 */
export function toServableFileUrl(uri: string | undefined): string | undefined {
  if (!uri) return uri
  try {
    const exposed = globalThis as unknown as {
      window?: { BBeBee?: { files?: { toServableUrl?: unknown } }; navigator?: { userAgent?: string } }
      BBeBee?: { files?: { toServableUrl?: unknown } }
      navigator?: { userAgent?: string }
    }
    const fn = exposed.window?.BBeBee?.files?.toServableUrl ?? exposed.BBeBee?.files?.toServableUrl
    if (typeof fn === 'function') {
      return (fn as (u: string) => string)(uri)
    }
    // Fallback: host surface unavailable. Detect platform via user agent.
    if (typeof uri === 'string' && uri.startsWith('bbebee-file:')) {
      const ua =
        exposed.window?.navigator?.userAgent ?? exposed.navigator?.userAgent ?? ''
      // Windows: WebView2 needs the http://bbebee-file.localhost form.
      if (/windows/i.test(ua) || /win32|win64/i.test(ua)) {
        const rest = uri
          .replace(/^bbebee-file:/, '')
          .replace(/^\/+/, '')
          .replace(/^localhost\//, '')
        return `http://bbebee-file.localhost/${rest}`
      }
      // Linux: wry does not dispatch empty-host URLs; use localhost host form.
      if (/linux/i.test(ua) && uri.startsWith('bbebee-file:///')) {
        return 'bbebee-file://localhost/' + uri.slice('bbebee-file:///'.length)
      }
    }
  } catch {
    // Host surface unavailable or threw — fall through to the identity mapping.
  }
  return uri
}
