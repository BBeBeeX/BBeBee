/**
 * The registry views' shared empty state: a ghost tabler icon inside a softly
 * glowing ring, a title, and a one-line description — the "illustration" is
 * pure CSS/typography (no images, no hand-written SVG), matching the kit's
 * EmptyState family while letting the registry own its spacing and testids.
 *
 * Full-surface states (empty tabs, no search hits) use the default size; the
 * task drawer's in-panel emptiness uses `compact`.
 */

import { createElement as h, type ReactElement } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface RegistryEmptyStateProps {
  /** A name from the kit's tabler icon registry (`heart`, `search`, …). */
  icon: string
  title: string
  description?: string
  /** Compact rhythm for emptiness inside a panel (drawer, diagnostics group). */
  compact?: boolean
}

export function RegistryEmptyState({
  icon,
  title,
  description,
  compact = false,
}: RegistryEmptyStateProps): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: compact ? 4 : 8,
        padding: compact ? '16px 8px' : '48px 16px',
        textAlign: 'center',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: compact ? 40 : 56,
          height: compact ? 40 : 56,
          borderRadius: 999,
          color: 'var(--text-tertiary, #8B95B0)',
          background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          boxShadow: 'var(--glow-xs, 0 0 8px rgba(95, 135, 255, 0.12))',
          marginBottom: 4,
        },
      },
      tablerIcon(icon, { size: compact ? 20 : 26 }),
    ),
    h(
      'div',
      {
        style: {
          fontSize: compact ? 13 : 14,
          fontWeight: 600,
          color: 'var(--text-secondary, #C5CAD8)',
        },
      },
      title,
    ),
    description
      ? h(
          'div',
          {
            style: {
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text-tertiary, #8B95B0)',
              maxWidth: 420,
            },
          },
          description,
        )
      : null,
  )
}
