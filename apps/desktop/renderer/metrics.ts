/**
 * Renderer-side memory sampler and the dev watchdog banner.
 *
 * The OOM post-mortem established that the WebView2 renderer's PartitionAlloc
 * pool could fill for hours with no visibility. The Rust host samples process
 * RSS (see src-tauri/src/metrics.rs); this module covers what only the
 * renderer can see about itself — the JS heap — and renders the dev-only
 * warning banner.
 *
 * Bounds (memory-governance §15.4): created/held by the module-level ring;
 * capacity RENDER_RING_CAP entries of two numbers; overflow replaces the
 * oldest; consumed by the banner and `window.__bbebeeMetrics`; a sampling
 * failure skips a tick; released with the page; the sampler allocates no
 * strings per tick.
 *
 * The banner is alert-only by design: it never reloads or disturbs a dev
 * session — it makes "this process is growing again" impossible to miss.
 */

import { createElement as h, useEffect, useState, type ReactElement } from 'react'

const RENDER_RING_CAP = 360 // 10 s apart → one hour of history
const SAMPLE_INTERVAL_MS = 10_000

export interface RenderSample {
  atMs: number
  usedJsHeapBytes: number
  jsHeapLimitBytes: number
}

const ring: RenderSample[] = []
let timer: ReturnType<typeof setInterval> | undefined

interface PerformanceMemory {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

function performanceMemory(): PerformanceMemory | undefined {
  const perf = performance as unknown as { memory?: PerformanceMemory }
  return perf.memory
}

/** Start the sampler once per page; idempotent. */
export function startRendererMetricsSampler(): void {
  if (timer) return
  const memory = performanceMemory()
  if (!memory) return // No heap telemetry (should not happen in WebView2).
  timer = setInterval(() => {
    const sample = performanceMemory()
    if (!sample) return
    if (ring.length >= RENDER_RING_CAP) ring.shift()
    ring.push({
      atMs: Date.now(),
      usedJsHeapBytes: sample.usedJSHeapSize,
      jsHeapLimitBytes: sample.jsHeapSizeLimit,
    })
  }, SAMPLE_INTERVAL_MS)
}

export function rendererMetricsSnapshot(): {
  samples: readonly RenderSample[]
  trendBytesPerMin: number
} {
  if (ring.length < 2) return { samples: [...ring], trendBytesPerMin: 0 }
  const first = ring[0]!
  const last = ring.at(-1)!
  const minutes = Math.max((last.atMs - first.atMs) / 60_000, 1 / 60)
  return {
    samples: [...ring],
    trendBytesPerMin: Math.round((last.usedJsHeapBytes - first.usedJsHeapBytes) / minutes),
  }
}

// Diagnostics escape hatch: the host can read this from any devtools session.
declare global {
  interface Window {
    __bbebeeMetrics?: typeof rendererMetricsSnapshot
  }
}
if (typeof window !== 'undefined') window.__bbebeeMetrics = rendererMetricsSnapshot

/** Heap-pressure thresholds for the banner (fraction of the V8 heap limit). */
const WARN_AT = 0.7
const ALERT_AT = 0.85

/**
 * Dev-only watchdog banner: shows once JS heap usage crosses 70% of its
 * limit, with the observed trend. Mount inside the main shell only — the
 * mini-player and lyrics windows never boot this far.
 */
export function MemoryWatchdogBanner(): ReactElement | null {
  const [level, setLevel] = useState<'warn' | 'alert' | null>(null)
  const [trend, setTrend] = useState(0)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const memory = performanceMemory()
    if (!memory) return
    const check = () => {
      const { trendBytesPerMin } = rendererMetricsSnapshot()
      setTrend(trendBytesPerMin)
      const ratio = memory.usedJSHeapSize / Math.max(memory.jsHeapSizeLimit, 1)
      setLevel(ratio >= ALERT_AT ? 'alert' : ratio >= WARN_AT ? 'warn' : null)
    }
    check()
    const off = setInterval(check, SAMPLE_INTERVAL_MS)
    return () => clearInterval(off)
  }, [])

  if (level === null || hidden) return null
  const isDev = import.meta.env?.DEV ?? false
  if (!isDev) return null
  return h(
    'div',
    {
      role: 'status',
      style: {
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9_999,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 10,
        fontSize: 12,
        lineHeight: 1.4,
        color: '#fff',
        background: level === 'alert' ? 'rgba(178, 34, 34, 0.92)' : 'rgba(140, 90, 0, 0.92)',
        boxShadow: '0 4px 16px rgba(0,0,0,.35)',
        maxWidth: 420,
      },
    },
    h(
      'span',
      null,
      `内存看门狗：JS 堆 ${level === 'alert' ? '≥85%' : '≥70%'}，趋势 ${(trend / 1024 / 1024).toFixed(1)} MB/min — 长会话 + HMR 会把试验性泄漏留在同一渲染进程；考虑整页刷新。`,
    ),
    h(
      'button',
      {
        onClick: () => setHidden(true),
        style: {
          border: 'none',
          background: 'rgba(255,255,255,.2)',
          color: '#fff',
          borderRadius: 6,
          padding: '2px 8px',
          cursor: 'pointer',
        },
      },
      '知道了',
    ),
  )
}
