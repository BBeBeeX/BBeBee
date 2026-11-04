import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ListProps } from '@BBeBee/ui-core'
import { common, nativePrimitives } from '../primitives.js'

/**
 * A virtualised list.
 *
 * FlashList recycles row views instead of mounting one per item, which is what
 * a 100k-track library needs on a phone. Its twin on desktop windows the same
 * way with `@tanstack/react-virtual` (docs/11 §4.11).
 *
 * ⚠️ `estimatedItemSize` is deliberately not forwarded. FlashList v2 measures
 * rows itself and dropped the prop; passing it would look like a hint and be
 * ignored. The prop stays in the shared contract because the desktop
 * virtualiser genuinely needs it, and a prop one kit ignores is cheaper than
 * two contracts.
 */
export function List<T>(props: ListProps<T>): ReactElement {
  const native = nativePrimitives()
  const customStyle = (props as { contentContainerStyle?: unknown }).contentContainerStyle
  return h(native.FlashList as never, {
    ...common(props),
    data: props.items,
    keyExtractor: props.keyExtractor,
    renderItem: ({ item, index }: { item: T; index: number }) => props.renderItem(item, index),
    onEndReached: props.onEndReached,
    onEndReachedThreshold: 0.5,
    ListEmptyComponent: props.empty as ReactNode,
    contentContainerStyle: [
      { flexGrow: 1, paddingBottom: 160 },
      ...(Array.isArray(customStyle) ? customStyle : customStyle ? [customStyle] : []),
    ],
  })
}
