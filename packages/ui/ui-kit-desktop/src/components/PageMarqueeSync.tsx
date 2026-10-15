import { createContext, createElement as h, useContext, useMemo, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'

/** Standard 15-second total cycle duration across all pages */
export const DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS = 15000

/** Standardized uniform pixel speed across all elements (40px/s) */
export const DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC = 40

/** 0% ~ 15% (0 ~ 2.25s): Origin rest for initial reading */
export const MARQUEE_FORWARD_START_MS = 2250

/** 15% ~ 50% (2.25s ~ 7.5s): Forward scroll window */
export const MARQUEE_FORWARD_WINDOW_END_MS = 7500

/** 50% ~ 65% (7.5s ~ 9.75s): End pause window; global return starts at 9.75s */
export const MARQUEE_RETURN_START_MS = 9750

/** Extra breathing room at the end so text does not press tightly against container boundary */
export const MARQUEE_BREATHING_ROOM_PX = 6

export interface PageMarqueeSyncContextValue {
  /** Page anchor start time in performance.now() / Date.now() epoch */
  startTime: number
  /** Unified cycle duration in ms for all synchronized marquees on this page (15000ms) */
  cycleDurationMs: number
  /** Unified speed in px/s for all synchronized marquees on this page (40px/s) */
  speedPxPerSec: number
}

// Global fallback start time anchor for components outside an explicit page provider
const fallbackStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now()

export const PageMarqueeSyncContext = createContext<PageMarqueeSyncContextValue>({
  startTime: fallbackStartTime,
  cycleDurationMs: DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
  speedPxPerSec: DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC,
})

export interface PageMarqueeProviderProps {
  children?: ReactNode
  /** Unified cycle duration in milliseconds. Defaults to 15000ms (15 seconds). */
  cycleDurationMs?: number
  /** Unified speed in px/s. Defaults to 40px/s. */
  speedPxPerSec?: number
  /** Force a new timeline anchor instead of inheriting from outer provider. */
  fresh?: boolean
}

/**
 * Calculates keyframes and total duration for a truncated marquee item based on:
 * 1. Fixed 15-second cycle time window allocation:
 *    - 0 ~ 2.25s (0%~15%): Static origin rest
 *    - 2.25s ~ 7.5s (15%~50%): Move forward at uniform pixel speed (sharedSpeed)
 *    - 7.5s ~ 9.75s (50%~65%): Hold at end
 *    - 9.75s ~ 15.0s (65%~100%): Return to origin at uniform pixel speed (sharedSpeed)
 * 2. Uniform pixel speed (40 px/s) for both forward and reverse movements.
 * 3. Short/medium titles: complete motion early, hold still at end/origin, and wait for global phase.
 * 4. Ultra-long titles (overflow > 210px): multi-cycle harmonic continuation (N x 15s)
 *    maintaining strictly uniform 40px/s speed without jumping or sudden deceleration,
 *    recovering phase alignment at the next N*15s boundary.
 */
export function buildMarqueeKeyframes(
  travelPx: number,
  speedPxPerSec: number = DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC,
  baseCycleMs: number = DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
): { keyframes: Keyframe[]; totalDurationMs: number } {
  if (travelPx <= 0) {
    return {
      keyframes: [
        { transform: 'translateX(0)', offset: 0, easing: 'linear' },
        { transform: 'translateX(0)', offset: 1, easing: 'linear' },
      ],
      totalDurationMs: baseCycleMs,
    }
  }

  const speed = speedPxPerSec / 1000 // px per ms (0.04 px/ms)
  const tTravel = travelPx / speed // ms
  const tForwardStart = MARQUEE_FORWARD_START_MS // 2250ms
  const tArrive = tForwardStart + tTravel
  // Global return phase begins at 9750ms, or after at least 2250ms end-pause for ultra-long titles
  const tReturnStart = Math.max(MARQUEE_RETURN_START_MS, tArrive + 2250)
  const tReturned = tReturnStart + tTravel

  // Harmonic multi-cycle extension: total duration is an exact multiple of 15s
  const cycleCount = Math.max(1, Math.ceil(tReturned / baseCycleMs))
  const totalDurationMs = cycleCount * baseCycleMs

  // Construct raw keyframe points
  const rawPoints: Array<{ t: number; x: number }> = [
    { t: 0, x: 0 },
    { t: tForwardStart, x: 0 },
    { t: tArrive, x: -travelPx },
    { t: tReturnStart, x: -travelPx },
    { t: tReturned, x: 0 },
  ]

  if (tReturned < totalDurationMs) {
    rawPoints.push({ t: totalDurationMs, x: 0 })
  }

  // Deduplicate and convert to normalized offsets [0, 1]
  const keyframes: Keyframe[] = []
  for (let i = 0; i < rawPoints.length; i++) {
    const pt = rawPoints[i]!
    const offset = Math.min(1, Math.max(0, pt.t / totalDurationMs))
    if (
      keyframes.length > 0 &&
      Math.abs((keyframes[keyframes.length - 1]!.offset as number) - offset) < 0.00001
    ) {
      continue
    }
    keyframes.push({
      transform: `translateX(${pt.x === 0 ? '0' : `-${Math.abs(pt.x)}px`})`,
      offset,
      easing: 'linear',
    })
  }

  if (keyframes.length > 0 && (keyframes[keyframes.length - 1]!.offset as number) < 1) {
    keyframes.push({
      transform: 'translateX(0)',
      offset: 1,
      easing: 'linear',
    })
  }

  return { keyframes, totalDurationMs }
}

/**
 * Manages the unified marquee timeline for the current page scope.
 *
 * All visible truncated MarqueeText elements under this provider share the exact same
 * 15-second time base and 40px/s uniform pixel speed. When new items enter the viewport,
 * they automatically join the running timeline in perfect sync.
 */
export function PageMarqueeProvider(props: PageMarqueeProviderProps): ReactElement {
  const outer = useContext(PageMarqueeSyncContext)
  const isNested = outer !== undefined && outer.startTime !== undefined

  // Inherit outer timeline if already established in parent shell, unless props.fresh is true
  const startTimeRef = useRef<number>(
    props.fresh || !isNested
      ? (typeof performance !== 'undefined' ? performance.now() : Date.now())
      : outer.startTime,
  )

  const value = useMemo<PageMarqueeSyncContextValue>(
    () => ({
      startTime: startTimeRef.current,
      cycleDurationMs: props.cycleDurationMs ?? outer?.cycleDurationMs ?? DEFAULT_PAGE_MARQUEE_CYCLE_DURATION_MS,
      speedPxPerSec: props.speedPxPerSec ?? outer?.speedPxPerSec ?? DEFAULT_PAGE_MARQUEE_SPEED_PX_PER_SEC,
    }),
    [props.cycleDurationMs, props.speedPxPerSec, outer?.cycleDurationMs, outer?.speedPxPerSec],
  )

  return h(PageMarqueeSyncContext.Provider, { value }, props.children)
}

/**
 * Hook to access the current page's synchronized marquee timeline.
 */
export function usePageMarqueeSync(): PageMarqueeSyncContextValue {
  return useContext(PageMarqueeSyncContext)
}
