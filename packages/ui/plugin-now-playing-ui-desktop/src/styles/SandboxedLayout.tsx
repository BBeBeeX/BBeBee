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
  NowPlayingService,
  NowPlayingStyleMeta,
  SandboxPlayerAction,
  SandboxPlayerLyricLine,
  SandboxPlayerSnapshot,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { toServableFileUrl } from '@BBeBee/toolkit'
import { useActiveLyricIndex, useLyrics, useResolvedArtwork } from '@BBeBee/toolkit/hooks'
import { useImageColor, useI18n } from '@BBeBee/ui-kit-desktop'
import { useCurrentTrack } from '../hooks.js'
import { SAMPLE_NEON_PLAYER_ID, SAMPLE_NEON_PLAYER_VERSION, buildSamplePluginManifest } from '../sample-template.js'
import { buildSandboxedHtml } from './sandboxed-html.js'
import type { NowPlayingLayoutProps } from './index.js'

export interface SandboxedLayoutProps extends NowPlayingLayoutProps {
  meta: NowPlayingStyleMeta
}

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

  // If this is the sample neon player and a newer version exists, upgrade it automatically
  const effectiveMeta = useMemo(() => {
    if (meta.id === SAMPLE_NEON_PLAYER_ID && meta.version !== SAMPLE_NEON_PLAYER_VERSION) {
      try {
        const manifest = JSON.parse(buildSamplePluginManifest(t)) as NowPlayingStyleMeta
        const nowPlayingService = serviceOf<NowPlayingService>(ctx, 'nowPlaying')
        if (nowPlayingService?.registerStyle) {
          nowPlayingService.registerStyle(manifest)
        }
        return manifest
      } catch {
        return meta
      }
    }
    return meta
  }, [meta, t, ctx])

  // 1. Resolve artwork & cover theme color with bbebee-file:// rewrite for local assets
  const currentTrack = useCurrentTrack(ctx)
  const effectiveArtwork = state.nowPlaying?.artwork ?? currentTrack?.artwork
  const resolvedArtwork = useResolvedArtwork(ctx, effectiveArtwork)
  const rawCover = resolvedArtwork?.sourceUrl ?? effectiveArtwork?.sourceUrl
  const coverUrl = useMemo(() => {
    if (!rawCover) return null
    let uri: string
    if (rawCover.startsWith('bbebee-file:')) uri = rawCover
    else if (rawCover.startsWith('file://')) uri = rawCover.replace(/^file:\/\//, 'bbebee-file://')
    else if (rawCover.startsWith('file:')) uri = rawCover.replace(/^file:\/*/, 'bbebee-file:///')
    else if (/^[a-zA-Z]:[\\/]/.test(rawCover)) uri = `bbebee-file:///${rawCover.replace(/\\/g, '/')}`
    else if (rawCover.startsWith('/') && !rawCover.startsWith('//')) uri = `bbebee-file://${rawCover}`
    else return rawCover
    // The webview cannot load the raw custom scheme on every platform (Windows
    // serves it over http://bbebee-file.localhost); the host owns the mapping.
    return toServableFileUrl(uri) ?? uri
  }, [rawCover])

  const dominant = resolvedArtwork?.dominantColor ?? effectiveArtwork?.dominantColor
  const extractedImageColor = useImageColor(coverUrl ?? undefined, dominant)
  const coverThemeColor = dominant ?? extractedImageColor ?? null

  const title = state.nowPlaying?.title ?? currentTrack?.title ?? ''
  const artist = state.nowPlaying?.artist ?? currentTrack?.artists?.map((a) => a.name).join(', ') ?? ''
  const album = state.nowPlaying?.album ?? currentTrack?.albumTitle

  // 2. Resolve lyrics
  const { parsed: parsedLyrics, offsetMs: lyricsOffsetMs } = useLyrics(ctx)
  const activeIndex = useActiveLyricIndex(ctx, parsedLyrics.lines, lyricsOffsetMs)

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
      effectiveMeta.htmlContent ??
        `<div style="color:white;padding:24px;">${t('nowPlaying:sandboxedLayout.noPluginContentProvided')}</div>`,
    )
  }, [effectiveMeta.htmlContent, t])

  // Desktop bridge integration for CSP-compliant bbebee-sandbox:// isolation
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)

  useEffect(() => {
    const sandboxBridge = (window as unknown as { BBeBee?: { sandbox?: { setHtml(id: string, html: string): Promise<void> } } })?.BBeBee?.sandbox
    if (sandboxBridge?.setHtml) {
      let cancelled = false
      void sandboxBridge.setHtml(effectiveMeta.id, fullHtml).then(() => {
        if (!cancelled) {
          setSandboxUrl(`bbebee-sandbox://now-playing/${encodeURIComponent(effectiveMeta.id)}`)
        }
      })
      return () => {
        cancelled = true
      }
    } else {
      setSandboxUrl(null)
    }
  }, [effectiveMeta.id, fullHtml])

  return h(
    'div',
    {
      'data-testid': 'layout-sandboxed',
      'data-style-id': effectiveMeta.id,
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
      key: sandboxUrl ?? effectiveMeta.id,
      onLoad: () => {
        sendSnapshot()
      },
      'data-testid': 'sandbox-iframe',
      // Strict sandbox isolation: only allow-scripts, NO allow-same-origin!
      sandbox: 'allow-scripts',
      src: sandboxUrl ?? undefined,
      srcDoc: sandboxUrl ? undefined : fullHtml,
      style: {
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: 'transparent',
      },
    }),
  )
}
