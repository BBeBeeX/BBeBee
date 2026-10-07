import { createElement as h, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tablerIcon } from '../icons/index.js'

export interface DetailColumnSpec {
  /** The sort key this column toggles (also its identity). */
  key: string
  /** Heading content — text, or an icon beside text (the duration clock). */
  label: ReactNode
  testID?: string
  /** Fixed width in px; takes precedence over `flex` (#, duration columns). */
  width?: number
  /** flex-grow for columns that share the row (title 2, album 1.5, …). */
  flex?: number
  align?: 'left' | 'center' | 'right'
  paddingLeft?: number
  paddingRight?: number
  /** Rendered before the label (the duration column's clock). */
  icon?: ReactNode
  /** A plain div — not clickable, never shows a sort arrow (compact 艺人). */
  plain?: boolean
  /** false removes the column (view-mode dependent columns). */
  visible?: boolean
  /** Keys that count as this column's active sort (defaults to `[key]`). */
  sortKeys?: string[]
  /** Never shrink below content width (the album page's album column). */
  fixed?: boolean
}

export interface DetailTableHeaderProps {
  columns: DetailColumnSpec[]
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onSort?: (key: string) => void
  /** Sticky top offset — the sticky bar's height above (default 64). */
  top?: number
  /** Solid background once the sticky bar has docked (default transparent). */
  solid?: boolean
  testID?: string
  accessibilityLabel?: string
}

const DIVIDER = 'inset 1px 0 0 var(--border-subtle, rgba(255, 255, 255, 0.08))'

/**
 * The detail table's sticky header.
 *
 * Sticky at `top` (the sticky bar's height) so it pins beneath the bar while
 * rows slide under it; solid when the bar has docked so its background
 * matches the plain content colour. By default it shows **no sort arrows** —
 * hovering reveals the hairline column separators (`boxShadow` insets, no
 * layout shift), lights the sorted column's directional arrow, and shows a
 * dimmed hint on every other sortable column.
 */
export function DetailTableHeader(props: DetailTableHeaderProps): ReactElement {
  const [hovered, setHovered] = useState(false)
  const columns = props.columns.filter((column) => column.visible !== false)

  return h(
    'div',
    {
      'data-testid': props.testID,
      'aria-label': props.accessibilityLabel,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '0 32px 8px 32px',
        borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
        color: 'var(--bb-text-secondary, #b3b3b3)',
        fontSize: 13,
        fontWeight: 500,
        flexShrink: 0,
        position: 'sticky',
        top: props.top ?? 64,
        zIndex: 15,
        background: props.solid ? 'var(--bg-primary, #080A10)' : 'transparent',
      },
    },
    columns.map((column, index) => {
      const active =
        props.sortKey !== undefined &&
        (column.sortKeys ?? [column.key]).includes(props.sortKey) &&
        !column.plain
      const indicator =
        column.plain || !hovered
          ? null
          : active
            ? props.sortDirection === 'desc'
              ? tablerIcon('chevron-down', { size: 16, style: { marginLeft: 4 } })
              : tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4 } })
            : tablerIcon('chevron-up', { size: 16, style: { marginLeft: 4, opacity: 0.35 } })

      const style: Record<string, unknown> = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        justifyContent:
          column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
        textAlign: column.align ?? 'left',
        padding: 0,
        paddingLeft: column.paddingLeft,
        paddingRight: column.paddingRight,
        background: 'none',
        border: 'none',
        color: active ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #b3b3b3)',
        cursor: column.plain ? undefined : 'pointer',
        fontSize: 13,
        fontWeight: 500,
        minWidth: 0,
        boxShadow: hovered && index > 0 ? DIVIDER : undefined,
      }
      if (column.width !== undefined) {
        style.width = column.width
        style.flexShrink = 0
      }
      if (column.flex !== undefined) {
        style.flex = column.flex
      }
      if (column.fixed) {
        style.flexShrink = 0
      }

      return h(
        column.plain ? 'div' : 'button',
        {
          key: column.key,
          ...(column.plain
            ? {}
            : {
                type: 'button',
                'data-testid': column.testID,
                onClick: () => props.onSort?.(column.key),
              }),
          style,
        },
        column.icon,
        column.label,
        indicator,
      )
    }),
  )
}
