import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import { nativePrimitives, usePalette } from '@BBeBee/ui-kit-mobile'

export interface ChipProps {
  label: string
  selected: boolean
  onPress: () => void
  testID?: string
  accessibilityLabel?: string
  /** Optional colour dot in front of the label — a theme variant's brand colour. */
  swatch?: string
}

/**
 * A selectable chip.
 *
 * The kit has buttons but no segmented/chip control, and every selector on
 * this card (appearance mode, category tabs, theme variants, matugen
 * schemes) is the same shape: a pill that is filled when selected and
 * outlined when not. Selected states use the palette's accent with
 * `accent.muted` as the fill — text stays `text.primary` in both states, so
 * contrast never depends on the theme author's choices.
 */
export function Chip(props: ChipProps): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  return h(
    native.Pressable as never,
    {
      testID: props.testID,
      accessibilityLabel: props.accessibilityLabel ?? props.label,
      accessibilityRole: 'button',
      accessibilityState: { selected: props.selected },
      onPress: props.onPress,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[2],
        minHeight: tokens.size.touchTarget,
        paddingHorizontal: tokens.space[4],
        borderRadius: tokens.radius.pill,
        borderWidth: 1,
        borderColor: props.selected ? p.accent.base : p.border.subtle,
        backgroundColor: props.selected ? p.accent.muted : 'transparent',
        maxWidth: '100%',
      },
    },
    props.swatch
      ? h(native.View as never, {
          style: {
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: props.swatch,
          },
        })
      : null,
    h(
      native.Text as never,
      {
        style: {
          color: p.text.primary,
          fontSize: tokens.font.size.sm,
          fontWeight: props.selected ? tokens.font.weight.medium : tokens.font.weight.regular,
        },
      },
      props.label as ReactNode,
    ),
  )
}
