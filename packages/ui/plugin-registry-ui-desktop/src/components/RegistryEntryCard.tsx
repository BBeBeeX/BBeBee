/**
 * One registry entry card: identity, kind extras and the action button.
 *
 * Pure presentation — the install state and the minAppVersion block are
 * derived in `hooks/install-state.ts`, and the confirm flow lives in the
 * screen. Colors come from the theme's CSS variables; nothing is hardcoded.
 */

import { createElement as h, type ReactElement } from 'react'
import type { RegistryEntry } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { normalizeVersion } from '@BBeBee/toolkit'
import { isBuiltinEntry, type RegistryActionState } from '../hooks/install-state.js'
import { formatShortDate } from '../utils/format.js'

export interface RegistryEntryCardProps {
  entry: RegistryEntry
  actionState: RegistryActionState
  /** Set when `minAppVersion` blocks the install — the button renders disabled with this reason. */
  blockedReason?: string
  busy?: boolean
  onAction: () => void
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 14,
  borderRadius: 8,
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  color: 'var(--text-primary, #F5F7FF)',
  minWidth: 0,
} as const

const previewStyle = {
  width: '100%',
  height: 120,
  objectFit: 'cover',
  borderRadius: 6,
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
  display: 'block',
} as const

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  color: 'var(--text-secondary, #C5CAD8)',
  whiteSpace: 'nowrap',
} as const

function actionLabel(state: RegistryActionState): string {
  if (state.state === 'install') return '安装'
  if (state.state === 'update') return '更新'
  return '已安装'
}

export function RegistryEntryCard({
  entry,
  actionState,
  blockedReason,
  busy = false,
  onAction,
}: RegistryEntryCardProps): ReactElement {
  const installed = actionState.state === 'installed'
  const disabled = installed || Boolean(blockedReason) || busy
  const isUpdate = actionState.state === 'update'
  const showPreview = Boolean(entry.previewUrl) && (entry.kind === 'theme' || entry.kind === 'plugin')

  return h(
    'div',
    { style: cardStyle, 'data-testid': `registry-entry-${entry.id}` },
    showPreview
      ? h('img', {
          src: entry.previewUrl,
          alt: `${entry.name} 预览`,
          loading: 'lazy',
          style: previewStyle,
        })
      : null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 } },
      h(
        'span',
        {
          style: {
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--text-primary, #F5F7FF)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        entry.name,
      ),
      entry.version
        ? h('span', { style: chipStyle }, `v${normalizeVersion(entry.version)}`)
        : null,
      isBuiltinEntry(entry) ? h('span', { style: chipStyle }, '内置') : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--text-secondary, #C5CAD8)',
          flexWrap: 'wrap',
        },
      },
      entry.author ? h('span', null, entry.author) : null,
      entry.updatedAt ? h('span', null, formatShortDate(entry.updatedAt)) : null,
    ),
    entry.description
      ? h(
          'div',
          {
            style: {
              fontSize: 13,
              lineHeight: 1.45,
              color: 'var(--text-secondary, #C5CAD8)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            },
          },
          entry.description,
        )
      : null,
    entry.kind === 'plugin' && entry.capabilities?.length
      ? h(
          'div',
          { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          entry.capabilities.map((capability) =>
            h('span', { key: capability, style: chipStyle }, capability),
          ),
        )
      : null,
    entry.kind === 'plugin' && entry.minAppVersion
      ? h(
          'div',
          {
            style: {
              fontSize: 12,
              color: blockedReason
                ? 'var(--color-error, #F43F5E)'
                : 'var(--text-tertiary, #8B95B0)',
            },
          },
          blockedReason
            ? `${blockedReason}`
            : `需要应用版本 ≥ ${normalizeVersion(entry.minAppVersion)}`,
        )
      : null,
    !entry.minAppVersion && blockedReason
      ? h(
          'div',
          { style: { fontSize: 12, color: 'var(--color-error, #F43F5E)' } },
          blockedReason,
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 'auto' } },
      h(
        'button',
        {
          type: 'button',
          disabled,
          'data-testid': `registry-action-${entry.id}`,
          'data-state': actionState.state,
          onClick: disabled ? undefined : onAction,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            borderRadius: 999,
            border: installed
              ? '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))'
              : 'none',
            background:
              installed || blockedReason
                ? 'var(--surface-2, rgba(255, 255, 255, 0.06))'
                : 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
            color: installed || blockedReason
              ? 'var(--text-tertiary, #8B95B0)'
              : 'var(--bb-accent-on, #FFFFFF)',
            fontWeight: 600,
            fontSize: 13,
            cursor: disabled ? 'default' : 'pointer',
            transition: 'transform 120ms ease, box-shadow 120ms ease',
            opacity: disabled ? 0.75 : 1,
          },
        },
        isUpdate ? tablerIcon('download', { size: 14 }) : null,
        busy ? (isUpdate ? '更新中…' : '安装中…') : actionLabel(actionState),
      ),
    ),
  )
}
