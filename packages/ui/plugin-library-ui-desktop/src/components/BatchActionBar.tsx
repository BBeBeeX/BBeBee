import { createElement as h, type ReactElement, type MouseEvent as ReactMouseEvent } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface BatchActionBarProps {
  selectedCount: number
  totalCount: number
  allSelected: boolean
  onToggleSelectAll: () => void
  onBatchPlay: () => void
  onBatchAddToPlaylist: (anchor: { x: number; y: number }) => void
  onBatchDelete?: () => void
  onExitBatch: () => void
  deleteLabel?: string
  deleteDisabled?: boolean
}

export function BatchActionBar({
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onBatchPlay,
  onBatchAddToPlaylist,
  onBatchDelete,
  onExitBatch,
  deleteLabel = '删除',
  deleteDisabled = false,
}: BatchActionBarProps): ReactElement {
  const hasSelection = selectedCount > 0

  return h(
    'div',
    {
      'data-testid': 'batch-action-bar',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 24px',
        flexShrink: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 8,
        margin: '0 32px 14px 32px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      },
    },
    // Left: Select All checkbox + count
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 16 } },
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'batch-select-all',
          onClick: onToggleSelectAll,
          style: {
            background: 'none',
            border: 'none',
            color: 'var(--bb-text-primary, #FFFFFF)',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
          },
        },
        h('input', {
          type: 'checkbox',
          checked: allSelected,
          ref: (el: HTMLInputElement | null) => {
            if (el) {
              el.indeterminate = !allSelected && selectedCount > 0
            }
          },
          onChange: onToggleSelectAll,
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
          style: {
            width: 16,
            height: 16,
            cursor: 'pointer',
            accentColor: 'var(--color-primary, #5F87FF)',
          },
        }),
        h('span', null, allSelected ? '取消全选' : '全选'),
      ),
      h(
        'span',
        {
          'data-testid': 'batch-selected-count',
          style: { fontSize: 13, color: 'var(--bb-text-secondary, #b3b3b3)' },
        },
        `已选择 ${selectedCount} / ${totalCount} 首`,
      ),
    ),
    // Right: Action buttons
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'batch-play-btn',
          disabled: !hasSelection,
          onClick: onBatchPlay,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 20,
            border: 'none',
            backgroundColor: hasSelection ? 'var(--color-primary, #5F87FF)' : 'rgba(255, 255, 255, 0.1)',
            color: hasSelection ? 'var(--bb-accent-on, #FFFFFF)' : 'var(--bb-text-disabled, rgba(255, 255, 255, 0.4))',
            fontSize: 13,
            fontWeight: 600,
            cursor: hasSelection ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.15s ease',
          },
        },
        tablerIcon('play', { size: 16 }),
        '批量播放',
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'batch-add-btn',
          disabled: !hasSelection,
          onClick: (e: ReactMouseEvent) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onBatchAddToPlaylist({ x: rect.left, y: rect.bottom + 6 })
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: 'transparent',
            color: hasSelection ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-disabled, rgba(255, 255, 255, 0.4))',
            fontSize: 13,
            fontWeight: 600,
            cursor: hasSelection ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s ease',
          },
        },
        tablerIcon('plus', { size: 16 }),
        '添加到',
      ),
      onBatchDelete
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': 'batch-delete-btn',
              disabled: !hasSelection || deleteDisabled,
              onClick: onBatchDelete,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid rgba(255, 85, 85, 0.3)',
                backgroundColor: 'rgba(255, 85, 85, 0.1)',
                color: hasSelection && !deleteDisabled ? '#FF6B6B' : 'rgba(255, 85, 85, 0.4)',
                fontSize: 13,
                fontWeight: 600,
                cursor: hasSelection && !deleteDisabled ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
              },
            },
            tablerIcon('trash', { size: 16 }),
            deleteLabel,
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'batch-exit-btn',
          onClick: onExitBatch,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 20,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
            backgroundColor: 'transparent',
            color: 'var(--bb-text-secondary, #b3b3b3)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          },
        },
        tablerIcon('x', { size: 16 }),
        '退出批量操作',
      ),
    ),
  )
}
