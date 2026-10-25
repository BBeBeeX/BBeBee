/**
 * The row's toggle switch — the same presentation-only spelling as the
 * settings screen's schema form rows and the registry settings card (this
 * package cannot import a sibling view package, and a switch is a dozen
 * lines of primitives). Adds the one state those lack: `disabled`, for the
 * critical-provider lock — a locked switch keeps its checked track but
 * ignores presses and reads as dimmed.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { nativePrimitives, usePalette } from '@BBeBee/ui-kit-mobile'

export function Switch(props: {
  checked: boolean
  accessibilityLabel: string
  disabled?: boolean
  testID?: string
  onChange: (checked: boolean) => void
}): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  return h(
    native.Pressable as never,
    {
      onPress: () => {
        if (!props.disabled) props.onChange(!props.checked)
      },
      accessibilityRole: 'switch',
      accessibilityLabel: props.accessibilityLabel,
      accessibilityState: { checked: props.checked, disabled: props.disabled === true },
      testID: props.testID,
      style: {
        width: 48,
        height: 26,
        borderRadius: 13,
        backgroundColor: props.checked ? p.accent.base : p.bg.overlay,
        opacity: props.disabled ? 0.5 : 1,
        justifyContent: 'center',
        padding: 2,
      },
    },
    h(native.View as never, {
      style: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: props.checked ? p.accent.on : p.text.secondary,
        transform: [{ translateX: props.checked ? 22 : 0 }],
      },
    }),
  )
}
