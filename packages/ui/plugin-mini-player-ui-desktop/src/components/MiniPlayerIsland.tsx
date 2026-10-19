import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { MiniPlayerData, MiniPlayerAction } from '@BBeBee/protocol'
import { useBridgeLocale } from '@BBeBee/ui-kit-desktop'
import { IslandArtwork } from './IslandArtwork.js'
import { IslandWaveBars } from './IslandWaveBars.js'
import { TransportButtons, ProgressBar } from './MiniPlayerControls.js'

export interface MiniPlayerIslandProps {
  data: MiniPlayerData
  isExpanded: boolean
  onAction: (action: MiniPlayerAction) => void
  onExpand: () => void
  onCollapse: () => void
  onDetach: () => void
  onRestoreMain: () => void
  onClose: () => void
}

export function MiniPlayerIsland({
  data,
  isExpanded,
  onAction,
  onExpand,
  onCollapse,
  onDetach: _onDetach,
  onRestoreMain,
  onClose,
}: MiniPlayerIslandProps): ReactElement {
  // No ctx here (this renders inside the ctx-less mini-player window):
  // strings resolve through the preload `locale` bridge.
  const { t } = useBridgeLocale()
  const [hovered, setHovered] = useState(false)
  const isPlaying = data.status === 'playing'

  if (isExpanded) {
    // ── Form 3: Expanded Dynamic Island (400 x 168) ───────────────────────────
    return h(
      'div',
      {
        style: {
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          boxSizing: 'border-box',
          background: 'transparent',
          paddingTop: 4,
          userSelect: 'none',
        },
      },
      h(
        'div',
        {
          style: {
            width: 400,
            height: 168,
            boxSizing: 'border-box',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: 24,
            backgroundColor: '#0A0A0F',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.2)',
            animation: 'miniPlayerExpand 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          },
          onDoubleClick: onCollapse,
          title: t('miniPlayer:miniPlayerIsland.doubleClickToCollapseThe'),
        },
        // Top Row: Artwork + Metadata + WaveBars & Actions
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            },
          },
          // Artwork
          h(
            'div',
            {
              // Click-to-restore must not start a window drag.
              'data-tauri-drag-region': 'false',
              style: { cursor: 'pointer' },
              onClick: onRestoreMain,
              title: t('miniPlayer:miniPlayerIsland.clickToRestoreTheMainWindow'),
            },
            h(IslandArtwork, {
              artworkUri: data.artworkUri,
              title: data.title,
              isPlaying,
              size: 56,
              isVinyl: true,
            }),
          ),
          // Metadata
          h(
            'div',
            {
              style: {
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#FFFFFF',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              data.title || t('miniPlayer:miniPlayerIsland.nothingPlaying'),
            ),
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: 'rgba(255, 255, 255, 0.65)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              data.artist || 'BBeBee',
            ),
            data.album &&
              h(
                'div',
                {
                  style: {
                    fontSize: 10,
                    color: 'rgba(255, 255, 255, 0.4)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                data.album,
              ),
          ),
          // Top Right: Wave bars & Quick Action Icons
          h(
            'div',
            {
              // Interactive cluster: never a drag source.
              'data-tauri-drag-region': 'false',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              },
            },
            // The dancing notes toggle the island back to its capsule form.
            h(
              'div',
              {
                onClick: onCollapse,
                title: t('miniPlayer:miniPlayerIsland.clickToCollapseTheIsland'),
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  padding: 2,
                },
              },
              h(IslandWaveBars, { isPlaying, height: 16 }),
            ),
            // Restore Main
            h(
              'button',
              {
                type: 'button',
                'aria-label': t('miniPlayer:miniPlayerIsland.restoreMainWindow'),
                title: t('miniPlayer:miniPlayerIsland.restoreMainWindow'),
                onClick: onRestoreMain,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.75)',
                  cursor: 'pointer',
                  fontSize: 11,
                },
              },
              '⤢',
            ),
            // Close
            h(
              'button',
              {
                type: 'button',
                'aria-label': t('miniPlayer:miniPlayerIsland.closeMiniPlayer'),
                title: t('miniPlayer:miniPlayerIsland.closeMiniPlayer'),
                onClick: onClose,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'rgba(255, 255, 255, 0.75)',
                  cursor: 'pointer',
                  fontSize: 11,
                },
              },
              '✕',
            ),
          ),
        ),
        // Middle Row: Progress Bar with Timestamps
        h(ProgressBar, {
          positionMs: data.positionMs,
          durationMs: data.durationMs,
          isPlaying,
          showTimestamps: true,
          onSeek: (pos) => onAction({ type: 'seek', positionMs: pos }),
        }),
        // Bottom Row: Transport Controls Centered
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
            },
          },
          h(TransportButtons, {
            data,
            onAction,
            size: 'md',
          }),
        ),
      ),
    )
  }

  // ── Form 2: Attached Dynamic Island Capsule (260 x 38) ────────────────────
  return h(
    'div',
    {
      style: {
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        boxSizing: 'border-box',
        background: 'transparent',
        paddingTop: 2,
        userSelect: 'none',
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
    h(
      'div',
      {
        onClick: onExpand,
        style: {
          width: 260,
          height: 38,
          boxSizing: 'border-box',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderRadius: 19,
          backgroundColor: '#000000',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: hovered
            ? '0 3px 8px rgba(0, 0, 0, 0.35)'
            : '0 2px 6px rgba(0, 0, 0, 0.25)',
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        },
        title: t('miniPlayer:miniPlayerIsland.clickToExpandTheIsland'),
      },
      // Left: Mini Artwork Disc (22px)
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            flex: 1,
          },
        },
        h(IslandArtwork, {
          artworkUri: data.artworkUri,
          title: data.title,
          isPlaying,
          size: 22,
          isVinyl: true,
        }),
        // Center: Compact Track Title & Artist
        h(
          'div',
          {
            style: {
              minWidth: 0,
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            },
          },
          h(
            'span',
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                color: '#FFFFFF',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            data.title || t('miniPlayer:miniPlayerIsland.nothingPlaying'),
          ),
          data.artist &&
            h(
              'span',
              {
                style: {
                  fontSize: 10,
                  color: 'rgba(255, 255, 255, 0.55)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              `• ${data.artist}`,
            ),
        ),
      ),
      // Right: Wave bars & Mini Play/Pause button
      h(
        'div',
        {
          // Interactive cluster: never a drag source.
          'data-tauri-drag-region': 'false',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        h(IslandWaveBars, { isPlaying, height: 14 }),
        h(
          'button',
          {
            type: 'button',
            'aria-label': isPlaying
              ? t('miniPlayer:miniPlayerIsland.pause')
              : t('miniPlayer:miniPlayerIsland.play'),
            title: isPlaying
              ? t('miniPlayer:miniPlayerIsland.pause')
              : t('miniPlayer:miniPlayerIsland.play'),
            onClick: (e: { stopPropagation: () => void }) => {
              e.stopPropagation()
              onAction({ type: 'togglePlay' })
            },
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: '#FFFFFF',
              color: '#000000',
              cursor: 'pointer',
              padding: 0,
            },
          },
          isPlaying
            ? h(
                'svg',
                { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'currentColor' },
                h('path', { d: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' }),
              )
            : h(
                'svg',
                { width: 10, height: 10, viewBox: '0 0 24 24', fill: 'currentColor', style: { marginLeft: 1 } },
                h('path', { d: 'M8 5v14l11-7z' }),
              ),
        ),
      ),
    ),
  )
}
