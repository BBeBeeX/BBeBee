import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { c, common, nativePrimitives } from '../primitives.js'
import { tablerIcon } from '../icons/tabler.js'
import { Text } from './Text.js'
import { Sheet } from './Sheet.js'
import type { LiquidGlassOptions } from './GlassSurface.js'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
}

export interface SelectProps<T extends string = string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  accessibilityLabel?: string
  testID?: string
  /**
   * Opt-in glass for the dropdown list surface only, threaded straight
   * into the internal Sheet. The closed field keeps its bordered fill —
   * a glass closed field would read as a button, not a field.
   */
  liquid?: LiquidGlassOptions
}

/**
 * A dropdown select — the mobile twin of `ui-kit-desktop`'s `Select`. The
 * closed control is a bordered field showing the selected label; opening it
 * presents the options in a bottom sheet (the platform's picker pattern, the
 * same one `ContextMenu` uses), with the current choice marked.
 */
export function Select<T extends string = string>(props: SelectProps<T>): ReactElement {
  const native = nativePrimitives()
  const p = c()
  const [open, setOpen] = useState(false)
  const selected = props.options.find((option) => option.value === props.value)

  return h(
    native.View as never,
    null,
    h(
      native.Pressable as never,
      {
        ...common(props),
        accessibilityRole: 'button',
        accessibilityLabel: props.accessibilityLabel,
        accessibilityState: { expanded: open },
        onPress: () => setOpen(true),
        style: {
          minHeight: tokens.size.touchTarget - 8,
          paddingHorizontal: tokens.space[3],
          borderRadius: tokens.radius.sm,
          borderWidth: 1,
          borderColor: p.border.subtle,
          backgroundColor: p.bg.overlay,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[2],
          minWidth: 132,
        },
      },
      h(Text, {
        variant: 'sm',
        numberOfLines: 1,
        children: selected?.label ?? props.value,
      }),
      h(Text, { variant: 'sm', tone: 'muted', children: '▾' }),
    ),
    h(
      Sheet,
      {
        open,
        onClose: () => setOpen(false),
        title: props.accessibilityLabel,
        liquid: props.liquid,
      },
      h(
        native.View as never,
        { style: { gap: tokens.space[1], paddingTop: tokens.space[2] } },
        ...props.options.map((option) => {
          const isSelected = option.value === props.value
          return h(
            native.Pressable as never,
            {
              key: option.value,
              accessibilityRole: 'menuitem',
              accessibilityLabel: option.label,
              accessibilityState: { selected: isSelected },
              testID: props.testID ? `${props.testID}-option-${option.value}` : undefined,
              onPress: () => {
                setOpen(false)
                props.onChange(option.value)
              },
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.space[3],
                minHeight: tokens.size.touchTarget,
                paddingHorizontal: tokens.space[2],
                borderRadius: tokens.radius.sm,
                backgroundColor: isSelected ? p.accent.muted : 'transparent',
              },
            },
            h(Text, {
              variant: 'md',
              style: { fontWeight: isSelected ? '700' : '400' },
              children: option.label,
            }),
            isSelected
              ? (tablerIcon('check', { size: 18, color: p.accent.base }) ??
                h(Text, { style: { color: p.accent.base, fontSize: 16 } }, '✓'))
              : null,
          )
        }),
      ),
    ),
  )
}
