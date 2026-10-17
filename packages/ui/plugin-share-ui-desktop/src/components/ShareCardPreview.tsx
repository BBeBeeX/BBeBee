import { createElement as h, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import {
  type BackgroundMode,
  drawTrackCard,
  drawPlaylistCard,
  drawAlbumCard,
  drawLyricsCard,
} from '../utils/canvasRenderer.js'

export interface ShareCardPreviewProps {
  title: string
  subtitle: string
  artwork?: string
  themeColor: string
  backgroundMode: BackgroundMode
  lyrics?: string[]
  type?: 'track' | 'playlist' | 'album' | 'lyrics'
  cardOnly?: boolean
}

export function normalizeArtworkUrl(src?: string): string | undefined {
  if (!src) return undefined
  if (src.startsWith('bbebee-file:')) return src
  if (src.startsWith('file://')) return src.replace(/^file:\/\//, 'bbebee-file://')
  if (src.startsWith('file:')) return src.replace(/^file:\/*/, 'bbebee-file:///')
  if (/^[a-zA-Z]:[\\/]/.test(src)) return `bbebee-file:///${src.replace(/\\/g, '/')}`
  if (src.startsWith('/') && !src.startsWith('//')) return `bbebee-file://${src}`
  return src
}

export function ShareCardPreview({
  title,
  subtitle,
  artwork,
  themeColor,
  backgroundMode,
  lyrics,
  type = 'track',
  cardOnly = false,
}: ShareCardPreviewProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isLyricsMode = Boolean((lyrics && lyrics.length > 0) || type === 'lyrics')
  const displayArtwork = normalizeArtworkUrl(artwork)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let active = true

    async function renderCanvas() {
      if (!active) return
      try {
        if (isLyricsMode) {
          await drawLyricsCard(canvas!, {
            lyrics: {
              trackUrn: '',
              title,
              artist: subtitle,
              lines: lyrics ?? [],
              artwork: displayArtwork,
            },
            themeColor,
            backgroundMode,
            cardOnly,
          })
        } else if (type === 'playlist') {
          await drawPlaylistCard(canvas!, {
            playlist: {
              urn: '',
              name: title,
              trackCount: 0,
              subtitle,
              artwork: displayArtwork,
            },
            themeColor,
            backgroundMode,
          })
        } else if (type === 'album') {
          await drawAlbumCard(canvas!, {
            album: {
              urn: '',
              title,
              artist: subtitle,
              trackCount: 0,
              subtitle,
              artwork: displayArtwork,
            },
            themeColor,
            backgroundMode,
          })
        } else {
          await drawTrackCard(canvas!, {
            track: {
              urn: '',
              title,
              artist: subtitle,
              artwork: displayArtwork,
            },
            themeColor,
            backgroundMode,
          })
        }
      } catch {
        // Headless environment or draw error
      }
    }

    void renderCanvas()
    return () => {
      active = false
    }
  }, [title, subtitle, displayArtwork, themeColor, backgroundMode, lyrics, isLyricsMode, type, cardOnly])

  return h(
    'div',
    {
      style: {
        width: 252,
        height: cardOnly ? 'auto' : 448,
        maxHeight: 448,
        borderRadius: cardOnly ? 14 : 20,
        background: 'transparent',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: cardOnly
          ? '0 12px 28px rgba(0, 0, 0, 0.5)'
          : '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 0, 0, 0.4)',
        boxSizing: 'border-box',
        userSelect: 'none',
      },
    },
    // The live Canvas, rendered at 540x960 (or 440xH) and displayed sharply
    h('canvas', {
      ref: canvasRef,
      width: 540,
      height: 960,
      style: {
        width: 252,
        height: cardOnly ? 'auto' : 448,
        maxHeight: 448,
        display: 'block',
        borderRadius: cardOnly ? 14 : 20,
      },
    }),
    // Accessible text for screen readers and unit tests
    h(
      'div',
      {
        'aria-hidden': 'true',
        style: {
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        },
      },
      title,
      ' ',
      subtitle,
      ' ',
      ...(lyrics ?? []),
    ),
  )
}
