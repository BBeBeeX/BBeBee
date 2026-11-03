import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface BatchActionBarProps {
  ctx: Context
  selectedCount: number
  totalCount: number
  allSelected: boolean
  onToggleSelectAll: () => void
  onBatchPlay: () => void
  onBatchAddToPlaylist: (anchor?: { x: number; y: number }) => void
  onBatchDownload?: () => void
  onExitBatch: () => void
  downloadDisabled?: boolean
}

export function BatchActionBar({
  ctx,
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onBatchPlay,
  onBatchAddToPlaylist,
  onBatchDownload,
  onExitBatch,
  downloadDisabled = false,
}: BatchActionBarProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const hasSelection = selectedCount > 0

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
            ? t('album:batchAction.deselectAll')
            : t('album:batchAction.selectAll'),
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
            ? t('album:batchAction.deselectAll')
            : t('album:batchAction.selectAll'),
        ),
        h(
          Text,
          {
            testID: 'batch-selected-count',
            variant: 'sm',
            tone: 'muted',
            style: { marginLeft: tokens.space[2] },
          },
          t('album:batchAction.selectedSongs', { selectedCount, totalCount }),
        ),
      ),
      h(
        native.Pressable as never,
        {
          testID: 'batch-exit-btn',
          accessibilityRole: 'button',
          accessibilityLabel: t('album:index.exitBatchOperations'),
          onPress: onExitBatch,
          style: {
            paddingVertical: tokens.space[1],
            paddingHorizontal: tokens.space[2],
          },
        },
        h(Text, { variant: 'sm', tone: 'muted' }, t('album:index.exitBatchOperations')),
      ),
    ),
    // Bottom Action Buttons
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[2],
          marginTop: tokens.space[1],
        },
      },
      h(
        Button,
        {
          testID: 'batch-play-btn',
          variant: 'primary',
          disabled: !hasSelection,
          onPress: onBatchPlay,
          style: { flex: 1 },
          children: t('album:batchAction.play'),
        },
      ),
      h(
        Button,
        {
          testID: 'batch-add-playlist-btn',
          variant: 'secondary',
          disabled: !hasSelection,
          onPress: () => onBatchAddToPlaylist(),
          style: { flex: 1 },
          children: t('album:batchAction.addTo'),
        },
      ),
      onBatchDownload
        ? h(
            Button,
            {
              testID: 'batch-download-btn',
              variant: 'secondary',
              disabled: !hasSelection || downloadDisabled,
              onPress: onBatchDownload,
              style: { flex: 1 },
              children: t('album:index.download'),
            },
          )
        : null,
    ),
  )
}
