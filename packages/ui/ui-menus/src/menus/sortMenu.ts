import type { MenuItemSpec } from '@BBeBee/ui-core'

export interface SortOption {
  id: string
  label: string
}

export interface SortOrder {
  value: 'asc' | 'desc'
  onChange: (value: 'asc' | 'desc') => void
}

/**
 * The sort dropdown every detail table offers: one entry per key with a check
 * on the active one, a hairline, then ascending/descending. Written once here
 * so four screens cannot grow four dialects of the same menu; pass no `order`
 * for a menu that only picks a key.
 */
export function sortMenuItems(
  options: readonly SortOption[],
  activeId: string,
  onPick: (id: string) => void,
  order?: SortOrder,
): MenuItemSpec[] {
  const items: MenuItemSpec[] = options.map((option, index) => ({
    id: `sort-${option.id}`,
    label: option.label,
    icon: activeId === option.id ? 'check' : undefined,
    onSelect: () => onPick(option.id),
    divider: order !== undefined && index === options.length - 1,
  }))
  if (order) {
    items.push(
      {
        id: 'order-asc',
        label: 'Ascending',
        icon: order.value === 'asc' ? 'check' : undefined,
        onSelect: () => order.onChange('asc'),
      },
      {
        id: 'order-desc',
        label: 'Descending',
        icon: order.value === 'desc' ? 'check' : undefined,
        onSelect: () => order.onChange('desc'),
      },
    )
  }
  return items
}
