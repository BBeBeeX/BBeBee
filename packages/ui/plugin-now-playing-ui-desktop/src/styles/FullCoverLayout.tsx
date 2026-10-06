/**
 * Full-cover layout — immersive blurred artwork background.
 *
 * The track artwork is rendered twice: once as a full-bleed blurred background,
 * and once at a smaller size in the foreground. Controls sit in a translucent
 * bar at the bottom of the viewport.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function FullCoverLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, PanelComponent, VisualizerComponent } = props

  return h(
    'div',
    {
      'data-testid': 'layout-full-cover',
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      },
    },
    /* ── blurred background artwork ─────────────────────────────────── */
    h(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          filter: 'blur(60px) brightness(0.35) saturate(1.4)',
          transform: 'scale(1.15)',
          zIndex: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 800,
        radius: 0,
      }),
    ),
    /* ── dark overlay for readability ────────────────────────────────── */
    h('div', {
      style: {
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.3)',
        zIndex: 1,
        pointerEvents: 'none',
      },
    }),
    /* ── foreground content ──────────────────────────────────────────── */
    h(
      'div',
      {
        style: {
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: PanelComponent ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[6],
          width: '100%',
          maxWidth: PanelComponent ? 1100 : 480,
          flex: 1,
          minHeight: 0,
          padding: `0 ${tokens.space[5]}px`,
          boxSizing: 'border-box',
        },
      },
      /* main player column */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: tokens.space[5],
            maxWidth: 420,
            width: '100%',
          },
        },
        h(
          'div',
          {
            style: {
              borderRadius: tokens.radius.lg,
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
            },
          },
          h(CachedArtwork, {
            ctx,
            artwork: state.nowPlaying?.artwork,
            seed: state.trackUrn,
            size: PanelComponent ? 200 : 260,
            radius: tokens.radius.lg,
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: tokens.space[1], textAlign: 'center' } },
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
        /* transport */
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
      ),
      /* optional panel (lyrics) */
      PanelComponent
        ? h(
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
                background: 'rgba(0, 0, 0, 0.35)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              },
            },
            h(PanelComponent, { ctx }),
          )
        : null,
    ),
  )
}
