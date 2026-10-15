/**
 * Compact layout — side-by-side split.
 *
 * Large artwork on the left, metadata and controls stacked vertically on the
 * right.  Information-dense and well suited for widescreen displays.  When a
 * lyrics panel is present it replaces the right column's lower half.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function CompactLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, PanelComponent, VisualizerComponent } = props
  const { t } = useI18n(ctx)

  const [internalShowLyrics, setInternalShowLyrics] = useState(true)
  const isLyricsVisible = props.showLyrics ?? internalShowLyrics
  const handleToggleLyrics = props.onToggleLyrics ?? (() => setInternalShowLyrics((v) => !v))
  const isExpandedLayout = Boolean(PanelComponent && isLyricsVisible)
  const hasLyrics = Boolean(PanelComponent)

  return h(
    'div',
    {
      'data-testid': 'layout-compact',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isExpandedLayout ? tokens.space[7] : tokens.space[8],
        width: '100%',
        maxWidth: isExpandedLayout ? 1100 : 960,
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        padding: `0 ${tokens.space[5]}px`,
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
    /* ── left: artwork ──────────────────────────────────────────── */
    h(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: isExpandedLayout ? 400 : 440,
          transform: isExpandedLayout ? 'scale(1)' : 'scale(1.08)',
          transformOrigin: 'center center',
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 340,
        radius: tokens.radius.lg,
      }),
    ),
    /* ── right: info + controls ─────────────────────────────────── */
    h(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: isExpandedLayout ? tokens.space[4] : tokens.space[5],
          minWidth: 280,
          maxWidth: 480,
          justifyContent: 'center',
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      },
      /* track info */
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, {
          variant: 'xl',
          numberOfLines: 2,
          children: state.nowPlaying?.title ?? (state.trackUrn ? t('nowPlaying:nowPlaying.loading') : t('nowPlaying:nowPlaying.nothingPlaying')),
        }),
        state.nowPlaying?.artist
          ? h(Text, { variant: 'lg', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.artist })
          : null,
        state.nowPlaying?.album
          ? h(Text, { variant: 'md', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.album })
          : null,
      ),
      VisualizerComponent ? h(VisualizerComponent, { ctx }) : null,
      state.status === 'stalled'
        ? h(Text, { variant: 'sm', tone: 'muted', children: t('nowPlaying:nowPlaying.buffering') })
        : null,
      /* seek bar */
      h(
        'div',
        { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Slider, {
          value: duration ? Math.min(displayPosition, duration) : 0,
          max: duration ?? 0,
          disabled: !can.canSeek || !duration,
          accessibilityLabel: t('nowPlaying:nowPlaying.seek'),
          onChange: props.onSeekChange,
          onCommit: props.onSeekCommit,
        }),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between' } },
          h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(displayPosition) }),
          h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
        ),
      ),
      /* transport controls */
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[4] } },
        h(PlayModeButton, { ctx, mode: state.playMode }),
        h(IconButton, {
          icon: 'skip-back',
          accessibilityLabel: t('nowPlaying:nowPlayingStyles.previousTrack'),
          disabled: !can.canPrevious,
          onPress: () => void ctx.player.previous(),
        }),
        h(IconButton, {
          icon: can.canPause ? 'pause-filled' : 'play-filled',
          accessibilityLabel: can.canPause ? t('nowPlaying:nowPlaying.pause') : t('nowPlaying:nowPlaying.play'),
          variant: 'primary',
          size: tokens.size.iconLarge,
          disabled: !can.canPlay && !can.canPause,
          onPress: () => ctx.player.togglePlay(),
        }),
        h(IconButton, {
          icon: 'skip-forward',
          accessibilityLabel: t('nowPlaying:nowPlayingStyles.nextTrack'),
          disabled: !can.canNext,
          onPress: () => void ctx.player.next(),
        }),
        h(VolumeControl, { ctx, volume: state.volume, muted: state.muted }),
        hasLyrics
          ? h(IconButton, {
              icon: 'lyrics',
              variant: isLyricsVisible ? 'primary' : 'ghost',
              accessibilityLabel: isLyricsVisible
                ? t('nowPlaying:nowPlaying.hideLyrics')
                : t('nowPlaying:nowPlaying.showLyrics'),
              onPress: handleToggleLyrics,
            })
          : null,
      ),
      /* lyrics panel below controls if present */
      PanelComponent
        ? h(
            'div',
            {
              style: {
                flex: isLyricsVisible ? 1 : 0,
                display: 'flex',
                maxHeight: isLyricsVisible ? '40vh' : 0,
                minHeight: isLyricsVisible ? 180 : 0,
                opacity: isLyricsVisible ? 1 : 0,
                transform: isLyricsVisible ? 'translateY(0)' : 'translateY(24px)',
                pointerEvents: isLyricsVisible ? 'auto' : 'none',
                borderRadius: tokens.radius.lg,
                background: 'rgba(255, 255, 255, 0.03)',
                border: isLyricsVisible ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid transparent',
                overflow: 'hidden',
                transition:
                  'all 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-color 0.4s ease',
              },
            },
            h(PanelComponent, { ctx }),
          )
        : null,
    ),
  )
}
