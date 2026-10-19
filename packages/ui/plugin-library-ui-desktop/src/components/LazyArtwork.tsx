import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkProps } from '@BBeBee/ui-core'
import { CachedArtwork } from './CachedArtwork.js'

/**
 * `CachedArtwork` that only resolves the cover when scrolled into view.
 * Uses IntersectionObserver; renders a placeholder div until visible.
 * Prevents batch-fetching hundreds of covers on page open.
 * Priority P0 (visible) — the observer's 200px margin preloads just before visible.
 */
export function LazyArtwork({
  ctx,
  ...props
}: ArtworkProps & { ctx: Context }): ReactElement {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // If already in viewport on mount, mark visible immediately.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' }, // preload slightly before visible
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const size = props.size ?? 40
  if (!visible) {
    // Placeholder: same size, no cover fetch.
    return h('div', {
      ref,
      style: { width: size, height: size, flexShrink: 0 },
    })
  }
  // P0: visible — highest priority.
  return h(CachedArtwork, { ctx, priority: 0, ...props })
}
