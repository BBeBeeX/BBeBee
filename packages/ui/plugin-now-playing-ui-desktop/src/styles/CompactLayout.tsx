/**
 * Compact layout — side-by-side split.
 *
 * Information-dense widescreen layout:
 * - Left/Main player: Album artwork and vertical metadata/controls arranged side-by-side.
 * - Right column: Full-height synchronized lyrics panel (when available).
 * - Lyrics toggle button allows hiding the lyrics column, smoothly centering the
 *   side-by-side player with fluid transitions.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, MarqueeText, Slider, Text, useI18n } from '@BBeBee/ui-kit-desktop'
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
        gap: isExpandedLayout ? tokens.space[6] : 0,
        width: '100%',
        maxWidth: isExpandedLayout ? 1200 : 760,
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        padding: `0 ${tokens.space[5]}px`,
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
    /* ── left/main: side-by-side compact player (artwork + controls) ── */
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[6],
          maxWidth: isExpandedLayout ? 680 : 760,
          flex: 1,
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      },
      /* artwork */
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxWidth: isExpandedLayout ? 300 : 360,
            transform: isExpandedLayout ? 'scale(1)' : 'scale(1.06)',
            transformOrigin: 'center center',
            transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            flexShrink: 0,
          },
        },
        h(CachedArtwork, {
          ctx,
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: isExpandedLayout ? 280 : 340,
          radius: tokens.radius.lg,
        }),
      ),
      /* right half of player: metadata + controls */
      h(
        'div',
        {
          style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[4],
            minWidth: 260,
            maxWidth: 380,
            justifyContent: 'center',
          },
        },
        /* track info */
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
          h(MarqueeText, {
            variant: 'xl',
            children: state.nowPlaying?.title ?? (state.trackUrn ? t('nowPlaying:nowPlaying.loading') : t('nowPlaying:nowPlaying.nothingPlaying')),
          }),
          state.nowPlaying?.artist
            ? h(MarqueeText, { variant: 'lg', tone: 'muted', children: state.nowPlaying.artist })
            : null,
          state.nowPlaying?.album
            ? h(MarqueeText, { variant: 'md', tone: 'muted', children: state.nowPlaying.album })
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
      ),
    ),
    /* ── right: lyrics column ── */
    PanelComponent
      ? h(
          'div',
          {
            'data-testid': 'compact-lyrics-column',
            style: {
              flex: isLyricsVisible ? 1.2 : 0,
              display: 'flex',
              height: '80vh',
              maxHeight: '80vh',
              minWidth: isLyricsVisible ? 340 : 0,
              maxWidth: isLyricsVisible ? 560 : 0,
              opacity: isLyricsVisible ? 1 : 0,
              transform: isLyricsVisible ? 'translateX(0)' : 'translateX(60px)',
              pointerEvents: isLyricsVisible ? 'auto' : 'none',
              overflow: 'hidden',
              minHeight: 0,
              borderRadius: tokens.radius.lg,
              background: 'rgba(255, 255, 255, 0.03)',
              border: isLyricsVisible ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid transparent',
              transition:
                'all 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-color 0.4s ease',
            },
          },
          h(PanelComponent, { ctx }),
        )
      : null,
  )
}
