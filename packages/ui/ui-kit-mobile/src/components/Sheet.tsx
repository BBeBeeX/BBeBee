import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { SheetProps } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { GlassSurface, type LiquidGlassOptions } from './GlassSurface.js'

export function Sheet(props: SheetProps & { liquid?: LiquidGlassOptions }): ReactElement | null {
  if (!props.open) return null
  const native = nativePrimitives()
  const p = c()
  // Opt-in glass surface: when `liquid` is passed, the glass pipeline
  // (liquid > blur > translucent) is the sheet's surface and the inner
  // pressable goes transparent so it cannot paint over it; otherwise the
  // sheet keeps its solid raised surface. Only callers that ask for glass
  // change — the queue sheet and every other Sheet keep today's look.
  const inner = h(
    native.Pressable as never,
    {
      // A press inside must not close it; only the backdrop does.
      onPress: () => {},
      style: {
        padding: tokens.space[5],
        borderTopLeftRadius: tokens.radius.lg,
        borderTopRightRadius: tokens.radius.lg,
        backgroundColor: props.liquid ? 'transparent' : p.bg.raised,
      },
    },
    props.title ? h(Text, { variant: 'lg', children: props.title }) : null,
    props.children as ReactNode,
  )
  return h(
    native.Modal as never,
    {
      ...common(props),
      visible: props.open,
      transparent: true,
      animationType: 'slide',
      // The Android back button must close it, or the sheet is a trap.
      onRequestClose: props.onClose,
    },
    h(
      native.Pressable as never,
      {
        onPress: props.onClose,
        style: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
      },
      props.liquid
        ? h(
            GlassSurface,
            {
              liquid: props.liquid,
              intensity: 85,
              borderRadius: tokens.radius.lg,
              style: {
                borderTopLeftRadius: tokens.radius.lg,
                borderTopRightRadius: tokens.radius.lg,
              },
            },
            inner,
          )
        : inner,
    ),
  )
}
