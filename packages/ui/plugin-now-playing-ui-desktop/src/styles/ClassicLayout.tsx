/**
 * Classic layout — the original centred arrangement.
 *
 * Artwork centred at the top, title / artist / album below, seek bar and
 * transport controls at the bottom.  When a lyrics panel is available the
 * layout becomes a two-column split (artwork+controls left, panel right).
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function ClassicLayout(props: NowPlayingLayoutProps): ReactElement {
  const {
    ctx,
    state,
    displayPosition,
    duration,
    can,
    PanelComponent,
    VisualizerComponent,
    showLyrics: propShowLyrics,
    onToggleLyrics,
  } = props
  const { t } = useI18n(ctx)
  const [localShowLyrics, setLocalShowLyrics] = useState(true)
  const isLyricsVisible = propShowLyrics !== undefined ? propShowLyrics : localShowLyrics
  const toggleLyrics = onToggleLyrics ?? (() => setLocalShowLyrics((prev) => !prev))

  const isExpandedLayout = Boolean(PanelComponent && isLyricsVisible)

  const playerMain = h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        maxWidth: 480,
        width: '100%',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
          transform: isExpandedLayout ? 'scale(1)' : 'scale(1.15)',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 240,
        radius: tokens.radius.lg,
      }),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: tokens.space[1],
          maxWidth: 480,
          textAlign: 'center',
          transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      },
      h(Text, {
        variant: 'xl',
        numberOfLines: 2,
        children: state.nowPlaying?.title ?? (state.trackUrn ? t('nowPlaying:nowPlaying.loading') : t('nowPlaying:nowPlaying.nothingPlaying')),
      }),
      state.nowPlaying?.artist
        ? h(Text, { variant: 'md', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.artist })
        : null,
      state.nowPlaying?.album
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.album })
        : null,
    ),
    VisualizerComponent ? h(VisualizerComponent, { ctx }) : null,
    state.status === 'stalled'
      ? h(Text, { variant: 'sm', tone: 'muted', children: t('nowPlaying:nowPlaying.buffering') })
      : null,
    h(
      'div',
      {
        style: {
          width: '100%',
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1],
        },
      },
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
      PanelComponent
        ? h(IconButton, {
            icon: 'lyrics',
            testID: 'classic-lyrics-toggle',
            accessibilityLabel: isLyricsVisible ? t('nowPlaying:nowPlaying.hideLyrics') : t('nowPlaying:nowPlaying.showLyrics'),
            variant: isLyricsVisible ? 'primary' : 'ghost',
            onPress: toggleLyrics,
          })
        : null,
    ),
  )

  if (!PanelComponent) {
    return playerMain
  }

  return h(
    'div',
    {
      'data-testid': 'layout-classic',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: isExpandedLayout ? 1100 : 520,
        gap: isExpandedLayout ? tokens.space[6] : 0,
        flex: 1,
        minHeight: 0,
        height: '100%',
        boxSizing: 'border-box',
        transition: 'max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), gap 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
    h(
      'div',
      {
        style: {
          flex: isExpandedLayout ? 1 : '0 1 480px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: isExpandedLayout ? 320 : undefined,
          maxWidth: 480,
          width: '100%',
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        },
      },
      playerMain,
    ),
    h(
      'div',
      {
        'data-testid': 'classic-lyrics-column',
        style: {
          flex: isLyricsVisible ? 1.2 : 0,
          display: 'flex',
          height: '80vh',
          maxHeight: '80vh',
          minWidth: isLyricsVisible ? 340 : 0,
          maxWidth: isLyricsVisible ? 600 : 0,
          minHeight: 0,
          borderRadius: tokens.radius.lg,
          background: 'rgba(255, 255, 255, 0.03)',
          border: isLyricsVisible ? '1px solid rgba(255, 255, 255, 0.06)' : '0px solid transparent',
          overflow: 'hidden',
          opacity: isLyricsVisible ? 1 : 0,
          transform: isLyricsVisible ? 'translateX(0) scale(1)' : 'translateX(60px) scale(0.95)',
          pointerEvents: isLyricsVisible ? 'auto' : 'none',
          transition:
            'max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), flex 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), border 0.3s ease',
        },
      },
      h(PanelComponent, { ctx }),
    ),
  )
}
