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
 * Pure, total, never throws: safe to call in render paths.
 */
export function toServableFileUrl(uri: string | undefined): string | undefined {
  if (!uri) return uri
  try {
    const exposed = globalThis as unknown as {
      window?: { BBeBee?: { files?: { toServableUrl?: unknown } } }
      BBeBee?: { files?: { toServableUrl?: unknown } }
    }
    const fn = exposed.window?.BBeBee?.files?.toServableUrl ?? exposed.BBeBee?.files?.toServableUrl
    if (typeof fn === 'function') {
      return (fn as (u: string) => string)(uri)
    }
  } catch {
    // Host surface unavailable or threw — fall through to the identity mapping.
  }
  return uri
}
