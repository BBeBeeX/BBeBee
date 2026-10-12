import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useBridgeLocale } from '@BBeBee/ui-kit-desktop'

export interface IslandArtworkProps {
  artworkUri?: string
  title?: string
  isPlaying: boolean
  size?: number
  isVinyl?: boolean
}

export function IslandArtwork({
  artworkUri,
  title,
  isPlaying,
  size = 48,
  isVinyl = true,
}: IslandArtworkProps): ReactElement {
  // No ctx here (this renders inside the ctx-less mini-player window):
  // strings resolve through the preload `locale` bridge.
  const { t } = useBridgeLocale()
  const borderRadius = isVinyl ? '50%' : 8
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setLoadError(false)
  }, [artworkUri])

  const resolvedUri = artworkUri?.startsWith('file://')
    ? artworkUri.replace(/^file:\/\//, 'bbebee-file://')
    : artworkUri

  const showImage = Boolean(resolvedUri && !loadError)

  return h(
    'div',
    {
      style: {
        width: size,
        height: size,
        minWidth: size,
        borderRadius,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: isVinyl
          ? '0 4px 12px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.1)'
          : '0 4px 12px rgba(0, 0, 0, 0.3)',
        background: '#1A1A24',
        animation: isPlaying ? 'miniPlayerSpin 10s linear infinite' : 'none',
        willChange: 'transform',
      },
    },
    // Cover Image or Default Music Icon
    showImage
      ? h('img', {
          src: resolvedUri,
          alt: title ?? t('miniPlayer:islandArtwork.albumArt'),
          referrerPolicy: 'no-referrer',
          crossOrigin: 'anonymous',
          onError: () => setLoadError(true),
          draggable: false,
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius,
            display: 'block',
          },
        })
      : h(
          'svg',
          {
            width: size * 0.5,
            height: size * 0.5,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'rgba(255, 255, 255, 0.5)',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          h('path', { d: 'M9 18V5l12-2v13' }),
          h('circle', { cx: 6, cy: 18, r: 3 }),
          h('circle', { cx: 18, cy: 16, r: 3 }),
        ),
    // Center Hole for Vinyl Disc
    isVinyl &&
      h('div', {
        style: {
          position: 'absolute',
          width: Math.max(6, Math.round(size * 0.22)),
          height: Math.max(6, Math.round(size * 0.22)),
          borderRadius: '50%',
          backgroundColor: '#0E0E14',
          border: '1.5px solid rgba(255, 255, 255, 0.25)',
          boxShadow: '0 0 2px rgba(0, 0, 0, 0.8)',
        },
      }),
  )
}
