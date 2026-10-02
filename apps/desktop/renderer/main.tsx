/**
 * Renderer entry.
 *
 * The shell mounts on a *service*, not a timer: `app.ready(['ui'])` resolves
 * only once the registry a shell reads from exists (docs/02 §3).
 */

import { createElement as h, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { boot } from './boot.js'
import { Shell } from './Shell.js'
import { DesktopLyricsWindow } from './DesktopLyricsWindow.js'
import { MiniPlayerWindow } from '@BBeBee/plugin-mini-player-ui-desktop'
import { DEFERRED_PLUGIN_IDS } from './plugins.js'

const root = createRoot(document.getElementById('root')!)

const isMiniPlayerWindow =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('window') === 'mini-player' ||
    window.location.search.includes('mini-player') ||
    window.location.hash.includes('mini-player'))

const isLyricsWindow =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).get('window') === 'desktop-lyrics' ||
    window.location.search.includes('desktop-lyrics') ||
    window.location.hash.includes('desktop-lyrics'))

// Auto-hide scrollbars: a pane shows its scrollbar only while the pointer is
// over it, or while that pane itself is scrolling (1.2s linger). Every other
// pane's scrollbar stays hidden.
//
// ⚠️ Two traps, both learned the hard way:
// - A document-wide flag (`html.is-scrolling`) lit every scroller's thumb
//   app-wide — scroll page A and the sidebar's, the queue's, every other
//   pane's scrollbar showed too.
// - The CSS `*:hover::-webkit-scrollbar-thumb` route does not work either:
//   Chromium evaluates scrollbar part styles without honoring the owner
//   element's `:hover` state, so the "hover" variant painted on every pane at
//   all times. Hence this class, toggled from real mouse events, which the
//   cascade does honor.
if (typeof window !== 'undefined') {
  const activeTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  window.addEventListener(
    'scroll',
    (e) => {
      const target = e.target
      const el = target && target instanceof Element ? target : document.documentElement
      el.classList.add('is-scrolling')
      const prev = activeTimers.get(el)
      if (prev) clearTimeout(prev)
      activeTimers.set(
        el,
        setTimeout(() => {
          el.classList.remove('is-scrolling')
        }, 1200),
      )
    },
    { capture: true, passive: true },
  )

  const isScrollable = (el: Element): boolean => {
    if (el === document.documentElement || el === document.body) return false
    return (
      el.scrollHeight > el.clientHeight + 1 &&
      ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
    )
  }

  let hoveredScroller: Element | null = null
  const setHoveredScroller = (el: Element | null) => {
    if (el === hoveredScroller) return
    hoveredScroller?.classList.remove('is-scrollbar-hover')
    hoveredScroller = el
    hoveredScroller?.classList.add('is-scrollbar-hover')
  }

  // `mouseover` rather than `mousemove`: it fires on element boundaries, not
  // every pixel of travel, and its target is already the deepest element.
  window.addEventListener(
    'mouseover',
    (e) => {
      const target = e.target
      if (!(target instanceof Element)) return
      for (let n: Element | null = target; n; n = n.parentElement) {
        if (isScrollable(n)) {
          setHoveredScroller(n)
          return
        }
      }
      setHoveredScroller(null)
    },
    { passive: true },
  )
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) setHoveredScroller(null)
  })
}

if (isMiniPlayerWindow) {
  document.documentElement.classList.add('is-mini-player-window')
  document.body.classList.add('is-mini-player-window')
  root.render(h(StrictMode, null, h(MiniPlayerWindow)))
} else if (isLyricsWindow) {
  document.documentElement.classList.add('is-lyrics-window')
  document.body.classList.add('is-lyrics-window')
  root.render(h(StrictMode, null, h(DesktopLyricsWindow)))
} else {
  boot()
    .then(async (app) => {
      const ctx = await app.ready(['ui'], { timeoutMs: 10_000 })
      root.render(h(StrictMode, null, h(Shell, { ctx })))

      // Load deferred non-first-screen plugins during idle after first frame
      const scheduleIdle =
        typeof window !== 'undefined' && 'requestIdleCallback' in window
          ? window.requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 200)

      scheduleIdle(async () => {
        for (const id of DEFERRED_PLUGIN_IDS) {
          try {
            await app.loadPlugin(id)
          } catch (error) {
            ctx.logger?.warn?.(`deferred plugin ${id} failed to load: ${String(error)}`)
          }
        }
      })
    })
  .catch((error: unknown) => {
    // A boot failure must be visible, not a blank window.
    root.render(
      h(
        'pre',
        { style: { padding: 24, color: '#FF5C5C', whiteSpace: 'pre-wrap' } },
        `BBeBee failed to start:\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      ),
    )
  })
}
