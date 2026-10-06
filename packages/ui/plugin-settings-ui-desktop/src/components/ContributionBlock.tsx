import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution, UiService } from '@BBeBee/protocol'
import { Button } from '@BBeBee/ui-kit-desktop'
import { SchemaForm } from './SchemaForm.js'
import { SettingsRow } from './SettingsRow.js'

export interface ContributionBlockProps {
  ctx: Context
  contribution: SettingsContribution
  onNavigate?: (route: string) => void
}

/**
 * Renders one settings contribution. The decision is the descriptor's, not
 * the view's:
 * - `card` embeds the view registered for its id, or states plainly that
 *   this target has no view for it (docs/08 §3 — a missing view is a normal
 *   state, not a hole).
 * - a contribution with `fields` renders as a generic schema form.
 * - `link` (and `auto` without a view or fields) renders a row with a
 *   navigation/action button.
 */
export function ContributionBlock({ ctx, contribution, onNavigate }: ContributionBlockProps): ReactElement {
  if (contribution.display === 'card') {
    const CardView = ctx.ui?.viewFor?.(contribution.id) as
      | React.ComponentType<{ ctx: Context }>
      | undefined
    if (CardView) return h(CardView, { key: contribution.id, ctx })
    return h(
      'div',
      { key: contribution.id, 'data-testid': `contribution-unavailable-${contribution.id}` },
      h(SettingsRow, {
        title: contribution.title,
        description: contribution.description,
        borderBottom: false,
        action: h(
          'span',
          {
            style: {
              fontSize: 12,
              color: '#8E8E93',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.04)',
            },
          },
          '在此平台不可用',
        ),
      }),
    )
  }

  if (contribution.fields && contribution.fields.length > 0) {
    return h(SchemaForm, { key: contribution.id, ctx, contribution })
  }

  return h(SettingsRow, {
    key: contribution.id,
    title: contribution.title,
    description: contribution.description,
    borderBottom: false,
    action: h(Button, {
      children: contribution.actionText ?? '打开',
      onPress: () => {
        if (contribution.action) void contribution.action()
        else (onNavigate ?? ((id: string) => serviceNavigate(ctx, id)))(contribution.id)
      },
    }),
  })
}

function serviceNavigate(ctx: Context, id: string): void {
  ;(ctx as { ui?: UiService })?.ui?.navigate?.(id)
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
