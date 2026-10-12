import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { tablerIcon } from '../icons/index.js'

export interface DetailPlayButtonProps {
  onPress: () => void
  disabled?: boolean
  /** Circle diameter (default 56 — the hero's big button; the sticky bar uses 48). */
  size?: number
  iconSize?: number
  testID?: string
  ariaLabel?: string
  /**
   * Visually-hidden text alongside the aria-label, for callers whose tests
   * query by text (the album page's "Play album").
   */
  srText?: string
  /**
   * Optional Cordis context. When provided, the fallback aria-label is
   * translated via `useI18n`; without it the built-in English copy renders.
   */
  ctx?: Context
}

/** The circular primary play button every detail page's action bar rides on. */
export function DetailPlayButton(props: DetailPlayButtonProps): ReactElement {
  // Deliberately hook-free: the kit's tree() tests invoke components as plain
  // functions. Locale changes reach this component because its
  // useI18n-subscribed ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
  return h(
    'button',
    {
      type: 'button',
      'data-testid': props.testID,
      'aria-label': props.ariaLabel ?? t('app:common.detailPlayButton.play', 'Play'),
      onClick: props.onPress,
      disabled: props.disabled,
      style: {
        width: props.size ?? 56,
        height: props.size ?? 56,
        borderRadius: '50%',
        background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
        border: 'none',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--glow-brand-md, 0 8px 16px rgba(0, 0, 0, 0.3))',
        color: 'var(--bb-accent-on, #ffffff)',
        paddingLeft: 2,
        position: 'relative',
      },
    },
    tablerIcon('play', { size: props.iconSize ?? 28, color: 'currentColor' }),
    props.srText
      ? h(
          'span',
          {
            style: {
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            },
          },
          props.srText,
        )
      : null,
  )
}
