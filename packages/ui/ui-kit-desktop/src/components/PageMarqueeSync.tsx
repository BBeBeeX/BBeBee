import { createContext, createElement as h, useContext, useMemo, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'

export interface PageMarqueeSyncContextValue {
  /** Page anchor start time in performance.now() / Date.now() epoch */
  startTime: number
  /** Unified cycle duration in ms for all synchronized marquees on this page */
  cycleDurationMs: number
}

// Global fallback start time anchor for components outside an explicit page provider
const fallbackStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
export const DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS = 10000

export const PageMarqueeSyncContext = createContext<PageMarqueeSyncContextValue>({
  startTime: fallbackStartTime,
  cycleDurationMs: DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
})

export interface PageMarqueeProviderProps {
  children?: ReactNode
  /** Unified cycle duration in milliseconds. Defaults to 10000ms (10 seconds). */
  cycleDurationMs?: number
}

/**
 * Manages the unified marquee timeline for the current page scope.
 *
 * When a page mounts, a unified timeline is established. All truncated MarqueeText
 * elements under this provider share the exact same start time, direction, progress,
 * and loop cycle. When new items enter the viewport (via scrolling, filtering, or loading),
 * they automatically join the running page timeline in perfect sync.
 */
export function PageMarqueeProvider(props: PageMarqueeProviderProps): ReactElement {
  const startTimeRef = useRef<number>(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  )

  const value = useMemo<PageMarqueeSyncContextValue>(
    () => ({
      startTime: startTimeRef.current,
      cycleDurationMs: props.cycleDurationMs ?? DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
    }),
    [props.cycleDurationMs],
  )

  return h(PageMarqueeSyncContext.Provider, { value }, props.children)
}

/**
 * Hook to access the current page's synchronized marquee timeline.
 */
export function usePageMarqueeSync(): PageMarqueeSyncContextValue {
  return useContext(PageMarqueeSyncContext)
}
