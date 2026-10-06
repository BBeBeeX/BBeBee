import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tintRgba } from './coverTheme.js'

export interface StickyDetailBarProps {
  /** The page title, shown once the bar has taken over for the hero. */
  title: string
  /** The page's primary action, absorbed into the bar when it docks. */
  playButton?: ReactNode
  /** 0 — bar fully above the viewport, 1 — fully slid in. Drives the slide and the title fade. */
  progress: number
  /**
   * The dock moment: the bar's edge has scrolled past half the header play
   * button, so the bar's own play button is absorbed in with a scale-in.
   */
  docked?: boolean
  /** The cover's dominant colour; the bar washes towards it as it lands. */
  tint?: string
  /** Right-aligned extras (shuffle, heart, …) next to the title. */
  trailing?: ReactNode
  /** Bar height in px; the slide travel and the negative flow margin derive from it. */
  barHeight?: number
}

/**
 * The bar a detail page collapses into.
 *
 * In flow it costs nothing — `marginBottom: -height` overlays it on the top
 * of the scroll content, where a translated-away bar hides nothing. It slides
 * down from above the viewport (`translateY`) as the header's play button
 * approaches, and when its edge has covered half the button, `docked` flips:
 * the bar's own play button scales in — the absorb action — and the title
 * has finished fading in. `pointerEvents` follows the slide so the ghost of
 * the bar never eats a click meant for the hero.
 */
export function StickyDetailBar(props: StickyDetailBarProps): ReactElement {
  const barHeight = props.barHeight ?? 64
  const p = Math.max(0, Math.min(1, props.progress))
  const docked = props.docked ?? p >= 1
  const titleOpacity = p
  const bg = props.tint
    ? `linear-gradient(${tintRgba(props.tint, 0.5)}, ${tintRgba(props.tint, 0.5)}), var(--bg-primary, #080A10)`
    : 'var(--bg-primary, #080A10)'
  return h(
    'div',
    {
      'data-testid': 'sticky-detail-bar',
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: barHeight,
        marginBottom: -barHeight,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 32px',
        background: bg,
        opacity: p,
        transform: `translateY(${-barHeight * (1 - p)}px)`,
        pointerEvents: p > 0.5 ? 'auto' : 'none',
        borderBottom: docked ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent',
      },
    },
    props.playButton
      ? h(
          'div',
          {
            style: {
              flexShrink: 0,
              display: 'flex',
              transform: docked ? 'scale(1)' : 'scale(0.4)',
              opacity: docked ? 1 : 0,
              transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease',
            },
          },
          props.playButton,
        )
      : null,
    h(
      'span',
      {
        style: {
          flex: 1,
          minWidth: 0,
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--bb-text-primary, #FFFFFF)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: titleOpacity,
        },
      },
      props.title,
    ),
    props.trailing ?? null,
  )
}
