import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Text, c, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface BatchActionBarProps {
  ctx: Context
  selectedCount: number
  totalCount: number
  allSelected: boolean
  onToggleSelectAll: () => void
  onBatchPlay: () => void
  onBatchAddToPlaylist: (anchor?: { x: number; y: number }) => void
  onBatchDelete?: () => void
  onExitBatch: () => void
  deleteLabel?: string
  deleteDisabled?: boolean
}

export function BatchActionBar({
  ctx,
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onBatchPlay,
  onBatchAddToPlaylist,
  onBatchDelete,
  onExitBatch,
  deleteLabel,
  deleteDisabled = false,
}: BatchActionBarProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const hasSelection = selectedCount > 0
  const resolvedDeleteLabel = deleteLabel ?? t('app:common.delete')

  return h(
    native.View as never,
    {
      testID: 'batch-action-bar',
      style: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        gap: tokens.space[2],
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        marginBottom: tokens.space[2],
      },
    },
    // Top Row: Select All + Selection Count + Exit
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(
        native.Pressable as never,
        {
          testID: 'batch-select-all',
          accessibilityRole: 'checkbox',
          accessibilityLabel: allSelected
            ? t('library:batchAction.deselectAll')
            : t('library:batchAction.selectAll'),
          onPress: onToggleSelectAll,
          style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] },
        },
        h(
          Text,
          { variant: 'md', tone: allSelected ? 'accent' : 'muted' },
          allSelected ? '☑' : selectedCount > 0 ? '⊟' : '☐',
        ),
        h(
          Text,
          { variant: 'sm', style: { fontWeight: tokens.font.weight.bold } },
          allSelected
            ? t('library:batchAction.deselectAll')
            : t('library:batchAction.selectAll'),
        ),
        h(
          Text,
          {
            testID: 'batch-selected-count',
            variant: 'sm',
            tone: 'muted',
            style: { marginLeft: tokens.space[2] },
          },
          t('library:batchAction.selectedSongs', { selectedCount, totalCount }),
        ),
      ),
      h(
        native.Pressable as never,
        {
          testID: 'batch-exit-btn',
          accessibilityRole: 'button',
          accessibilityLabel: t('library:favorites.exitBatchOperations'),
          onPress: onExitBatch,
          style: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
        },
        tablerIcon('x', { size: 16, color: c().text.muted }),
        h(Text, { variant: 'sm', tone: 'muted' }, t('library:favorites.exitBatchOperations')),
      ),
    ),
    // Bottom Row: Action buttons
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[2],
          flexWrap: 'wrap',
          marginTop: 2,
        },
      },
      h(
        Button,
        {
          testID: 'batch-play-btn',
          variant: 'primary',
          disabled: !hasSelection,
          onPress: onBatchPlay,
          children: t('library:favorites.playSelected'),
        },
      ),
      h(
        Button,
        {
          testID: 'batch-add-btn',
          variant: 'secondary',
          disabled: !hasSelection,
          onPress: () => onBatchAddToPlaylist(),
          children: t('library:batchAction.addTo'),
        },
      ),
      onBatchDelete
        ? h(
            Button,
            {
              testID: 'batch-delete-btn',
              variant: 'danger',
              disabled: !hasSelection || deleteDisabled,
              onPress: onBatchDelete,
              children: resolvedDeleteLabel,
            },
          )
        : null,
    ),
  )
}
