/**
 * Reliable clipboard copy utility with automatic fallback to document.execCommand('copy').
 * Works in desktop webview, web contexts, and environments where document focus or clipboard permissions
 * cause navigator.clipboard.writeText to reject.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // 1. Try modern Async Clipboard API first
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy execCommand fallback
    }
  }

  // 2. Fallback to hidden textarea with execCommand('copy')
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)

      // Support mobile and desktop selection
      textarea.focus()
      textarea.select()
      textarea.setSelectionRange(0, text.length)

      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (success) {
        return true
      }
    } catch {
      // Both failed
    }
  }

  return false
}
