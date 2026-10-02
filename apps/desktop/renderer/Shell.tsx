/**
 * The desktop shell: sidebar plus content pane.
 *
 * It knows nothing about any feature. It reads contributed routes from
 * `ctx.ui`, resolves each to a registered view, and renders it — the whole of
 * ADR-2's desktop half (docs/08 §3).
 */

import {
  Component,
  createElement as h,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Context } from 'cordis'
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { SleepTimerIndicator, TopBar, WindowControls, type ElectronCSSProperties, type TopBarProps } from './TopBar.js'
import { importDroppedFiles } from './drop-import.js'

/** What the sidebar can navigate to: a route, or a settings page. */
interface Entry {
  id: string
  title: string
  group: 'main' | 'settings'
}

/** Whether a drag carries OS files (as opposed to an in-page element drag). */
const hasDroppedFiles = (e: React.DragEvent): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files')

/**
 * Re-read the registry whenever a plugin contributes or unloads.
 *
 * ⚠️ **Settings pages are navigable, not just routes.** `ctx.ui.settings` was
 * contributed by `plugin-local-scanner` and `plugin-sources` from the start
 * and read by nobody, so "Music folders" — the screen with *Add folder* and
 * *Scan now* on it — existed, had a view registered, and could not be reached
 * from either shell. A contribution nothing renders is a feature nobody has.
 */
function useEntries(ctx: Context): { routes: readonly RouteContribution[]; entries: Entry[] } {
  const read = () => ({
    routes: [...ctx.ui.routes] as readonly RouteContribution[],
    settings: [...ctx.ui.settings] as readonly SettingsContribution[],
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    // `read` is redefined per render but only ever closes over `ctx`, so
    // re-subscribing on `ctx` alone is correct and keeps one listener.
    const off = ctx.on('ui/changed', () =>
      setState({ routes: [...ctx.ui.routes], settings: [...ctx.ui.settings] }),
    )
    return () => void off()
  }, [ctx])

  const entries: Entry[] = [
    ...state.routes
      .filter((r) => {
        if (!(r.placement?.includes('sidebar') ?? true)) return false
        if (
          r.id === 'sources.search' ||
          r.id === 'search' ||
          r.id === 'settings.view' ||
          r.id === 'settings.main' ||
          r.id === 'settings' ||
          r.id === 'sources.import' ||
          r.id === 'visualizer.settings' ||
          r.id === 'history.view' ||
          r.id === 'downloads.page' ||
          r.title === 'Search' ||
          r.title === '设置'
        ) {
          return false
        }
        return true
      })
      .map((r) => ({ id: r.id, title: r.title, group: 'main' as const })),
    /*
     * Settings pages that actually have a view.
     *
     * ⚠️ A different rule from routes, deliberately. A *route* with no view on
     * this target renders "not available on this platform", which is true and
     * worth saying — `plugin-inspector` is in exactly that state on mobile. A
     * settings page with no view on *either* target is not a platform gap, it
     * is a page nobody has written yet (`sources.settings` is one today), and
     * listing it advertises a screen that does not exist.
     */
    ...state.settings
      .filter((s) => {
        if (ctx.ui.viewFor(s.id) === undefined) return false
        if (s.display === 'card') return false
        // Exclude settings pages managed inside the Settings dashboard (dsp, sources, scanner, downloads)
        if (
          s.id === 'dsp.settings' ||
          s.id === 'settings.dsp' ||
          s.id === 'sources.settings' ||
          s.id === 'scanner.settings' ||
          s.id === 'downloads.page' ||
          s.id === 'settings.view' ||
          s.id === 'settings.main' ||
          s.id === 'settings' ||
          s.id === 'sources.import' ||
          s.id === 'visualizer.settings' ||
          s.id === 'history.view' ||
          s.title === '设置'
        ) {
          return false
        }
        return true
      })
      .map((s) => ({ id: s.id, title: s.title, group: 'settings' as const })),
  ]
  return { routes: state.routes, entries }
}

class ViewBoundary extends Component<
  { title: string; onError: (error: Error) => void; resetKey?: string; children?: ReactNode },
  { error?: Error }
