import { createElement as h, type ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextFieldProps } from '@BBeBee/ui-core'
import { common } from '../theme.js'
import { Text } from './Text.js'

export function TextField(props: TextFieldProps): ReactElement {
  const invalid = props.error !== undefined
  const style = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
    borderRadius: tokens.radius.sm,
    border: `1px solid ${invalid ? 'var(--error, #EF4444)' : 'var(--input-border, var(--border-default, rgba(145,176,255,0.14)))'}`,
    background: 'var(--input-bg, var(--surface-1, #080D1A))',
    boxShadow: 'var(--shadow-sunken, inset 0 1px 2px rgba(0, 0, 0, 0.25))',
    color: 'var(--text-primary, #FFFFFF)',
    fontFamily: props.multiline ? tokens.font.family.mono : tokens.font.family.ui,
    fontSize: tokens.font.size.md,
    resize: 'vertical' as const,
    minHeight: props.multiline ? undefined : tokens.size.touchTarget,
    outline: 'none',
    transition: `border-color ${tokens.duration.fast}ms ease, box-shadow ${tokens.duration.fast}ms ${tokens.easing.tactile}`,
  }

  const onChange = (e: { target: { value: string } }) => props.onChange(e.target.value)
  const field = props.multiline
    ? h('textarea', {
        ...common(props),
        value: props.value,
        rows: props.rows ?? 8,
        placeholder: props.placeholder,
        disabled: props.disabled,
        spellCheck: props.autoCorrect ?? false,
        onChange,
        style,
      })
    : h('input', {
        ...common(props),
        type: props.secure ? 'password' : 'text',
        value: props.value,
        placeholder: props.placeholder,
        disabled: props.disabled,
        spellCheck: props.autoCorrect ?? false,
        onChange,
        style,
      })

  if (!invalid) return field
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
    field,
    h(Text, { variant: 'sm', tone: 'error' }, props.error),
  )
}
