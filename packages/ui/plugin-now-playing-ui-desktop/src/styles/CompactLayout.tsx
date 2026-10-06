/**
 * Compact layout — side-by-side split.
 *
 * Large artwork on the left, metadata and controls stacked vertically on the
 * right.  Information-dense and well suited for widescreen displays.  When a
 * lyrics panel is present it replaces the right column's lower half.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function CompactLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, PanelComponent, VisualizerComponent } = props

  return h(
    'div',
    {
      'data-testid': 'layout-compact',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[7],
        width: '100%',
        maxWidth: 1100,
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        padding: `0 ${tokens.space[5]}px`,
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
          maxWidth: 400,
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
          gap: tokens.space[5],
          minWidth: 280,
          maxWidth: 480,
          justifyContent: 'center',
        },
      },
      /* track info */
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, {
          variant: 'xl',
          numberOfLines: 2,
          children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
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
        ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' })
        : null,
      /* seek bar */
      h(
        'div',
        { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
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
      /* transport controls */
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
      /* lyrics panel below controls if present */
      PanelComponent
        ? h(
            'div',
            {
              style: {
                flex: 1,
                display: 'flex',
                maxHeight: '40vh',
                minHeight: 200,
                borderRadius: tokens.radius.lg,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                overflow: 'hidden',
              },
            },
            h(PanelComponent, { ctx }),
          )
        : null,
    ),
  )
}
