/**
 * Shared layout atoms for the settings sub-pages: section headers, the
 * grouped card, and the title/description/control row. Extracted from the
 * single-file days so the About body (the desktop twin's AboutSection) and
 * the category pages compose the same chrome.
 */

import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { c, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export function renderSectionHeader(title: string, subtitle?: string): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { marginTop: tokens.space[2], marginBottom: tokens.space[1] } },
    h(Text, { variant: 'sm', tone: 'accent', children: title }),
    subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
  )
}

/**
 * The one card surface every settings block sits on — built-in and
 * contributed alike. A function, not a constant: the palette is theme-driven
 * and changes at runtime, so the surface must resolve per render.
 */
export function cardSurface() {
  return {
    backgroundColor: c().bg.raised,
    borderRadius: tokens.radius.md,
    padding: tokens.space[3],
    gap: tokens.space[3],
  }
}

export function renderCard(children: ReactNode[]): ReactElement {
  const native = nativePrimitives()
  return h(native.View as never, { style: cardSurface() }, ...children)
}

export function renderRow(title: string, description: string | undefined, control: ReactNode): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.space[3],
      },
    },
    h(
      native.View as never,
      { style: { flex: 1 } },
      h(Text, { variant: 'md', children: title }),
      description ? h(Text, { variant: 'xs', tone: 'muted', children: description }) : null,
    ),
    control,
  )
}
