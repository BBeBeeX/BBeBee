/**
 * Sandboxed layout for external Now Playing style plugins.
 *
 * Runs external plugin HTML/JS/CSS inside an isolated iframe with:
 *  - sandbox="allow-scripts" (strictly NO allow-same-origin, NO allow-forms, NO allow-top-navigation)
 *  - Unidirectional snapshot delivery (Host -> Sandbox via postMessage)
 *  - Strictly whitelisted control actions (Sandbox -> Host via postMessage)
 *  - Host-extracted cover theme color (coverThemeColor) to prevent canvas tainting in sandbox
 */

import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  LibraryService,
  LyricsService,
  LyricsState,
  NowPlayingStyleMeta,
  SandboxPlayerAction,
  SandboxPlayerLyricLine,
  SandboxPlayerSnapshot,
} from '@BBeBee/protocol'
import { parseLrc, findActiveLyricIndex } from '@BBeBee/toolkit'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { useImageColor, useI18n } from '@BBeBee/ui-kit-desktop'
import { buildSandboxedHtml } from './sandboxed-html.js'
import type { NowPlayingLayoutProps } from './index.js'

export interface SandboxedLayoutProps extends NowPlayingLayoutProps {
  meta: NowPlayingStyleMeta
}

const IDLE_LYRICS_STATE: LyricsState = { status: 'idle', offsetMs: 0 }

