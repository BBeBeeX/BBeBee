/**
 * Vinyl layout — spinning record player aesthetic.
 *
 * The artwork is clipped into a circle and spins via a CSS keyframe animation
 * when the track is playing.  A decorative ring simulates the grooves of a
 * vinyl record.  Controls sit below the disc.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

/** Injected once per mount via a <style> element. */
const SPIN_CSS = `
@keyframes bb-vinyl-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`

export function VinylLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, PanelComponent, VisualizerComponent } = props
  const isSpinning = state.status === 'playing' || state.status === 'stalled'
  const discSize = PanelComponent ? 240 : 300

  return h(
    'div',
    {
      'data-testid': 'layout-vinyl',
      style: {
        display: 'flex',
        flexDirection: PanelComponent ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[6],
        width: '100%',
        maxWidth: PanelComponent ? 1100 : 520,
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
      },
    },
    /* inject keyframes */
    h('style', { dangerouslySetInnerHTML: { __html: SPIN_CSS } }),
    /* player column */
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: tokens.space[5],
          maxWidth: 480,
          width: '100%',
        },
      },
      /* ── vinyl disc ─────────────────────────────────────────────── */
      h(
        'div',
        {
          'aria-label': 'Vinyl disc',
          style: {
            position: 'relative',
            width: discSize + 40,
            height: discSize + 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        /* outer ring — simulates grooves */
        h('div', {
          style: {
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `radial-gradient(circle,
              rgba(30, 30, 30, 1) 0%,
              rgba(20, 20, 20, 1) 35%,
              rgba(40, 40, 40, 0.9) 36%,
              rgba(25, 25, 25, 1) 48%,
              rgba(50, 50, 50, 0.6) 49%,
              rgba(25, 25, 25, 1) 60%,
              rgba(45, 45, 45, 0.7) 61%,
              rgba(20, 20, 20, 1) 100%)`,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            animation: isSpinning ? 'bb-vinyl-spin 4s linear infinite' : 'none',
            animationPlayState: isSpinning ? 'running' : 'paused',
          },
        }),
        /* centre label with artwork */
        h(
          'div',
          {
            style: {
              position: 'relative',
              zIndex: 1,
              width: discSize,
              height: discSize,
              borderRadius: '50%',
              overflow: 'hidden',
              animation: isSpinning ? 'bb-vinyl-spin 4s linear infinite' : 'none',
              animationPlayState: isSpinning ? 'running' : 'paused',
              boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.5)',
            },
          },
          h(CachedArtwork, {
            ctx,
            artwork: state.nowPlaying?.artwork,
            seed: state.trackUrn,
            size: discSize,
            radius: discSize / 2,
          }),
        ),
        /* centre hole */
        h('div', {
          style: {
            position: 'absolute',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--bg-app, #05060B)',
            border: '2px solid rgba(255, 255, 255, 0.15)',
            zIndex: 2,
          },
        }),
      ),
      /* ── track info ─────────────────────────────────────────────── */
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
      /* ── seek bar ───────────────────────────────────────────────── */
      h(
        'div',
        { style: { width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
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
      /* ── transport ──────────────────────────────────────────────── */
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
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            },
          },
          h(PanelComponent, { ctx }),
        )
      : null,
  )
}
