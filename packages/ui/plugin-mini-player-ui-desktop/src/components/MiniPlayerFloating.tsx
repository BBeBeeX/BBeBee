import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { MiniPlayerData, MiniPlayerAction } from '@BBeBee/protocol'
import { useBridgeLocale } from '@BBeBee/ui-kit-desktop'
import { IslandArtwork } from './IslandArtwork.js'
import { IslandWaveBars } from './IslandWaveBars.js'
import { TransportButtons, ProgressBar } from './MiniPlayerControls.js'

export interface MiniPlayerFloatingProps {
  data: MiniPlayerData
  onAction: (action: MiniPlayerAction) => void
  onSnapToTop: () => void
  onRestoreMain: () => void
  onClose: () => void
}

export function MiniPlayerFloating({
  data,
  onAction,
  onSnapToTop: _onSnapToTop,
  onRestoreMain,
  onClose,
}: MiniPlayerFloatingProps): ReactElement {
  // No ctx here (this renders inside the ctx-less mini-player window):
  // strings resolve through the preload `locale` bridge.
  const { t } = useBridgeLocale()
  const [hovered, setHovered] = useState(false)
  const isPlaying = data.status === 'playing'

  return h(
    'div',
    {
      style: {
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        background: 'transparent',
        userSelect: 'none',
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
    // The Floating Card Container (360 x 76)
    h(
      'div',
      {
        style: {
          width: 360,
          height: 76,
          boxSizing: 'border-box',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderRadius: 16,
          backgroundColor: 'rgba(18, 18, 26, 0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: hovered
            ? '0 4px 12px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2)'
            : '0 2px 8px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.18)',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        },
      },
      // Left: Artwork
      h(
        'div',
        {
          // Click-to-restore must not start a window drag.
          'data-tauri-drag-region': 'false',
          style: {
            cursor: 'pointer',
          },
          onClick: onRestoreMain,
          title: t('miniPlayer:miniPlayerFloating.clickToRestoreTheMain'),
        },
        h(IslandArtwork, {
          artworkUri: data.artworkUri,
          title: data.title,
          isPlaying,
          size: 52,
          isVinyl: true,
        }),
      ),
      // Center: Track info & progress
      h(
        'div',
        {
          style: {
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 4,
          },
        },
        // Title & Artist
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            },
          },
          h(
            'div',
            {
              style: {
                fontSize: 13,
                fontWeight: 600,
                color: '#FFFFFF',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            data.title || t('miniPlayer:miniPlayerFloating.nothingPlaying'),
          ),
          h(
            'div',
            {
              style: {
                fontSize: 11,
                color: 'rgba(255, 255, 255, 0.6)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            data.artist || 'BBeBee',
          ),
        ),
        // Mini Progress Rail
        h(ProgressBar, {
          positionMs: data.positionMs,
          durationMs: data.durationMs,
          isPlaying,
          onSeek: (pos) => onAction({ type: 'seek', positionMs: pos }),
        }),
      ),
      // Right: Controls & Wave Bars
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          },
        },
        h(IslandWaveBars, { isPlaying, height: 16 }),
        h(TransportButtons, {
          data,
          onAction,
          size: 'sm',
        }),
      ),
      // Top Right Action Buttons (shown on hover or subtle)
      h(
        'div',
        {
          style: {
            position: 'absolute',
            top: 4,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        // Restore Main Window
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('miniPlayer:miniPlayerFloating.restoreMainPlayer'),
            title: t('miniPlayer:miniPlayerFloating.restoreMainPlayer'),
            onClick: onRestoreMain,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              fontSize: 10,
              padding: 0,
            },
          },
          '⤢',
        ),
        // Close Window
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('miniPlayer:miniPlayerFloating.closeMiniPlayer'),
            title: t('miniPlayer:miniPlayerFloating.closeMiniPlayer'),
            onClick: onClose,
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              fontSize: 10,
              padding: 0,
            },
          },
          '✕',
        ),
      ),
    ),
  )
}
