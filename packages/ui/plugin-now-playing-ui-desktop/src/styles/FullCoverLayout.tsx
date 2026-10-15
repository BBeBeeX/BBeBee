/**
 * Full-cover layout — immersive blurred artwork background.
 *
 * The track artwork is rendered twice: once as a full-bleed blurred background,
 * and once at a smaller size in the foreground. Controls sit in a translucent
 * bar at the bottom of the viewport.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { IconButton, MarqueeText, Slider, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork, PlayModeButton, VolumeControl } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function FullCoverLayout(props: NowPlayingLayoutProps): ReactElement {
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
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: isExpandedLayout ? tokens.space[6] : 0,
          width: '100%',
          maxWidth: isExpandedLayout ? 1100 : 480,
          flex: 1,
          minHeight: 0,
          padding: `0 ${tokens.space[5]}px`,
          boxSizing: 'border-box',
          transition: 'max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), gap 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
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
            maxWidth: 440,
            width: '100%',
            transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
          },
        },
        h(
          'div',
          {
            style: {
              borderRadius: tokens.radius.lg,
              boxShadow: isExpandedLayout ? '0 16px 48px rgba(0, 0, 0, 0.6)' : '0 24px 64px rgba(0, 0, 0, 0.75)',
              overflow: 'hidden',
              transform: isExpandedLayout ? 'scale(1)' : 'scale(1.18)',
              transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s ease',
            },
          },
          h(CachedArtwork, {
            ctx,
            artwork: state.nowPlaying?.artwork,
            seed: state.trackUrn,
            size: 220,
            radius: tokens.radius.lg,
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: tokens.space[1], textAlign: 'center' } },
          h(MarqueeText, {
            variant: 'xl',
            style: { width: '100%', textAlign: 'center' },
            children: state.nowPlaying?.title ?? (state.trackUrn ? t('nowPlaying:nowPlaying.loading') : t('nowPlaying:nowPlaying.nothingPlaying')),
          }),
          state.nowPlaying?.artist
            ? h(MarqueeText, {
                variant: 'md',
                tone: 'muted',
                style: { width: '100%', textAlign: 'center' },
                children: state.nowPlaying.artist,
              })
            : null,
          state.nowPlaying?.album
            ? h(MarqueeText, {
                variant: 'sm',
                tone: 'muted',
                style: { width: '100%', textAlign: 'center' },
                children: state.nowPlaying.album,
              })
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
        /* transport */
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
                testID: 'fullcover-lyrics-toggle',
                accessibilityLabel: isLyricsVisible ? t('nowPlaying:nowPlaying.hideLyrics') : t('nowPlaying:nowPlaying.showLyrics'),
                variant: isLyricsVisible ? 'primary' : 'ghost',
                onPress: toggleLyrics,
              })
            : null,
        ),
      ),
      /* optional panel (lyrics) */
      PanelComponent
        ? h(
            'div',
            {
              'data-testid': 'fullcover-lyrics-column',
              style: {
                flex: isLyricsVisible ? 1.2 : 0,
                display: 'flex',
                height: '80vh',
                maxHeight: '80vh',
                minWidth: isLyricsVisible ? 340 : 0,
                maxWidth: isLyricsVisible ? 600 : 0,
                minHeight: 0,
                borderRadius: tokens.radius.lg,
                background: 'rgba(0, 0, 0, 0.35)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: isLyricsVisible ? '1px solid rgba(255, 255, 255, 0.08)' : '0px solid transparent',
                overflow: 'hidden',
                opacity: isLyricsVisible ? 1 : 0,
                transform: isLyricsVisible ? 'translateX(0) scale(1)' : 'translateX(60px) scale(0.95)',
                pointerEvents: isLyricsVisible ? 'auto' : 'none',
                transition:
                  'max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.5s cubic-bezier(0.16, 1, 0.3, 1), flex 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
              },
            },
            h(PanelComponent, { ctx }),
          )
        : null,
    ),
  )
}
