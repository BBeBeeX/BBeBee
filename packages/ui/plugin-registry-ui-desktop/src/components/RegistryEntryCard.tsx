/**
 * One registry entry card: identity, kind extras and the action button.
 *
 * Pure presentation — the install state and the minAppVersion block are
 * derived in `hooks/install-state.ts`, and the confirm flow lives in the
 * screen. `stats`, when the screen passes it, renders the lazily-fetched
 * GitHub badges; the card never fetches anything itself. Colors come from the
 * theme's CSS variables; nothing is hardcoded.
 *
 * Information hierarchy, top to bottom: the name (strong) → author / date /
 * stats (quiet metadata on one line) → description (two-line clamp) →
 * capability chips → the pinned action row, so the install/update button
 * always lands in the same corner no matter how tall the content above is.
 * The hover lift, the favorite heart's pop and the primary button's grow all
 * come from the shared `BASELINE_CSS` classes.
 *
 * Three affordances are opt-in and absent renders nothing extra, so every
 * other usage of the card stays pixel-identical: the favorite heart
 * (`onToggleFavorite`), the installed-tab lock line (`installedMeta`) and the
 * uninstall control (`uninstall`). The uninstall confirmation is a lightweight
 * armed state local to the card — the heavy dialog work belongs to the
 * install flow, not to removing what the user already has.
 */

import { createElement as h, useState, type ReactElement } from 'react'
import type { RegistryEntry } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { normalizeVersion } from '@BBeBee/toolkit'
import { isBuiltinEntry, type RegistryActionState } from '../hooks/install-state.js'
import { formatCompactCount, formatDateMs, formatShortDate } from '../utils/format.js'
import { CHIP, GHOST_BUTTON, STAT_CHIP, TONE } from '../styles.js'

/** Lazily-fetched GitHub stats for the entry's repository, if it has one. */
export interface RegistryEntryCardStats {
  stars?: number
  contributors?: number
}

/** Installed-tab metadata: what the lock file (and the action state) know. */
export interface RegistryEntryCardInstalledMeta {
  installedVersion: string
  /** Full commit sha; the card renders its first 7 characters. */
  commit?: string
  /** Install timestamp (wall-clock ms) from the lock record. */
  installedAt?: number
}

/**
 * The uninstall affordance. `available: false` renders the "manage it in
 * settings" note for kinds whose service has no remove API (plugins); the
 * heavy confirm dialog is deliberately not reused here.
 */
export interface RegistryEntryCardUninstall {
  available: boolean
  busy?: boolean
  onConfirm: () => void
}

export interface RegistryEntryCardProps {
  entry: RegistryEntry
  actionState: RegistryActionState
  /** Set when `minAppVersion` blocks the install — the button renders disabled with this reason. */
  blockedReason?: string
  busy?: boolean
  /** Present only once a lookup answered; absent renders the card exactly as before. */
  stats?: RegistryEntryCardStats
  /** Installed-tab lock line; absent renders nothing extra. */
  installedMeta?: RegistryEntryCardInstalledMeta
  /** Favorite mark; the button renders only when `onToggleFavorite` is provided. */
  favorite?: boolean
  onToggleFavorite?: () => void
  /** Uninstall affordance (installed tab); absent renders nothing extra. */
  uninstall?: RegistryEntryCardUninstall
  onAction: () => void
}

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
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

const titleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  minWidth: 0,
} as const

const nameStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text-primary, #F5F7FF)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: '0 1 auto',
  minWidth: 0,
} as const

/** The quiet metadata line: author · date · [stats], all in one rhythm. */
const metaRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  fontSize: 12,
  color: 'var(--text-tertiary, #8B95B0)',
  minWidth: 0,
} as const

const metaSeparatorStyle = {
  color: 'var(--text-disabled, #4B5368)',
  flexShrink: 0,
} as const

/** The 内置 badge: official content, tinted with the brand rather than neutral. */
const builtinChipStyle = {
  ...CHIP,
  color: 'var(--color-primary, #5F87FF)',
  borderColor: 'color-mix(in srgb, var(--color-primary, #5F87FF) 40%, transparent)',
  background: 'color-mix(in srgb, var(--color-primary, #5F87FF) 12%, transparent)',
} as const

