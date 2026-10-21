import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ButtonProps, IconButtonProps } from '@BBeBee/ui-core'
import { buttonStyle, common, usePressable } from '../theme.js'
import { tablerIcon } from '../icons/index.js'

export function Button(props: ButtonProps) {
  const { variant = 'primary', disabled = false, loading = false } = props
  const off = disabled || loading
  const [{ hovered, pressed }, pressProps] = usePressable()
  return h(
    'button',
    {
      ...common(props),
      ...pressProps,
      type: 'button',
      disabled: off,
      'aria-busy': loading || undefined,
      onClick: off ? undefined : props.onPress,
      style: buttonStyle(variant, off, hovered, pressed),
    },
    loading ? '…' : (props.children as ReactNode),
  )
}

// The play triangle optically reads left-of-center inside a round button; the
// hero and mini-player play buttons compensate by hand, the kit must too.
const PLAY_GLYPHS = new Set(['play', 'play-filled', '▶'])

export function IconButton(props: IconButtonProps): ReactElement {
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  const [{ hovered, pressed }, pressProps] = usePressable()
  const playGlyph = typeof props.icon === 'string' && PLAY_GLYPHS.has(props.icon)
  const renderedIcon = tablerIcon(props.icon, {
    size,
    'data-icon': typeof props.icon === 'string' ? props.icon : undefined,
    style: playGlyph ? { marginLeft: size * 0.08 } : undefined,
  }) as ReactNode

  return h(
    'button',
    {
      ...common(props),
      ...pressProps,
      type: 'button',
      disabled,
      onClick: disabled ? undefined : props.onPress,
      style: {
        ...buttonStyle(variant, disabled, hovered, pressed),
        width: tokens.size.touchTarget,
        minHeight: tokens.size.touchTarget,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        borderRadius: tokens.radius.pill,
      },
    },
    renderedIcon,
  )
}
