import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { Button, Text } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { SchemaForm } from './SchemaForm.js'

export interface ContributionBlockProps {
  ctx: Context
  contribution: SettingsContribution
  onNavigate?: (route: string) => void
}

/**
 * Renders one settings contribution on React Native. Same decision table as
 * the desktop shell: card embeds the registered view or states the platform
 * gap, `fields` render as a generic form, everything else is a link row.
 */
export function ContributionBlock({ ctx, contribution, onNavigate }: ContributionBlockProps): ReactElement {
  const native = nativePrimitives()

  if (contribution.display === 'card') {
    const CardView = ctx.ui?.viewFor?.(contribution.id) as
      | React.ComponentType<{ ctx: Context }>
      | undefined
    if (CardView) return h(CardView, { key: contribution.id, ctx })
    return h(
      native.View as never,
      { key: contribution.id, 'data-testid': `contribution-unavailable-${contribution.id}` },
      h(Text, { variant: 'md', children: contribution.title }),
      contribution.description
        ? h(Text, { variant: 'xs', tone: 'muted', children: contribution.description })
        : null,
      h(Text, { variant: 'xs', tone: 'muted', children: '在此平台不可用' }),
    )
  }

  if (contribution.fields && contribution.fields.length > 0) {
    return h(SchemaForm, { key: contribution.id, ctx, contribution })
  }

  return h(
    native.View as never,
    {
      key: contribution.id,
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
      h(Text, { variant: 'md', children: contribution.title }),
      contribution.description
        ? h(Text, { variant: 'xs', tone: 'muted', children: contribution.description })
        : null,
    ),
    h(Button, {
      variant: 'secondary',
      children: contribution.actionText ?? '打开',
      onPress: () => {
        if (contribution.action) void contribution.action()
        else onNavigate?.(contribution.id)
      },
    }),
  )
}

/**
 * Groups contributions by section, merging the legacy 'audio' alias into
 * 'playback'. Order inside a section follows the contribution `order`.
 */
export function groupBySection(
  contributions: readonly SettingsContribution[],
): Map<string, SettingsContribution[]> {
  const map = new Map<string, SettingsContribution[]>()
  for (const c of contributions) {
    const section = c.section === 'audio' ? 'playback' : c.section
    const list = map.get(section)
    if (list) list.push(c)
    else map.set(section, [c])
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  }
  return map
}