/** The installed-tab lock strip: a quiet framed line instead of bare text. */
const installedMetaStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  fontSize: 11,
  color: 'var(--text-tertiary, #8B95B0)',
  padding: '5px 8px',
  borderRadius: 6,
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
} as const

const actionRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 'auto',
} as const

const favoriteButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 'auto',
  padding: 4,
  borderRadius: 999,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
} as const

function favoriteColor(favorite: boolean): string {
  return favorite ? TONE.error : 'var(--text-tertiary, #8B95B0)'
}

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
  stats,
  installedMeta,
  favorite = false,
  onToggleFavorite,
  uninstall,
  onAction,
}: RegistryEntryCardProps): ReactElement {
  const installed = actionState.state === 'installed'
  const disabled = installed || Boolean(blockedReason) || busy
  const isUpdate = actionState.state === 'update'
  const showPreview = Boolean(entry.previewUrl) && (entry.kind === 'theme' || entry.kind === 'plugin')
  // The lightweight uninstall confirmation: one armed flag, reset on any
  // transition. It is pure view state — the service call it eventually makes
  // lives in the screen.
  const [uninstallArmed, setUninstallArmed] = useState(false)
  const uninstallBusy = uninstall?.busy === true

  return h(
    'div',
    { style: cardStyle, 'data-testid': `registry-entry-${entry.id}`, className: 'bbreg-card' },
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
      { style: titleRowStyle },
      h('span', { style: nameStyle }, entry.name),
      entry.version
        ? h('span', { style: { ...CHIP, flexShrink: 0 } }, `v${normalizeVersion(entry.version)}`)
        : null,
      isBuiltinEntry(entry) ? h('span', { style: builtinChipStyle }, '内置') : null,
      // The favorite heart: outline when unmarked, filled rose when marked.
      // Only rendered when the screen wires a toggle, so other usages of the
      // card are untouched.
      onToggleFavorite
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': `registry-favorite-${entry.id}`,
              'aria-pressed': favorite,
              'aria-label': favorite ? '取消收藏' : '收藏',
              title: favorite ? '取消收藏' : '收藏',
              onClick: onToggleFavorite,
              className: 'bbreg-favorite',
              style: { ...favoriteButtonStyle, color: favoriteColor(favorite) },
            },
            tablerIcon(favorite ? 'heart-filled' : 'heart', { size: 16 }),
          )
        : null,
    ),
    h(
      'div',
      { style: metaRowStyle },
      entry.author ? h('span', { key: 'author' }, entry.author) : null,
      entry.author && entry.updatedAt
        ? h('span', { key: 'sep', style: metaSeparatorStyle }, '·')
        : null,
      entry.updatedAt ? h('span', { key: 'date' }, formatShortDate(entry.updatedAt)) : null,
      // GitHub stats badges — only once a lookup answered. There is no star
      // glyph in the shared tabler set and this package may not extend the
      // kit, so the stars badge is a labelled chip; contributors use the
      // kit's user icon. A field the lookup could not answer renders "—".
      stats
        ? h(
            'span',
            { key: 'stats', 'data-testid': `registry-stats-${entry.id}`, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h('span', { style: STAT_CHIP }, '星标', h('span', null, stats.stars !== undefined ? formatCompactCount(stats.stars) : '—')),
            h(
              'span',
              { style: STAT_CHIP },
              tablerIcon('user', { size: 12 }),
              h('span', null, stats.contributors !== undefined ? formatCompactCount(stats.contributors) : '—'),
            ),
          )
        : null,
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
            h('span', { key: capability, style: CHIP }, capability),
          ),
        )
      : null,
    entry.kind === 'plugin' && entry.minAppVersion
      ? h(
          'div',
          {
            style: {
              fontSize: 12,
              color: blockedReason ? TONE.error : 'var(--text-tertiary, #8B95B0)',
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
          { style: { fontSize: 12, color: TONE.error } },
          blockedReason,
        )
      : null,
    // The installed-tab lock strip: version always (the action state knows
    // it), commit and install date only when the lock file answered.
    installedMeta
      ? h(
          'div',
          {
            'data-testid': `registry-installed-meta-${entry.id}`,
            style: installedMetaStyle,
          },
          tablerIcon('lock', { size: 11 }),
          h('span', null, `已安装 v${normalizeVersion(installedMeta.installedVersion)}`),
          installedMeta.commit
            ? h('span', { style: { ...CHIP, fontSize: 10, padding: '1px 6px' } }, installedMeta.commit.slice(0, 7))
            : null,
          installedMeta.installedAt !== undefined
            ? h('span', null, formatDateMs(installedMeta.installedAt))
            : null,
        )
      : null,
    h(
      'div',
      { style: actionRowStyle },
      uninstall
        ? uninstall.available
          ? uninstallArmed
            ? h(
                'span',
                { key: 'uninstall-armed', style: { display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 'auto', flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } }, '确认卸载？'),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': `registry-uninstall-confirm-${entry.id}`,
                    disabled: uninstallBusy,
                    onClick: uninstallBusy
                      ? undefined
                      : () => {
                          setUninstallArmed(false)
                          uninstall.onConfirm()
                        },
                    className: 'bbreg-btn',
                    style: {
                      ...GHOST_BUTTON,
                      borderColor: TONE.error,
                      color: TONE.error,
                      fontWeight: 600,
                      opacity: uninstallBusy ? 0.6 : 1,
                      cursor: uninstallBusy ? 'default' : 'pointer',
                    },
                  },
                  uninstallBusy ? '卸载中…' : '确认卸载',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': `registry-uninstall-cancel-${entry.id}`,
                    disabled: uninstallBusy,
                    onClick: uninstallBusy ? undefined : () => setUninstallArmed(false),
                    className: 'bbreg-btn bbreg-btn-ghost',
                    style: { ...GHOST_BUTTON, opacity: uninstallBusy ? 0.6 : 1, cursor: uninstallBusy ? 'default' : 'pointer' },
                  },
                  '取消',
                ),
              )
            : h(
                'button',
                {
                  key: 'uninstall',
                  type: 'button',
                  'data-testid': `registry-uninstall-${entry.id}`,
                  disabled: uninstallBusy,
                  onClick: uninstallBusy ? undefined : () => setUninstallArmed(true),
                  title: '卸载已安装的内容',
                  className: 'bbreg-btn bbreg-btn-ghost',
                  style: { ...GHOST_BUTTON, marginRight: 'auto', opacity: uninstallBusy ? 0.6 : 1, cursor: uninstallBusy ? 'default' : 'pointer' },
                },
                tablerIcon('trash', { size: 13 }),
                uninstallBusy ? '卸载中…' : '卸载',
              )
          : h(
              'span',
              {
                key: 'uninstall-note',
                'data-testid': `registry-uninstall-note-${entry.id}`,
                style: {
                  marginRight: 'auto',
                  fontSize: 12,
                  color: 'var(--text-tertiary, #8B95B0)',
                },
              },
              '请到插件管理/设置中卸载',
            )
        : null,
      h(
        'button',
        {
          type: 'button',
          disabled,
          'data-testid': `registry-action-${entry.id}`,
          'data-state': actionState.state,
          onClick: disabled ? undefined : onAction,
          className: disabled ? 'bbreg-btn' : 'bbreg-btn bbreg-btn-primary',
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
            boxShadow: installed || blockedReason ? 'none' : 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))',
            color: installed || blockedReason
              ? 'var(--text-tertiary, #8B95B0)'
              : 'var(--bb-accent-on, #FFFFFF)',
            fontWeight: 600,
            fontSize: 13,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.75 : 1,
          },
        },
        isUpdate ? tablerIcon('download', { size: 14 }) : null,
        busy ? (isUpdate ? '更新中…' : '安装中…') : actionLabel(actionState),
      ),
    ),
  )
}
