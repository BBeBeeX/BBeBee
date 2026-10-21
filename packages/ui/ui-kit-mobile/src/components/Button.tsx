import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ButtonProps, ButtonVariant, IconButtonProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'

function buttonStyle(variant: ButtonVariant, disabled: boolean): Record<string, unknown> {
  const p = c()
  const base = {
    minHeight: tokens.size.touchTarget,
    paddingHorizontal: tokens.space[5],
    // A pill, as on desktop. The shape is the only cue that survives a UI
    // with almost no borders, and the two kits have to agree on it or the
    // same plugin looks like two products (docs/08 §6).
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.5 : 1,
    borderWidth: 1,
    borderColor: 'transparent',
  }
  switch (variant) {
    case 'secondary':
      // Outlined, not filled — a filled secondary beside a filled primary
      // makes two primaries.
      return { ...base, backgroundColor: 'transparent', borderColor: p.border.strong }
    case 'ghost':
      return { ...base, backgroundColor: 'transparent' }
    case 'danger':
      return { ...base, backgroundColor: p.state.error }
    default:
      return {
        ...base,
        backgroundColor: p.accent.base,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
      }
  }
}

function labelColor(variant: ButtonVariant): string {
  const p = c()
  if (variant === 'primary') return p.accent.on
  if (variant === 'danger') return p.bg.sunken
  if (variant === 'ghost') return p.text.secondary
  return p.text.primary
}

export function Button(props: ButtonProps): ReactElement {
  const native = nativePrimitives()
  const { variant = 'primary', disabled = false, loading = false } = props
  // `loading` disables as well: a second tap during a request is the classic
  // double-submit, and on a phone it is easier to do by accident.
  const off = disabled || loading
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      accessibilityState: { disabled: off, busy: loading },
      disabled: off,
      onPress: off ? undefined : props.onPress,
      style: buttonStyle(variant, off),
    },
    loading
      ? h(native.ActivityIndicator as never, { color: labelColor(variant) })
      : h(
          native.Text as never,
          { style: { color: labelColor(variant), fontSize: tokens.font.size.md } },
          props.children as ReactNode,
        ),
  )
}

export function IconButton(props: IconButtonProps): ReactElement {
  const native = nativePrimitives()
  const { variant = 'ghost', disabled = false, size = tokens.size.icon } = props
  return h(
    native.Pressable as never,
    {
      ...common(props),
      accessibilityRole: 'button',
      accessibilityState: { disabled },
      disabled,
      onPress: disabled ? undefined : props.onPress,
      // A square at least as large as the platform's minimum tap target,
      // whatever the icon inside it measures.
      style: {
        ...buttonStyle(variant, disabled),
        width: tokens.size.touchTarget,
        paddingHorizontal: 0,
      },
    },
    h(
      native.Text as never,
      { style: { color: labelColor(variant), fontSize: size } },
      props.icon,
    ),
  )
}
