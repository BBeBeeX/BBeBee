/**
 * Platform and window environment helpers for BBeBee desktop renderer.
 */

import { useEffect, useState } from 'react'

/**
 * Returns true if the current environment is running on macOS (Darwin).
 * Respects window.BBeBee.platform when available, falling back to navigator.userAgent.
 */
export function isMacPlatform(): boolean {
  if (typeof window !== 'undefined') {
    if (window.BBeBee?.platform === 'darwin') return true
    if (window.BBeBee?.platform === 'win32' || window.BBeBee?.platform === 'linux') return false
  }
  if (typeof navigator !== 'undefined') {
    return /macintosh|mac os x/i.test(navigator.userAgent)
  }
  return false
}

/**
 * React hook that returns whether the current window is in fullscreen mode.
 * Adapts to HTML fullscreen API, CSS display-mode media query, and Tauri window events.
 */
export function useIsFullscreen(): boolean {
  const checkFullscreen = (): boolean => {
    if (typeof document === 'undefined') return false
    if (document.fullscreenElement) return true
    if (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: fullscreen)').matches) {
      return true
    }
    return false
  }

  const [isFullscreen, setIsFullscreen] = useState<boolean>(checkFullscreen)

  useEffect(() => {
    const handleUpdate = () => {
      setIsFullscreen(checkFullscreen())
    }

    // HTML fullscreen API change
    document.addEventListener('fullscreenchange', handleUpdate)

    // Media query change (macOS spaces/fullscreen)
    let mql: MediaQueryList | undefined
    if (typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia('(display-mode: fullscreen)')
      mql.addEventListener?.('change', handleUpdate)
    }

    // Window resize fallback
    window.addEventListener('resize', handleUpdate)

    // Tauri custom event from Rust main window
    let unlistenTauri: (() => void) | undefined
    if (typeof window !== 'undefined' && window.__TAURI__?.event?.listen) {
      void window.__TAURI__.event
        .listen<boolean>('window:fullscreen-changed', (e) => {
          setIsFullscreen(Boolean(e.payload))
        })
        .then((unlisten) => {
          unlistenTauri = unlisten
        })
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleUpdate)
      mql?.removeEventListener?.('change', handleUpdate)
      window.removeEventListener('resize', handleUpdate)
      unlistenTauri?.()
    }
  }, [])

  return isFullscreen
}