export function SandboxedLayout({
  ctx,
  state,
  displayPosition,
  duration,
  meta,
}: SandboxedLayoutProps): ReactElement {
  const { t } = useI18n(ctx)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const isPlaying = state.status === 'playing'

  // 1. Resolve artwork & cover theme color
  const resolvedArtwork = useResolvedArtwork(ctx, state.nowPlaying?.artwork)
  const sourceUrl = resolvedArtwork?.sourceUrl
  const dominant = resolvedArtwork?.dominantColor
  const extractedImageColor = useImageColor(sourceUrl, dominant)
  const coverThemeColor = dominant ?? extractedImageColor ?? null

  // 2. Resolve lyrics
  const lyricsService = serviceOf<LyricsService>(ctx, 'lyrics')
  const lyricsState = useServiceState<LyricsState>(
    ctx,
    ['lyrics/changed'],
    () => lyricsService?.state ?? IDLE_LYRICS_STATE,
  )

  const parsedLyrics = useMemo(() => {
    if (!lyricsState?.lyrics?.content) return { lines: [] }
    if (lyricsState.trackUrn && state.trackUrn && lyricsState.trackUrn !== state.trackUrn) {
      return { lines: [] }
    }
    return parseLrc(lyricsState.lyrics.content, { offsetMs: lyricsState.offsetMs })
  }, [lyricsState?.lyrics?.content, lyricsState?.offsetMs, lyricsState?.trackUrn, state.trackUrn])

  const activeIndex = useMemo(() => {
    if (parsedLyrics.lines.length === 0) return -1
    return findActiveLyricIndex(parsedLyrics.lines, displayPosition, lyricsState?.offsetMs ?? 0)
  }, [parsedLyrics.lines, displayPosition, lyricsState?.offsetMs])

  const lyricLines: SandboxPlayerLyricLine[] = useMemo(() => {
    return parsedLyrics.lines.map((l) => ({
      timeMs: l.timeMs,
      text: l.text,
      translation: l.translation,
    }))
  }, [parsedLyrics.lines])

  // 3. Resolve loved/favorite status
  const [isLoved, setIsLoved] = useState(false)
  const trackUrn = state.trackUrn

  useEffect(() => {
    if (!trackUrn) {
      setIsLoved(false)
      return
    }
    const library = serviceOf<LibraryService>(ctx, 'library')
    if (!library) return

    let cancelled = false
    void library.isSaved(trackUrn).then((saved) => {
      if (!cancelled) setIsLoved(Boolean(saved))
    })

    const off = ctx.on('library/changed', (_kind, urns) => {
      if (urns.includes(trackUrn)) {
        void library.isSaved(trackUrn).then((saved) => {
          if (!cancelled) setIsLoved(Boolean(saved))
        })
      }
    })

    return () => {
      cancelled = true
      off?.()
    }
  }, [ctx, trackUrn])

  // 4. Construct current snapshot
  const snapshot: SandboxPlayerSnapshot = useMemo(() => {
    return {
      cover: sourceUrl ?? null,
      coverThemeColor,
      title: state.nowPlaying?.title ?? '',
      artist: state.nowPlaying?.artist ?? '',
      album: state.nowPlaying?.album,
      lyrics: {
        lines: lyricLines,
        activeIndex,
      },
      positionMs: Math.round(displayPosition),
      durationMs: Math.round(duration ?? 0),
      isPlaying,
      isLoved,
    }
  }, [
    sourceUrl,
    coverThemeColor,
    state.nowPlaying?.title,
    state.nowPlaying?.artist,
    state.nowPlaying?.album,
    lyricLines,
    activeIndex,
    displayPosition,
    duration,
    isPlaying,
    isLoved,
  ])

  // 5. Unidirectional snapshot broadcast to iframe
  const sendSnapshot = () => {
    const iframe = iframeRef.current
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: 'NOW_PLAYING_SNAPSHOT',
          payload: snapshot,
        },
        '*',
      )
    }
  }

  useEffect(() => {
    sendSnapshot()
  }, [snapshot])

  // 6. Security guard: validate and dispatch incoming actions
  useEffect(() => {
    const handleIncomingMessage = (event: MessageEvent) => {
      // Must originate strictly from our sandboxed iframe
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'BBEBEE_SANDBOX_READY') {
        sendSnapshot()
        return
      }

      const action = data as SandboxPlayerAction
      switch (action.type) {
        case 'action:togglePlay':
          ctx.player.togglePlay()
          break
        case 'action:play':
          if (state.status === 'paused') ctx.player.togglePlay()
          break
        case 'action:pause':
          if (state.status === 'playing') ctx.player.togglePlay()
          break
        case 'action:previous':
          void ctx.player.previous()
          break
        case 'action:next':
          void ctx.player.next()
          break
        case 'action:seek':
          if (typeof action.positionMs === 'number' && Number.isFinite(action.positionMs)) {
            void ctx.player.seek(action.positionMs)
          }
          break
        case 'action:toggleFavorite': {
          if (trackUrn) {
            const library = serviceOf<LibraryService>(ctx, 'library')
            if (library) {
              void library.isSaved(trackUrn).then((saved) => {
                void library.setSaved(trackUrn, !saved)
              })
            }
          }
          break
        }
        default:
          ctx.logger.warn(`[SandboxGuard] Blocked unauthorized or invalid action: ${String((data as { type?: unknown }).type)}`)
      }
    }

    window.addEventListener('message', handleIncomingMessage)
    return () => window.removeEventListener('message', handleIncomingMessage)
  }, [ctx, state.status, trackUrn, snapshot])

  const fullHtml = useMemo(() => {
    return buildSandboxedHtml(
      meta.htmlContent ??
        `<div style="color:white;padding:24px;">${t('nowPlaying:sandboxedLayout.noPluginContentProvided')}</div>`,
    )
  }, [meta.htmlContent, t])

  return h(
    'div',
    {
      'data-testid': 'layout-sandboxed',
      'data-style-id': meta.id,
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: '#0a0d14',
      },
    },
    h('iframe', {
      ref: iframeRef,
      'data-testid': 'sandbox-iframe',
      // Strict sandbox isolation: only allow-scripts, NO allow-same-origin!
      sandbox: 'allow-scripts',
      srcDoc: fullHtml,
      style: {
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: 'transparent',
      },
    }),
  )
}
