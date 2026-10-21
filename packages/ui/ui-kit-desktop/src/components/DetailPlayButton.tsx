import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { tablerIcon } from '../icons/index.js'
import { usePressable } from '../theme.js'

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
  // Locale changes reach this component because its useI18n-subscribed
  // ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
  const [{ hovered, pressed }, pressProps] = usePressable()
  const disabled = Boolean(props.disabled)

  return h(
    'button',
    {
      ...pressProps,
      type: 'button',
      'data-testid': props.testID,
      'aria-label': props.ariaLabel ?? t('app:common.detailPlayButton.play', 'Play'),
      onClick: disabled ? undefined : props.onPress,
      disabled,
      style: {
        width: props.size ?? 56,
        height: props.size ?? 56,
        borderRadius: '50%',
        background: hovered && !disabled
          ? 'var(--button-primary-hover, var(--gradient-ice))'
          : 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: pressed && !disabled ? 'scale(0.95)' : hovered && !disabled ? 'scale(1.05)' : 'scale(1)',
        boxShadow: pressed && !disabled
          ? 'inset 0 2px 4px rgba(0, 0, 0, 0.35)'
          : hovered && !disabled
            ? 'var(--glow-brand-lg, 0 0 24px rgba(117,152,255,0.3)), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255, 255, 255, 0.3))'
            : 'var(--glow-brand-md, 0 8px 16px rgba(0, 0, 0, 0.3)), var(--bevel-chamfer-top, inset 0 1px 0 rgba(255, 255, 255, 0.2))',
        color: 'var(--bb-accent-on, #ffffff)',
        paddingLeft: 2,
        position: 'relative',
        transition: `transform ${tokens.duration.fast}ms ${tokens.easing.tactile}, box-shadow ${tokens.duration.fast}ms ${tokens.easing.tactile}, background ${tokens.duration.fast}ms ease`,
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
