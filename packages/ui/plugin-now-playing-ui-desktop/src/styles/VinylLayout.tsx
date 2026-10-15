/**
 * Vinyl layout — spinning record player aesthetic.
 *
 * The artwork is clipped into a circle and spins via a CSS keyframe animation
 * when the track is playing.  A decorative ring simulates the grooves of a
 * vinyl record.  Controls sit below the disc.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, Slider, Text, useI18n } from '@BBeBee/ui-kit-desktop'
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
  const { t } = useI18n(ctx)
  const isSpinning = state.status === 'playing' || state.status === 'stalled'

  const [internalShowLyrics, setInternalShowLyrics] = useState(true)
  const isLyricsVisible = props.showLyrics ?? internalShowLyrics
  const handleToggleLyrics = props.onToggleLyrics ?? (() => setInternalShowLyrics((v) => !v))
  const isExpandedLayout = Boolean(PanelComponent && isLyricsVisible)
  const hasLyrics = Boolean(PanelComponent)
  const discSize = 250

  return h(
    'div',
    {
      'data-testid': 'layout-vinyl',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isExpandedLayout ? tokens.space[6] : 0,
        width: '100%',
        maxWidth: isExpandedLayout ? 1100 : 520,
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
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
          'aria-label': t('nowPlaying:vinylLayout.vinylDisc'),
          style: {
            position: 'relative',
            width: discSize + 40,
            height: discSize + 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: isExpandedLayout ? 'scale(1)' : 'scale(1.15)',
            transformOrigin: 'center center',
            transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
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
      /* ── seek bar ───────────────────────────────────────────────── */
      h(
        'div',
        { style: { width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
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
      /* ── transport ──────────────────────────────────────────────── */
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
    /* optional panel (lyrics) with smooth animation */
    PanelComponent
      ? h(
          'div',
          {
            style: {
              flex: isLyricsVisible ? 1.2 : 0,
              display: 'flex',
              height: '80vh',
              maxHeight: '80vh',
              minWidth: isLyricsVisible ? 340 : 0,
              maxWidth: isLyricsVisible ? 600 : 0,
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
