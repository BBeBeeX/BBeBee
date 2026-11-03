import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { TextFieldProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { GlassSurface, type LiquidGlassOptions } from './GlassSurface.js'

/**
 * A text input.
 *
 * Controlled, like the desktop one. React Native's `TextInput` is happy to be
 * uncontrolled, and a kit where one platform keeps its own state and the other
 * does not is exactly the divergence the parity gate exists to catch — it only
 * shows up when something resets the field, which the import screen does on
 * every successful paste.
 */
export function TextField(props: TextFieldProps & { liquid?: LiquidGlassOptions }): ReactElement {
  const native = nativePrimitives()
  const scheme = c()
  const invalid = props.error !== undefined
  const input = h(native.TextInput as never, {
    ...common(props),
    value: props.value,
    onChangeText: props.onChange,
    placeholder: props.placeholder,
    placeholderTextColor: scheme.text.secondary,
    editable: props.disabled !== true,
    multiline: props.multiline ?? false,
    numberOfLines: props.multiline ? (props.rows ?? 8) : 1,
    secureTextEntry: props.secure ?? false,
    // Off by default and deliberately: a rule and a URL are both case- and
    // spelling-sensitive, and autocorrect silently rewriting one produces a
    // source that fails for a reason nothing on screen explains.
    autoCorrect: props.autoCorrect ?? false,
    autoCapitalize: 'none',
    style: {
      borderWidth: 1,
      // Filled rather than outlined: on a dark canvas an outlined box reads as
      // a disabled field, and the fill is what says "type here".
      borderColor: invalid ? scheme.state.error : 'transparent',
      borderRadius: tokens.radius.sm,
      // With glass the input itself goes transparent so the glass behind
      // it is the fill; without it the overlay fill stays.
      backgroundColor: props.liquid ? 'transparent' : scheme.bg.overlay,
      color: scheme.text.primary,
      paddingHorizontal: tokens.space[3],
      paddingVertical: tokens.space[2],
      fontSize: tokens.font.size.md,
      // Monospace for a rule and a pasted document: alignment is how an author
      // spots an unbalanced brace.
      fontFamily: props.multiline ? tokens.font.family.mono : undefined,
      // A multiline field must grow; a single-line one must stay tappable.
      minHeight: props.multiline
        ? tokens.font.size.md * 1.5 * (props.rows ?? 8)
        : tokens.size.touchTarget,
      textAlignVertical: props.multiline ? 'top' : 'center',
    },
  })

  // Opt-in glass: only callers that pass `liquid` change — a standalone
  // search box, not the form fields inside sheets and settings screens.
  // The glass wraps just the input; the error line below it stays outside
  // so it never sits on glass.
  const field = props.liquid
    ? h(
        GlassSurface,
        {
          liquid: props.liquid,
          intensity: 85,
          borderRadius: tokens.radius.sm,
          style: { borderRadius: tokens.radius.sm },
        },
        input,
      )
    : input

  if (!invalid) return field
  return h(
    native.View as never,
    { style: { gap: tokens.space[1] } },
    field,
    h(Text, { variant: 'sm', tone: 'error' }, props.error),
  )
}
