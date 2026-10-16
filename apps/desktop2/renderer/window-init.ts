/**
 * Early window theme and class initialization.
 * Runs before React mounts to prevent white/opaque flash on secondary transparent windows.
 * Extracted from index.html to strictly satisfy CSP without requiring 'unsafe-inline'.
 */
if (typeof location !== 'undefined') {
  if (location.search.includes('desktop-lyrics') || location.hash.includes('desktop-lyrics')) {
    document.documentElement.classList.add('is-lyrics-window')
    document.documentElement.style.background = 'transparent'
  }
  if (location.search.includes('mini-player') || location.hash.includes('mini-player')) {
    document.documentElement.classList.add('is-mini-player-window')
    document.documentElement.style.background = 'transparent'
  }
}
