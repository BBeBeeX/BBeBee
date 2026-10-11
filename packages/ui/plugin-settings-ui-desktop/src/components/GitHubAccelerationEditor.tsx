import { useState } from 'react'
import { createElement as h } from 'react'
import type { DragEvent, ReactElement } from 'react'
import { Button, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { SettingsRow } from './SettingsRow.js'

/**
 * Editor for the ordered GitHub acceleration lines (see docs/sources/registry.md §5.6).
 *
 * The system jsDelivr line is built in: it renders first, is never editable,
 * deletable or draggable, and is not part of the stored array — which only
 * ever holds the user's custom HTTPS prefixes, in try order. Every mutation
 * is reported through `onUpdatePrefixes` as the complete ordered array; this
 * component owns no persisted state, only view state (expanded / dragging).
 */

export interface GitHubAccelerationEditorProps {
  /** The user's custom prefixes, in try order (jsDelivr is implicit). */
  prefixes: readonly string[]
  /** Report the complete ordered array after any add / edit / delete / reorder. */
  onUpdatePrefixes: (prefixes: readonly string[]) => void
}

const JSDELIVR_DISPLAY_URL = 'https://cdn.jsdelivr.net/gh/'

const inputStyle = (invalid: boolean) =>
  ({
    flex: 1,
    minWidth: 0,
    height: 30,
    borderRadius: 6,
    background: 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.08))',
    border: invalid
      ? '1px solid var(--state-error, #EF4444)'
      : '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.15))',
    color: 'var(--bb-text-primary, #FFFFFF)',
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '0 10px',
    outline: 'none',
  }) as const

const iconButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--bb-text-secondary, #8E8E93)',
  cursor: 'pointer',
  flexShrink: 0,
} as const

/**
 * Move one entry to the gap it was dropped into. `dropGap` is the visual gap
 * index (`k` = insert before row `k`, `length` = after the last row), so the
 * insertion position is adjusted once the dragged row has left its old slot.
 * Pure; exported for tests.
 */
export function reorderPrefixes(
  prefixes: readonly string[],
  from: number,
  dropGap: number,
): readonly string[] {
  const next = [...prefixes]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return prefixes
  const insertAt = dropGap > from ? dropGap - 1 : dropGap
  next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved)
  return next
}

export function GitHubAccelerationEditor({
  prefixes,
  onUpdatePrefixes,
}: GitHubAccelerationEditorProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropGap, setDropGap] = useState<number | null>(null)

  const resetDrag = () => {
    setDragIndex(null)
    setDropGap(null)
  }

  // Derived validity: a non-empty line that does not start with https:// is
  // kept (never silently dropped) but painted with the error border.
  const isInvalid = (value: string): boolean => {
    const trimmed = value.trim()
    return trimmed !== '' && !trimmed.startsWith('https://')
  }

  const handleChange = (index: number, value: string) => {
    const next = [...prefixes]
    next[index] = value
    onUpdatePrefixes(next)
  }

  const handleBlur = (index: number) => {
    const raw = (prefixes[index] ?? '').trim()
    if (raw === '') {
      // The row never carried data — dropping it on blur loses nothing.
      onUpdatePrefixes(prefixes.filter((_, i) => i !== index))
      return
    }
    const normalized = raw.endsWith('/') ? raw : `${raw}/`
    if (normalized !== prefixes[index]) {
      const next = [...prefixes]
      next[index] = normalized
      onUpdatePrefixes(next)
    }
  }

  const handleDelete = (index: number) => {
    onUpdatePrefixes(prefixes.filter((_, i) => i !== index))
  }

  const handleDrop = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const from = dragIndex
    const gap = dropGap
    resetDrag()
    if (from === null || gap === null || gap === from || gap === from + 1) return
    onUpdatePrefixes(reorderPrefixes(prefixes, from, gap))
  }

  const dragOverRow = (event: DragEvent, index: number) => {
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientY - rect.top < rect.height / 2
    setDropGap(before ? index : index + 1)
  }

  const dropIndicator = (gap: number) =>
    h('div', {
      key: `drop-gap-${gap}`,
      'aria-hidden': true,
      style: {
        height: 2,
        borderRadius: 2,
        background: 'var(--tab-active, var(--color-primary, #5F87FF))',
        margin: '0 2px',
        visibility: dragIndex !== null && dropGap === gap ? 'visible' : 'hidden',
      },
    })

  return h(
    'div',
    null,
    h(SettingsRow, {
      title: 'GitHub 加速',
      description:
        '为 GitHub 资源下载配置按顺序尝试的加速线路；官方地址始终第一个尝试，仅在失败时切换',
      action: h(Button, {
        variant: 'secondary',
        children: expanded ? '收起线路' : '自定义',
        onPress: () => setExpanded((value) => !value),
      }),
    }),
    expanded
      ? h(
          'div',
          {
            'data-testid': 'settings-github-acceleration',
            onDragOver: (event: DragEvent) => event.preventDefault(),
            onDrop: handleDrop,
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '12px 8px 14px 28px',
              borderBottom: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.15))',
            },
          },
          // System-built-in jsDelivr line: fixed, first, never editable,
          // deletable or draggable.
          h(
            'div',
            {
              'data-testid': 'settings-github-prefix-system',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'var(--surface-hover, rgba(255, 255, 255, 0.03))',
              },
            },
            h(
              'span',
              {
                style: {
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'var(--surface-selected, rgba(95, 135, 255, 0.2))',
                  color: 'var(--bb-text-secondary, #A5B4CE)',
                },
              },
              '系统',
            ),
            h(
              'span',
              { style: { fontSize: 12, color: 'var(--bb-text-primary, #F5F5F7)', flexShrink: 0 } },
              'jsDelivr CDN（系统内置）',
            ),
            h(
              'span',
              {
                style: {
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: 'var(--bb-text-secondary, #8E8E93)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              JSDELIVR_DISPLAY_URL,
            ),
          ),
          dropIndicator(0),
          prefixes.flatMap((prefix, index) => {
            const row = h(
              'div',
              {
                key: `prefix-row-${index}`,
                'data-testid': `settings-github-prefix-row-${index}`,
                draggable: true,
                onDragStart: () => setDragIndex(index),
                onDragOver: (event: DragEvent) => dragOverRow(event, index),
                onDrop: handleDrop,
                onDragEnd: resetDrag,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: dragIndex === index ? 0.4 : 1,
                  cursor: 'grab',
                },
              },
              h('input', {
                type: 'text',
                value: prefix,
                placeholder: 'https://ghproxy.example.com/',
                'aria-label': `加速线路 ${index + 1}`,
                onChange: (e: { target: { value: string } }) => handleChange(index, e.target.value),
                onBlur: () => handleBlur(index),
                style: inputStyle(isInvalid(prefix)),
              }),
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': `删除加速线路 ${index + 1}`,
                  onClick: () => handleDelete(index),
                  style: iconButtonStyle,
                },
                tablerIcon('trash', { size: 16 }),
              ),
            )
            return index < prefixes.length - 1 ? [row, dropIndicator(index + 1)] : [row]
          }),
          dropIndicator(prefixes.length),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'settings-github-prefix-add',
              'aria-label': '添加加速线路',
              onClick: () => onUpdatePrefixes([...prefixes, '']),
              style: {
                ...iconButtonStyle,
                alignSelf: 'flex-start',
                border: '1px dashed var(--bb-border-subtle, rgba(255, 255, 255, 0.2))',
              },
            },
            tablerIcon('plus', { size: 16 }),
          ),
        )
      : null,
  )
}