> {
  override state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    this.props.onError(error)
  }

  override componentDidUpdate(prevProps: { title: string; resetKey?: string }): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined })
    }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return h(
      'div',
      { style: { padding: 24, color: 'var(--error, #EF4444)', fontFamily: 'ui-monospace, monospace' } },
      h('h2', { style: { fontSize: 16, margin: '0 0 8px' } }, `"${this.props.title}" failed to render`),
      h(
        'pre',
        { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--warning, #F59E0B)' } },
        error.stack ?? error.message,
      ),
    )
  }
}

interface HistoryItem {
  id: string
  params?: Record<string, unknown>
}

interface CachedPageItem {
  key: string
  id: string
  params?: Record<string, unknown>
}

function getPageKey(id: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return id
  }
  const sortedKeys = Object.keys(params).sort()
  const sortedParams: Record<string, unknown> = {}
  for (const k of sortedKeys) {
    sortedParams[k] = params[k]
  }
  return `${id}:${JSON.stringify(sortedParams)}`
}

function Splitter({
  position,
  isDragging,
  onMouseDown,
  onDoubleClick,
  top = 8,
  zIndex = 25,
  'data-testid': testId,
}: {
  position: { left?: number | string; right?: number | string }
  isDragging: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  /** Vertical start; the queue splitter stops at the drawer's top edge. */
  top?: number
  /** The queue splitter rises above the fullscreen play-page overlay. */
  zIndex?: number
  'data-testid'?: string
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  return h(
    'div',
    {
      'data-testid': testId,
      role: 'separator',
      'aria-orientation': 'vertical',
      tabIndex: 0,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onMouseDown,
      onDoubleClick,
      style: {
        position: 'absolute',
        top,
        bottom: 8,
        ...position,
        width: 8,
        cursor: 'col-resize',
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      },
    },
    h('div', {
      style: {
        width: 2,
        height: '100%',
        borderRadius: 1,
        backgroundColor:
          isDragging || hovered
            ? 'var(--color-primary, #5F87FF)'
            : 'transparent',
        transition: isDragging ? 'none' : 'background-color 0.15s ease',
      },
    }),
  )
}

/** Default drawer width; the queue splitter overrides it and double-click resets to it. */
const QUEUE_DRAWER_WIDTH = 340

/** Slide-in for the queue drawer. Inline because the CSP allows styles but the renderer ships no stylesheet. */
const QUEUE_DRAWER_KEYFRAMES =
  '@keyframes queueDrawerIn { from { transform: translateX(32px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }'

export function Shell({ ctx }: { ctx: Context }) {
  const { entries } = useEntries(ctx)
  // The recommend page is the home: it is where the brand logo in the
  // top-left goes and where a fresh window opens. Sources that cannot
  // recommend render their own empty state, so defaulting here is safe
  // before any source is imported.
  const defaultEntry =
    entries.find((e) => e.id === 'sources.recommend') ??
    entries.find((e) => e.id !== 'now-playing.view') ??
    entries[0]
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)
  const [isTopBarHovered, setIsTopBarHovered] = useState(false)
  const isTopBarHoveredRef = useRef(false)
  isTopBarHoveredRef.current = isTopBarHovered
  const topBarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTopBarTimeout = useCallback(() => {
    if (topBarTimeoutRef.current) {
      clearTimeout(topBarTimeoutRef.current)
      topBarTimeoutRef.current = null
    }
  }, [])

  const scheduleTopBarHide = useCallback((delay = 250) => {
    clearTopBarTimeout()
    topBarTimeoutRef.current = setTimeout(() => {
      setIsTopBarHovered(false)
    }, delay)
  }, [clearTopBarTimeout])

  const handleFullscreenMouseMove = useCallback((e: React.MouseEvent) => {
    if (e.clientY <= 64) {
      clearTopBarTimeout()
      setIsTopBarHovered(true)
    } else if (e.clientY >= 76) {
      if (isTopBarHoveredRef.current && !topBarTimeoutRef.current) {
        scheduleTopBarHide(250)
      }
    }
  }, [clearTopBarTimeout, scheduleTopBarHide])

  const handleTopBarMouseEnter = useCallback(() => {
    clearTopBarTimeout()
    setIsTopBarHovered(true)
  }, [clearTopBarTimeout])

  const handleTopBarMouseLeave = useCallback((e: React.MouseEvent) => {
    if (e.clientY >= 52) {
      scheduleTopBarHide(250)
    }
  }, [scheduleTopBarHide])

  const [isBottomBarHovered, setIsBottomBarHovered] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [libraryMode, setLibraryMode] = useState<'collapsed' | 'sidebar' | 'expanded'>('sidebar')
  const [sidebarWidth, setSidebarWidth] = useState<number>(280)
  const [queueWidth, setQueueWidth] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState<'sidebar' | 'queue' | null>(null)
  const workspaceRef = useRef<HTMLDivElement | null>(null)

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging('sidebar')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const newWidth = Math.round(moveEvent.clientX - (rect.left + 8))
      if (newWidth < 120) {
        setLibraryMode('collapsed')
      } else {
        setLibraryMode('sidebar')
        setSidebarWidth(Math.min(480, Math.max(180, newWidth)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  const handleQueueMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging('queue')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const newWidth = Math.round((rect.right - 8) - moveEvent.clientX)
      setQueueWidth(Math.min(560, Math.max(240, newWidth)))
    }

    const handleMouseUp = () => {
      setIsDragging(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const [navState, setNavState] = useState<{ history: HistoryItem[]; index: number }>({
    history: [],
    index: 0,
  })

  const navigateTo = useCallback(
    (id: string, params?: Record<string, unknown>) => {
      setIsFullscreenNowPlaying(false)
      if (id !== 'library.home') {
        setLibraryMode((m) => (m === 'expanded' ? 'sidebar' : m))
      }
      setNavState((prev) => {
        const base =
          prev.history.length === 0 && defaultEntry ? [{ id: defaultEntry.id }] : prev.history
        const current = base[prev.index]
        if (
          current &&
          current.id === id &&
          JSON.stringify(current.params) === JSON.stringify(params)
        ) {
          return prev
        }
        const nextHistory = base.slice(0, prev.index + 1)
        nextHistory.push({ id, params })
        return {
          history: nextHistory,
          index: nextHistory.length - 1,
        }
      })
    },
    [defaultEntry],
  )

  const canGoBack = navState.index > 0
  const canGoForward = navState.index < navState.history.length - 1

  const handleBack = useCallback(() => {
    setIsFullscreenNowPlaying(false)
    setNavState((prev) => {
      if (prev.index > 0) {
        return { ...prev, index: prev.index - 1 }
      }
      return prev
    })
  }, [])

  const handleForward = useCallback(() => {
    setIsFullscreenNowPlaying(false)
    setNavState((prev) => {
      if (prev.index < prev.history.length - 1) {
        return { ...prev, index: prev.index + 1 }
      }
      return prev
    })
  }, [])

  const handleHome = useCallback(() => {
    if (defaultEntry) {
      navigateTo(defaultEntry.id)
    }
  }, [defaultEntry, navigateTo])

  useEffect(() => {
    const off = ctx.on('ui/navigate', (routeId: string, params?: Record<string, unknown>) => {
      if (routeId === 'now-playing.view') {
        setIsFullscreenNowPlaying(true)
      } else if (routeId === 'queue.view') {
        // The queue drawer floats above whatever is on screen — the shell or
        // the fullscreen play page — so opening it never leaves the page it
        // was opened from.
        setIsQueueOpen((prev) => !prev)
      } else {
        navigateTo(routeId, params)
      }
    })
    return () => void off()
  }, [ctx, navigateTo])

  /* ── Drop-to-import ──────────────────────────────────────────────────
   *
   * Owned at the shell root, not in any view: a drop has to land over every
   * screen, and `will-navigate` (main) refuses the Chromium default of
   * navigating to the dropped file. The overlay is purely feedback —
   * `pointerEvents: 'none'` keeps the drag itself flowing to the root, which
   * is the actual drop target.
   */
  const [dropActive, setDropActive] = useState(false)
  const [dropMessage, setDropMessage] = useState<string | null>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    // Window-level backstop: without a `dragover` preventDefault Chromium
    // never offers a drop at all, and one outside the root div would still
    // be refused rather than navigated to.
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  useEffect(() => {
    if (!dropMessage) return
    const timer = setTimeout(() => setDropMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [dropMessage])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDroppedFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDroppedFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasDroppedFiles(e)) return
    // Enter/leave fire per element crossed; the depth counts them back out,
    // so brushing a child does not flicker the overlay off.
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDropActive(false)
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      void importDroppedFiles(ctx, files)
        .then(({ imported, folders, failed }) => {
          const parts: string[] = []
          if (folders > 0) parts.push(`已添加 ${folders} 个文件夹，正在扫描`)
          if (imported > 0) parts.push(`已导入 ${imported} 首曲目`)
          if (failed > 0) parts.push(`${failed} 项无法导入`)
          setDropMessage(parts.length > 0 ? parts.join('，') : '未发现可导入的内容')
        })
        .catch(() => setDropMessage('导入失败，请重试'))
    },
    [ctx],
  )

  const currentItem: HistoryItem | undefined =
    navState.history[navState.index] ?? (defaultEntry ? { id: defaultEntry.id } : undefined)
  const currentId = currentItem?.id
  const currentParams = currentItem?.params
  const currentKey = currentId ? getPageKey(currentId, currentParams) : ''

  const [cachedPages, setCachedPages] = useState<Map<string, CachedPageItem>>(() => {
    const map = new Map<string, CachedPageItem>()
    if (currentKey && currentId) {
      map.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
    }
    return map
  })

  const pagesToRender = useMemo(() => {
    const map = new Map(cachedPages)
    if (currentKey && currentId && !map.has(currentKey)) {
      map.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
    }
    return map
  }, [cachedPages, currentKey, currentId, currentParams])

  useEffect(() => {
    if (currentKey && currentId) {
      setCachedPages((prev) => {
        if (prev.has(currentKey)) return prev
        const next = new Map(prev)
        next.set(currentKey, { key: currentKey, id: currentId, params: currentParams })
        if (next.size > 20) {
          const firstKey = next.keys().next().value
          if (firstKey && firstKey !== currentKey) {
            next.delete(firstKey)
          }
        }
        return next
      })
    }
  }, [currentKey, currentId, currentParams])

  const scrollPositionsRef = useRef<Map<string, { el: HTMLElement; top: number; left: number }[]>>(new Map())
  const pageContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const prevKeyRef = useRef<string>(currentKey)

  useEffect(() => {
    const prevKey = prevKeyRef.current
    if (prevKey && prevKey !== currentKey) {
      const prevContainer = pageContainerRefs.current.get(prevKey)
      if (prevContainer) {
        const records: { el: HTMLElement; top: number; left: number }[] = []
        if (prevContainer.scrollTop > 0 || prevContainer.scrollLeft > 0) {
          records.push({ el: prevContainer, top: prevContainer.scrollTop, left: prevContainer.scrollLeft })
        }
        const scrollables = prevContainer.querySelectorAll<HTMLElement>('*')
        for (let i = 0; i < scrollables.length; i++) {
          const el = scrollables[i]
          if (el && (el.scrollTop > 0 || el.scrollLeft > 0)) {
            records.push({ el, top: el.scrollTop, left: el.scrollLeft })
          }
        }
        scrollPositionsRef.current.set(prevKey, records)
      }
    }

    if (currentKey) {
      const records = scrollPositionsRef.current.get(currentKey)
      if (records && records.length > 0) {
        requestAnimationFrame(() => {
          for (const rec of records) {
            if (rec.el && rec.el.isConnected) {
              rec.el.scrollTop = rec.top
              rec.el.scrollLeft = rec.left
            }
          }
        })
      }
    }

    prevKeyRef.current = currentKey
  }, [currentKey])

  const active =
    entries.find((e) => e.id === currentId) ??
    (currentId ? { id: currentId, title: currentId, group: 'main' as const } : defaultEntry)
  const QueueView = ctx.ui.viewFor('queue.view') as
    | ComponentType<{
        ctx: Context
        onClose?: () => void
        [key: string]: unknown
      }>
    | undefined
  const BottomBar = ctx.ui.viewFor('now-playing.bar') as
    | ComponentType<{
        ctx: Context
        currentRoute?: string
        onOpenNowPlaying?: () => void
        portalMenus?: boolean
      }>
    | undefined
  const DesktopLyrics = ctx.ui.viewFor('desktop-lyrics.floating') as
    | ComponentType<{ ctx: Context }>
    | undefined
  const ShareHost = ctx.ui.viewFor('share.host') as
    | ComponentType<{ ctx: Context }>
    | undefined
  const LibraryView = ctx.ui.viewFor('library.home') as
    | ComponentType<{
        ctx: Context
        mode?: 'collapsed' | 'sidebar' | 'expanded'
        onModeChange?: (mode: 'collapsed' | 'sidebar' | 'expanded') => void
        onOpenAlbum?: (urn: string) => void
        [key: string]: unknown
      }>
    | undefined

  // The fullscreen play page is an overlay stacked on the shell, not a branch
  // swap: the shell — and every cached page in it — stays mounted underneath,
  // so coming back from the play page finds each page exactly as it was left,
  // local state, scroll and subscriptions intact.
  const NowPlayingView = isFullscreenNowPlaying
    ? (ctx.ui.viewFor('now-playing.view') as
        | ComponentType<{ ctx: Context; onClose?: () => void }>
        | undefined)
    : undefined

  const fullscreenNowPlaying = isFullscreenNowPlaying
    ? h(
        'div',
        {
          'data-testid': 'fullscreen-now-playing',
        onMouseMove: handleFullscreenMouseMove,
        onMouseLeave: () => {
          scheduleTopBarHide(300)
        },
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'var(--bg-app, #05060B)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: '100vh',
          width: '100%',
          border: 'none',
          outline: 'none',
          margin: 0,
          padding: 0,
        },
      },
      // Top trigger sensor strip when top bar is hidden
      h('div', {
        'data-testid': 'top-bar-trigger-strip',
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 36,
          zIndex: 140,
          pointerEvents: isTopBarHovered ? 'none' : 'auto',
        },
        onMouseEnter: handleTopBarMouseEnter,
      }),
      // Unified fullscreen top bar: left close button + center drag region + right window controls
      h(
        'header',
        {
          'data-testid': 'fullscreen-top-bar',
          onMouseEnter: handleTopBarMouseEnter,
          onMouseLeave: handleTopBarMouseLeave,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 52,
            minHeight: 52,
            padding: '0 16px',
            background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.2) 70%, transparent 100%)',
            WebkitAppRegion: isTopBarHovered ? 'drag' : undefined,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 150,
            userSelect: 'none',
            transform: isTopBarHovered ? 'translateY(0)' : 'translateY(-100%)',
            opacity: isTopBarHovered ? 1 : 0,
            visibility: isTopBarHovered ? 'visible' : 'hidden',
            transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.35s ease',
            pointerEvents: isTopBarHovered ? 'auto' : 'none',
          } as ElectronCSSProperties,
        },
        // Left: Close / Return button
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Close now playing',
            onClick: () => setIsFullscreenNowPlaying(false),
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: '9999px',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              cursor: 'pointer',
              transition: 'background-color 0.2s, transform 0.2s',
              WebkitAppRegion: 'no-drag' as unknown as undefined,
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'
              e.currentTarget.style.transform = 'scale(1.06)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
              e.currentTarget.style.transform = 'scale(1)'
            },
          },
          tablerIcon('chevron-down', { size: 24 }),
        ),
        // Center: Drag spacer
        h('div', {
          style: {
            flex: 1,
            height: '100%',
            WebkitAppRegion: isTopBarHovered ? 'drag' : undefined,
          } as ElectronCSSProperties,
        }),
        // Right: SleepTimer + WindowControls
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              WebkitAppRegion: 'no-drag' as unknown as undefined,
            },
          },
          h(SleepTimerIndicator, { ctx }),
          h(WindowControls, null),
        ),
      ),
      h(
        'div',
        {
          className: 'no-scrollbar',
          style: { flex: 1, position: 'relative', overflow: 'auto', minHeight: 0 },
        },
        NowPlayingView
          ? h(
              ViewBoundary,
              {
                title: 'Now playing',
                onError: (error) =>
                  ctx.logger.error(`ui: now playing threw: ${error.stack ?? error.message}`),
              },
              h(NowPlayingView, {
                ctx,
                onClose: () => setIsFullscreenNowPlaying(false),
                showCloseButton: false,
              } as never),
            )
          : h(
              'div',
              { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
              '"Now playing" has no desktop view.',
            ),
      ),
      BottomBar
        ? h(
            'div',
            {
              'data-testid': 'hover-bottom-bar-container',
              style: {
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 200,
                overflow: isBottomBarHovered ? 'visible' : 'hidden',
              },
              onMouseEnter: () => setIsBottomBarHovered(true),
              onMouseLeave: () => setIsBottomBarHovered(false),
            },
            h('div', {
              style: {
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 48,
                pointerEvents: isBottomBarHovered ? 'none' : 'auto',
              },
            }),
            h(
              'footer',
              {
                style: {
                  transform: isBottomBarHovered ? 'translateY(0)' : 'translateY(100%)',
                  opacity: isBottomBarHovered ? 1 : 0,
                  visibility: isBottomBarHovered ? 'visible' : 'hidden',
                  transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, visibility 0.3s ease',
                  boxShadow: isBottomBarHovered ? '0 -4px 24px rgba(0, 0, 0, 0.6)' : 'none',
                  pointerEvents: isBottomBarHovered ? 'auto' : 'none',
                  border: 'none',
                  borderTop: 'none',
                  borderBottom: 'none',
                  outline: 'none',
                },
              },
              h(BottomBar, {
                ctx,
                currentRoute: isQueueOpen ? 'queue.view' : currentId,
                // The hover container clips fixed menus; portal them out.
                portalMenus: true,
              }),
            ),
          )
        : null,
    )
  : null

  const sidebarCol =
    libraryMode === 'expanded'
      ? '1fr'
      : libraryMode === 'collapsed'
        ? '72px'
        : `${sidebarWidth}px`

  // The queue never takes a grid column: it is a right-side drawer overlaying
  // the content, so opening it resizes nothing — least of all the top bar.
  const gridColumns = libraryMode === 'expanded' ? '1fr' : `${sidebarCol} 1fr`

  // The top bar sits directly above the main view — inside the main card
  // normally, inside the expanded library pane when the library takes over —
  // so the library column runs the full window height, and the queue drawer
  // slides over the content without ever resizing this header. Sticky keeps
  // the window controls reachable when the expanded library scrolls.
  const topBar = h(
    'div',
    { style: { flexShrink: 0, position: 'sticky', top: 0, zIndex: 60 } },
    h(TopBar, {
      ctx,
      canGoBack,
      canGoForward,
      onBack: handleBack,
      onForward: handleForward,
      onHome: handleHome,
      onSearch: (
        query: string,
        opts?: Parameters<NonNullable<TopBarProps['onSearch']>>[1],
      ) => {
        navigateTo('sources.search', { query, ...opts, searchTimestamp: Date.now() })
      },
      onOpenSettings: () => {
        navigateTo('settings.view')
      },
    }),
  )

  return h(
    'div',
    {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg-app, #05060B)',
      },
    },
    h(
      'div',
      {
        ref: workspaceRef,
        style: {
          display: 'grid',
          position: 'relative',
          gridTemplateColumns: gridColumns,
          gap: 8,
          padding: 8,
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          transition: isDragging ? 'none' : 'grid-template-columns 0.28s cubic-bezier(0.2, 0, 0, 1)',
        },
      },
      h(
        'nav',
        {
          style: {
            borderRadius: 8,
            padding: LibraryView ? 0 : 12,
            background: 'var(--bg-primary, #080A12)',
            border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        },
        h(
          'div',
          {
            style: LibraryView
              ? {
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }
              : { fontSize: 12, color: 'var(--text-muted, #626A80)', padding: '8px 10px', letterSpacing: 1 },
          },
          'BBeBee',
        ),
        LibraryView
          ? h(
              'div',
              {
                style:
                  libraryMode === 'expanded'
                    ? { flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }
                    : { height: '100%', width: '100%', display: 'flex', flexDirection: 'column' },
              },
              libraryMode === 'expanded' ? topBar : null,
              h('span', { style: { display: 'none' } }, 'Library'),
              h(LibraryView, {
                ctx,
                mode: libraryMode,
                onModeChange: setLibraryMode,
                onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
                // The quick entries (喜欢 / 本地和下载) highlight from the
                // route actually on screen, so shell-internal navigation —
                // opening an album, back/forward, home — clears them too.
                activeViewId: currentId,
              }),
              entries
                .filter((e) => e.group === 'settings')
                .map((entry) =>
                  h(
                    'button',
                    {
                      key: entry.id,
                      onClick: () => navigateTo(entry.id),
                      style: {
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 10px',
                        marginBottom: 2,
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        background: currentId === entry.id ? 'var(--sidebar-item-active, var(--surface-selected, rgba(95, 135, 255, 0.15)))' : 'transparent',
                        color: currentId === entry.id ? 'var(--sidebar-item-text-active, var(--text-primary, #F2F5FF))' : 'var(--sidebar-item-text, var(--text-tertiary, #8B95B0))',
                        font: 'inherit',
                      },
                    },
                    entry.title,
                  ),
                ),
            )
          : entries.map((entry, index) => {
              const isActive =
                currentId === entry.id ||
                (currentId === 'album.view' && entry.id === 'library.home')
              return h(
                'div',
                { key: entry.id },
                // One heading, above the first settings page. Without the divide the
                // sidebar reads as one flat list and "Music folders" looks like a
                // library section rather than a setting.
                entry.group === 'settings' && entries[index - 1]?.group !== 'settings'
                  ? h(
                      'div',
                      {
                        style: {
                          fontSize: 11,
                          color: 'var(--text-muted, #626A80)',
                          padding: '14px 10px 4px',
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                        },
                      },
                      'Settings',
                    )
                  : null,
                h(
                  'button',
                  {
                    onClick: () => {
                      if (entry.id === 'now-playing.view') {
                        setIsFullscreenNowPlaying(true)
                      } else {
                        navigateTo(entry.id)
                      }
                    },
                    style: {
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      marginBottom: 2,
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: isActive ? 'var(--sidebar-item-active, var(--surface-selected, rgba(95, 135, 255, 0.15)))' : 'transparent',
                      color: isActive ? 'var(--sidebar-item-text-active, var(--text-primary, #F2F5FF))' : 'var(--sidebar-item-text, var(--text-tertiary, #8B95B0))',
                      font: 'inherit',
                    },
                  },
                  entry.title,
                ),
              )
            }),
      ),
      libraryMode === 'expanded'
        ? null
        : h(
            'main',
            {
              style: {
                borderRadius: 8,
                background: 'var(--bg-primary, #080A12)',
                border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
                overflow: 'hidden',
                minHeight: 0,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
              },
            },
            topBar,
            h(
              'div',
              { style: { flex: 1, minHeight: 0, position: 'relative' } },
              pagesToRender.size === 0
                ? h(
                    'div',
                    { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
                    active
                      ? `"${active.title}" has no desktop view.`
                      : 'No plugin has contributed a route.',
                  )
                : Array.from(pagesToRender.values()).map((page) => {
                  const isCurrent = page.key === currentKey
                  const pageView = page.id
                    ? (ctx.ui.viewFor(page.id) as
                        | ComponentType<{
                            ctx: Context
                            onOpenAlbum?: (urn: string) => void
                            [key: string]: unknown
                          }>
                        | undefined)
                    : undefined
                  const pageActive =
                    entries.find((e) => e.id === page.id) ??
                    (page.id ? { id: page.id, title: page.id, group: 'main' as const } : defaultEntry)

                  return h(
                    'div',
                    {
                      key: page.key,
                      'data-testid': `view-page-${page.id}`,
                      ref: (el: HTMLDivElement | null) => {
                        if (el) pageContainerRefs.current.set(page.key, el)
                        else pageContainerRefs.current.delete(page.key)
                      },
                      style: {
                        display: isCurrent ? 'flex' : 'none',
                        flexDirection: 'column',
                        height: '100%',
                        width: '100%',
                        minHeight: 0,
                        overflow: 'auto',
                      },
                    },
                    pageView
                      ? page.id === 'library.home' && LibraryView
                        ? h(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                color: 'var(--text-tertiary, #8B92A6)',
                                gap: 12,
                              },
                            },
                            tablerIcon('music', { size: 52, style: { opacity: 0.6 } }),
                            h('div', { style: { fontSize: 15, fontWeight: 500 } }, '选择歌单或专辑开始播放'),
                          )
                        : h(
                            ViewBoundary,
                            {
                              title: pageActive?.title ?? page.id ?? 'This view',
                              resetKey: isCurrent ? 'active' : 'inactive',
                              onError: (error) =>
                                ctx.logger.error(
                                  `ui: view "${page.id}" threw: ${error.stack ?? error.message}`,
                                ),
                            },
                            h(pageView, {
                              ctx,
                              ...page.params,
                              onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
                            }),
                          )
                      : h(
                          'div',
                          { style: { padding: 24, color: 'var(--text-tertiary, #8B92A6)' } },
                          pageActive
                            ? `"${pageActive.title}" has no desktop view.`
                            : 'No plugin has contributed a route.',
                        ),
                  )
                }),
              ),
          ),
      isQueueOpen && QueueView
        ? h(
            'aside',
            {
              'data-testid': 'queue-sidebar-panel',
              style: {
                // A drawer overlaying the content, not a grid column: below
                // the 48px top bar so the window controls stay reachable.
                // Above the fullscreen play-page overlay (z 100) so the queue
                // can be opened from the play page without leaving it; still
                // below the share modals (130) and the desktop lyrics (9999).
                position: 'absolute',
                top: 64,
                right: 8,
                bottom: 8,
                width: queueWidth ?? QUEUE_DRAWER_WIDTH,
                zIndex: isFullscreenNowPlaying ? 120 : 40,
                borderRadius: 8,
                background: 'var(--bg-primary, #080A12)',
                border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
                overflow: 'hidden',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                animation: isDragging ? 'none' : 'queueDrawerIn 0.28s cubic-bezier(0.2, 0, 0, 1)',
              },
            },
            h('style', null, QUEUE_DRAWER_KEYFRAMES),
            h(
              ViewBoundary,
              {
                title: 'Queue',
                onError: (error) =>
                  ctx.logger.error(`ui: queue panel threw: ${error.stack ?? error.message}`),
              },
              h(QueueView, {
                ctx,
                onClose: () => setIsQueueOpen(false),
              }),
            ),
          )
        : null,
      // Left Splitter (between nav and main)
      libraryMode !== 'expanded'
        ? h(Splitter, {
            'data-testid': 'sidebar-splitter',
            position: {
              left: 8 + (libraryMode === 'collapsed' ? 72 : sidebarWidth),
            },
            isDragging: isDragging === 'sidebar',
            onMouseDown: handleSidebarMouseDown,
            onDoubleClick: () => {
              if (libraryMode === 'collapsed') {
                setLibraryMode('sidebar')
                setSidebarWidth(280)
              } else {
                setSidebarWidth(280)
              }
            },
          })
        : null,
      // Right Splitter (between main and aside)
      isQueueOpen && QueueView
        ? h(Splitter, {
            'data-testid': 'queue-splitter',
            top: 64,
            position: {
              right: 8 + (queueWidth ?? QUEUE_DRAWER_WIDTH),
            },
            isDragging: isDragging === 'queue',
            zIndex: isFullscreenNowPlaying ? 125 : undefined,
            onMouseDown: handleQueueMouseDown,
            onDoubleClick: () => setQueueWidth(null),
          })
        : null,
    ),
    BottomBar
      ? h(
          'footer',
          {
            style: {
              background: 'var(--player-bg, var(--bg-app, #05060B))',
              border: 'none',
              borderTop: 'none',
              borderBottom: 'none',
              margin: 0,
              padding: 0,
              outline: 'none',
              boxShadow: 'none',
              position: 'relative',
              zIndex: 10,
            },
          },
          h(BottomBar, {
            ctx,
            currentRoute: isQueueOpen ? 'queue.view' : currentId,
            onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
          }),
        )
      : null,
    // The fullscreen play-page overlay rides on the always-mounted shell.
    // DesktopLyrics and ShareHost stay after it so their fixed surfaces stack
    // above the overlay, exactly as they did when the two were branch swaps.
    fullscreenNowPlaying,
    DesktopLyrics ? h(DesktopLyrics, { ctx }) : null,
    ShareHost
      ? h(
          // A stacking context above the queue drawer (120): a share modal
          // opened from the play page must not slide behind the drawer.
          'div',
          { style: { position: 'relative', zIndex: 130 } },
          h(ShareHost, { ctx }),
        )
      : null,
    // Drop-to-import overlay: full-window while a file drag is over the app,
    // then the result toast. Both are inert (`pointerEvents: 'none'`) — the
    // root div underneath is the real drop target.
    dropActive || dropMessage
      ? h(
          'div',
          {
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 12000,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: dropActive ? 'rgba(5, 6, 11, 0.72)' : 'transparent',
              backdropFilter: dropActive ? 'blur(2px)' : undefined,
            },
          },
          h(
            'div',
            {
              style: {
                padding: '24px 44px',
                borderRadius: 16,
                border: dropActive
                  ? '2px dashed var(--accent-primary, #5F87FF)'
                  : '1px solid var(--border-subtle, rgba(148,163,184,0.2))',
                background: 'rgba(13, 14, 21, 0.94)',
                color: 'var(--text-primary, #F2F5FF)',
                fontSize: dropActive ? 18 : 14,
                fontWeight: dropActive ? 600 : 500,
                letterSpacing: '0.02em',
                boxShadow: '0 12px 48px rgba(0, 0, 0, 0.5)',
              },
            },
            dropMessage ?? '松开鼠标，导入音乐文件或文件夹',
          ),
        )
      : null,
  )
}
