import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { Button, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { SchemaForm } from './SchemaForm.js'
import { cardSurface } from './layout.js'

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
  const { t } = useI18n(ctx)

  const localizeTitle = (item: SettingsContribution): string => {
    if (item.title?.includes(':')) return t(item.title)
    if (item.id === 'sources.import' || item.title === 'Import Sources') {
      return t('settings:sources.importSources')
    }
    return item.title
  }

  const localizeDescription = (item: SettingsContribution): string | undefined => {
    if (item.description?.includes(':')) return t(item.description)
    if (item.id === 'sources.import' || item.description?.startsWith('Import third-party')) {
      return t('settings:sources.importThirdPartySourceScripts')
    }
    return item.description
  }

  const localizeAction = (item: SettingsContribution): string => {
    if (item.actionText?.includes(':')) return t(item.actionText)
    if (item.id === 'sources.import' || item.actionText === 'Import sources') {
      return t('settings:sources.importSources')
    }
    return item.actionText ?? t('settings:contributionBlock.open')
  }

  if (contribution.display === 'card') {
    const CardView = ctx.ui?.viewFor?.(contribution.id) as
      | React.ComponentType<{ ctx: Context }>
      | undefined
    if (CardView) return h(CardView, { key: contribution.id, ctx })
    return h(
      native.View as never,
      { key: contribution.id, 'data-testid': `contribution-unavailable-${contribution.id}`, style: cardSurface() },
      h(Text, { variant: 'md', children: localizeTitle(contribution) }),
      contribution.description
        ? h(Text, { variant: 'xs', tone: 'muted', children: localizeDescription(contribution) })
        : null,
      h(Text, { variant: 'xs', tone: 'muted', children: t('settings:contributionBlock.notAvailableOnPlatform') }),
    )
  }

  if (contribution.fields && contribution.fields.length > 0) {
    return h(
      native.View as never,
      { key: contribution.id, style: cardSurface() },
      h(SchemaForm, { ctx, contribution }),
    )
  }

  return h(
    native.View as never,
    {
      key: contribution.id,
      style: {
        ...cardSurface(),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
    },
    h(
      native.View as never,
      { style: { flex: 1 } },
      h(Text, { variant: 'md', children: localizeTitle(contribution) }),
      contribution.description
        ? h(Text, { variant: 'xs', tone: 'muted', children: localizeDescription(contribution) })
        : null,
    ),
    h(Button, {
      variant: 'secondary',
      children: localizeAction(contribution),
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
