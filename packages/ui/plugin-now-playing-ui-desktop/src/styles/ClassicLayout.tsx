/**
 * Classic layout — the original centred arrangement.
 *
 * Artwork centred at the top, title / artist / album below, seek bar and
 * transport controls at the bottom.  When a lyrics panel is available the
 * layout becomes a two-column split (artwork+controls left, panel right).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function ClassicLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, PanelComponent, VisualizerComponent } = props

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
      },
    },
    h(CachedArtwork, {
      ctx,
      artwork: state.nowPlaying?.artwork,
      seed: state.trackUrn,
      size: PanelComponent ? 240 : 280,
      radius: tokens.radius.lg,
    }),
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
        },
      },
      h(Text, {
        variant: 'xl',
        numberOfLines: 2,
        children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
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
      ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
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
        accessibilityLabel: 'Seek',
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
        accessibilityLabel: 'Previous track',
        disabled: !can.canPrevious,
        onPress: () => void ctx.player.previous(),
      }),
      h(IconButton, {
        icon: can.canPause ? 'pause-filled' : 'play-filled',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'primary',
        size: tokens.size.iconLarge,
        disabled: !can.canPlay && !can.canPause,
        onPress: () => ctx.player.togglePlay(),
      }),
      h(IconButton, {
        icon: 'skip-forward',
        accessibilityLabel: 'Next track',
        disabled: !can.canNext,
        onPress: () => void ctx.player.next(),
      }),
      h(VolumeControl, { ctx, volume: state.volume, muted: state.muted }),
    ),
  )

  if (!PanelComponent) {
    return playerMain
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: 1100,
        gap: tokens.space[6],
        flex: 1,
        minHeight: 0,
        height: '100%',
        boxSizing: 'border-box',
      },
    },
    h(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 320,
          maxWidth: 460,
        },
      },
      playerMain,
    ),
    h(
      'div',
      {
        style: {
          flex: 1.2,
          display: 'flex',
          height: '80vh',
          maxHeight: '80vh',
          minWidth: 340,
          maxWidth: 600,
          minHeight: 0,
          borderRadius: tokens.radius.lg,
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        },
      },
      h(PanelComponent, { ctx }),
    ),
  )
}
