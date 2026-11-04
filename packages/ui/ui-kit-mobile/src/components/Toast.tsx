import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ToastProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { IconButton } from './Button.js'
import { GlassSurface, type LiquidGlassOptions } from './GlassSurface.js'

export function Toast(props: ToastProps & { liquid?: LiquidGlassOptions }): ReactElement {
  const native = nativePrimitives()
  const p = c()
  // Glass only for the neutral info tone: error/warn/ok keep their status
  // colours, which are the warning itself.
  const glass = props.liquid !== undefined && (props.tone === undefined || props.tone === 'info')
  const rowStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[3],
    paddingVertical: tokens.space[2],
    paddingHorizontal: tokens.space[4],
    borderRadius: tokens.radius.pill,
  }
  const content = [
    h(Text, {
      tone: props.tone && props.tone !== 'info' ? 'default' : 'default',
      children: props.message,
    }),
    props.action as ReactNode,
    props.onDismiss
      ? h(IconButton, { icon: 'x', accessibilityLabel: 'Dismiss', onPress: props.onDismiss })
      : null,

  ]
  if (glass) {
    // The live region and alert role stay on a transparent outer view:
    // GlassSurface does not forward them, and the announcement must not
    // be lost when the surface goes glass.
    return h(
      native.View as never,
      {
        ...common(props),
        // Announced without stealing focus, like the desktop twin.
        accessibilityLiveRegion: 'polite',
        accessibilityRole: 'alert',
      },
      h(
        GlassSurface,
        {
          liquid: props.liquid,
          intensity: 85,
          borderRadius: tokens.radius.pill,
          style: rowStyle,
        },
        ...content,
      ),
    )
  }
  const backgroundColor =
    props.tone === 'error'
      ? p.state.error
      : props.tone === 'warn'
        ? p.state.warn
        : props.tone === 'ok'
          ? p.state.ok
          : p.bg.overlay
  return h(
    native.View as never,
    {
      ...common(props),
      // Announced without stealing focus, like the desktop twin.
      accessibilityLiveRegion: 'polite',
      accessibilityRole: 'alert',
      style: {
        ...rowStyle,
        backgroundColor,
      },
    },
    ...content,
  )
}
