/**
 * Shared layout atoms for the settings sub-pages: section headers, the
 * grouped card, and the title/description/control row. Extracted from the
 * single-file days so the About body (the desktop twin's AboutSection) and
 * the category pages compose the same chrome.
 */

import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export function renderSectionHeader(title: string, subtitle?: string): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
    h(Text, { variant: 'sm', tone: 'accent', children: title }),
    subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
  )
}

export function renderCard(children: ReactNode[]): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        gap: tokens.space[3],
      },
    },
    ...children,
  )
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
