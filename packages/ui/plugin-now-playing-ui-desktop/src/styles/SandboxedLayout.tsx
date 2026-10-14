/**
 * Sandboxed layout for external Now Playing style plugins.
 *
 * Runs external plugin HTML/JS/CSS inside an isolated iframe with:
 *  - sandbox="allow-scripts" (strictly NO allow-same-origin, NO allow-forms, NO allow-top-navigation)
 *  - Unidirectional snapshot delivery (Host -> Sandbox via postMessage)
 *  - Strictly whitelisted control actions (Sandbox -> Host via postMessage)
 *  - Host-extracted cover theme color (coverThemeColor) to prevent canvas tainting in sandbox
 */

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
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
import { useCurrentTrack } from '../hooks.js'
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

  // 1. Resolve artwork & cover theme color with bbebee-file:// rewrite for local assets
  const currentTrack = useCurrentTrack(ctx)
  const effectiveArtwork = state.nowPlaying?.artwork ?? currentTrack?.artwork
  const resolvedArtwork = useResolvedArtwork(ctx, effectiveArtwork)
  const rawCover = resolvedArtwork?.sourceUrl ?? effectiveArtwork?.sourceUrl
  const coverUrl = useMemo(() => {
    if (!rawCover) return null
    return rawCover.startsWith('file://') ? rawCover.replace(/^file:\/\//, 'bbebee-file://') : rawCover
  }, [rawCover])

  const dominant = resolvedArtwork?.dominantColor ?? effectiveArtwork?.dominantColor
  const extractedImageColor = useImageColor(coverUrl ?? undefined, dominant)
  const coverThemeColor = dominant ?? extractedImageColor ?? null

  const title = state.nowPlaying?.title ?? currentTrack?.title ?? ''
  const artist = state.nowPlaying?.artist ?? currentTrack?.artists?.map((a) => a.name).join(', ') ?? ''
  const album = state.nowPlaying?.album ?? currentTrack?.albumTitle

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
  const durationMs = Math.round(duration ?? state.durationMs ?? 0)
  const positionMs = Math.round(displayPosition ?? state.positionMs ?? 0)

  const snapshot: SandboxPlayerSnapshot = useMemo(() => {
    return {
      cover: coverUrl,
      coverThemeColor,
      title,
      artist,
      album,
      lyrics: {
        lines: lyricLines,
        activeIndex,
      },
      positionMs,
      durationMs,
      isPlaying,
      isLoved,
    }
  }, [
    coverUrl,
    coverThemeColor,
    title,
    artist,
    album,
    lyricLines,
    activeIndex,
    positionMs,
    durationMs,
    isPlaying,
    isLoved,
  ])

  // 5. Unidirectional snapshot broadcast to iframe
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  const sendSnapshot = useCallback(() => {
    const iframe = iframeRef.current
    if (typeof iframe?.contentWindow?.postMessage === 'function') {
      iframe.contentWindow.postMessage(
        {
          type: 'NOW_PLAYING_SNAPSHOT',
          payload: snapshotRef.current,
        },
        '*',
      )
    }
  }, [])

  useEffect(() => {
    sendSnapshot()
  }, [snapshot, sendSnapshot])

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
          void ctx.player.play()
          break
        case 'action:pause':
          ctx.player.pause()
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
          const urn = trackUrn ?? state.trackUrn
          if (urn) {
            const library = serviceOf<LibraryService>(ctx, 'library')
            if (library) {
              void library.isSaved(urn).then((saved) => {
                void library.setSaved(urn, !saved)
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
  }, [ctx, trackUrn, state.trackUrn, sendSnapshot])

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
      onLoad: () => {
        sendSnapshot()
      },
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
