/**
 * Cinematic layout — 16:9 minimal anime / music video (AMV) aesthetic.
 *
 * Redesigned to match the reference style (映画歌词):
 * - Large blurred cover backdrop (opacity 0.34, blur 3.5px, scale 2, centered)
 * - Left section (~46%): larger album artwork (up to 460px) with crisp white border &
 *   pronounced double-layer bottom-right shadow (12px 16px 5px + 20px 28px 56px)
 * - Right section: cursive/handwriting title, muted artist, cinematic subtitle-style
 *   synchronized lyrics (`CinematicLyricsTemplate` from the desktop kit —
 *   scrollable, click-to-seek), settings-driven audio visualizer + progress bar below
 *   lyrics (the visualizer renders the style & color theme selected in settings)
 * - Title is not higher than cover top; visualizer & progress bar are not lower than cover bottom
 * - Timestamps are larger with text shadow
 * - No playback control buttons — pure cinematic immersion
 */
import { createElement as h, type ReactElement } from 'react'
import { formatDuration } from '@BBeBee/toolkit'
import { CinematicLyricsTemplate, CURSIVE_FONT, Slider } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from '../components/NowPlayingBar.js'
import type { NowPlayingLayoutProps } from './index.js'

export function CinematicLayout(props: NowPlayingLayoutProps): ReactElement {
  const { ctx, state, displayPosition, duration, can, onSeekChange, onSeekCommit, VisualizerComponent } = props
  const isPlaying = state.status === 'playing'

  // Actual track title and artist from real-time transport state
  const trackTitle = state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'No Surprises')
  const trackArtist = state.nowPlaying?.artist ?? (state.trackUrn ? '—' : 'Radiohead')

  return h(
    'div',
    {
      'data-testid': 'layout-cinematic',
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#0D1118',
        color: '#FFFFFF',
        fontFamily: tokens.font.family,
        boxSizing: 'border-box',
        padding: '24px 48px',
      },
    },

    /* ── Layer 1: Large Cover Backdrop (opacity: 0.34, blur: 3.5px, scale 2, centered) ── */
    h(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.34,
            filter: 'blur(3.5px) saturate(1.2) brightness(0.85)',
            transform: 'scale(2)',
          },
        },
        h(CachedArtwork, {
          ctx,
          artwork: state.nowPlaying?.artwork,
          seed: state.trackUrn,
          size: 900,
          radius: 0,
        }),
      ),
    ),

    /* ── Layer 2: Main 16:9 Framed Stage ── */
    h(
      'div',
      {
        style: {
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 1240,
          aspectRatio: '16 / 9',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
          padding: '16px 32px',
        },
      },

      /* ── Two Column Area: Left Artwork + Right Info/Lyrics/Progress ── */
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            width: '100%',
            gap: 56,
            minHeight: 0,
          },
        },

        /* LEFT SECTION: Large Album Artwork (~46% width, up to 460px) */
        h(
          'div',
          {
            style: {
              flex: '0 0 46%',
              maxWidth: 480,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          h(
            'div',
            {
              style: {
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                maxHeight: 460,
                maxWidth: 460,
                borderRadius: 2,
                // Crisp white border
                border: '2px solid rgba(255, 255, 255, 0.9)',
                // Double-layer pronounced bottom-right shadow (12px 16px 5px + 20px 28px 56px)
                boxShadow:
                  '12px 16px 5px rgba(0, 0, 0, 0.65), 20px 28px 56px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
              },
            },
            h(CachedArtwork, {
              ctx,
              artwork: state.nowPlaying?.artwork,
              seed: state.trackUrn,
              size: 460,
              radius: 0,
            }),
          ),
        ),

        /* RIGHT SECTION: Bounded to cover height (460px) so title is not above and progress is not below */
        h(
          'div',
          {
            style: {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'center',
              minWidth: 0,
              height: 460,
              maxHeight: 460,
              boxSizing: 'border-box',
              paddingTop: 8,
              paddingBottom: 4,
            },
          },

          /* Track Title (cursive/handwriting font) & Artist — at top */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                maxWidth: '90%',
                flexShrink: 0,
              },
            },
            h(
              'h1',
              {
                style: {
                  margin: 0,
                  fontSize: 46,
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  color: '#FFFFFF',
                  fontFamily: CURSIVE_FONT,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '1.2',
                  maxWidth: '100%',
                },
              },
              trackTitle,
            ),
            h(
              'p',
              {
                style: {
                  margin: 0,
                  fontSize: 15,
                  color: 'rgba(255, 255, 255, 0.6)',
                  letterSpacing: '0.5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              trackArtist,
            ),
          ),

          /* Synced Lyrics — scrollable cinematic template (click-to-seek),
             fills the middle of the column */
          h(CinematicLyricsTemplate, {
            ctx,
            displayPosition,
            trackUrn: state.trackUrn,
            isPlaying,
            canSeek: can.canSeek,
            onSeek: onSeekCommit,
          }),

          /* Waveform + Progress Bar — at bottom of right column, not below cover bottom */
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                width: '100%',
                flexShrink: 0,
              },
            },

            /* 1. Audio visualizer — renders the style & color theme selected
               in settings (the 'wave' style is the cinematic organic wave) */
            h(
              'div',
              { style: { width: '100%', maxWidth: 450 } },
              VisualizerComponent ? h(VisualizerComponent, { ctx }) : null,
            ),

            /* 2. Progress Slider (extended, ~520px max width) */
            h(
              'div',
              { style: { width: '100%', maxWidth: 520 } },
              h(Slider, {
                value: duration ? Math.min(displayPosition, duration) : displayPosition,
                max: duration ?? 0,
                disabled: !can.canSeek,
                accessibilityLabel: 'Seek',
                onChange: onSeekChange,
                onCommit: onSeekCommit,
              }),
            ),

            /* 3. Timestamps below progress bar (larger font + shadow, matching 520px width) */
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  maxWidth: 520,
                  marginTop: 2,
                },
              },
              h(
                'span',
                {
                  'data-testid': 'cinematic-current-time',
                  style: {
                    fontSize: 16,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 1px 3px rgba(0, 0, 0, 0.9)',
                    minWidth: 46,
                    textAlign: 'left',
                  },
                },
                formatDuration(displayPosition),
              ),
              h(
                'span',
                {
                  'data-testid': 'cinematic-total-duration',
                  style: {
                    fontSize: 16,
                    fontFamily: CURSIVE_FONT,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 1px 3px rgba(0, 0, 0, 0.9)',
                    minWidth: 46,
                    textAlign: 'right',
                  },
                },
                formatDuration(duration),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}
