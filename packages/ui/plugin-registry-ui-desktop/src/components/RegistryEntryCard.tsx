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
import type { Context } from 'cordis'
import type { RegistryEntry } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { normalizeVersion } from '@BBeBee/toolkit'
import { isBuiltinEntry, type RegistryActionState } from '../hooks/install-state.js'
import { formatCompactCount, formatDateMs, formatShortDate } from '../utils/format.js'
import { useOptionalI18n } from '../utils/optional-i18n.js'
import { CHIP, GHOST_BUTTON, STAT_CHIP, TONE } from '../styles.js'

/** Lazily-fetched GitHub stats for the entry's repository, if it has one. */
export interface RegistryEntryCardStats {
  stars?: number
  contributors?: number
  downloads?: number
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
 * settings" note for kinds whose service has no remove API; the
 * heavy confirm dialog is deliberately not reused here.
 */
export interface RegistryEntryCardUninstall {
  available: boolean
  busy?: boolean
  onConfirm: () => void
}

export interface RegistryEntryCardProps {
  /**
   * The app context — read for the interface language. Optional so unit
   * tests can render the card without a kernel context; absent, the
   * copy degrades to the catalogue keys.
   */
  ctx?: Context
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
  /** Uninstall affordance; absent renders nothing extra. */
  uninstall?: RegistryEntryCardUninstall
  /** Enablement state for installed plugin / lyric source. */
  itemEnabled?: boolean
  /** Toggle enablement callback for plugin / lyric source. */
  onToggleEnabled?: () => void
  /** Whether theme is active (in use). */
  themeActive?: boolean
  /** Apply theme callback. */
  onApplyTheme?: () => void
  /** Backwards compatibility alias for pluginEnabled. */
  pluginEnabled?: boolean
  /** Backwards compatibility alias for onTogglePluginEnabled. */
  onTogglePluginEnabled?: () => void
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

/** The built-in badge: official content, tinted with the brand rather than neutral. */
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
  padding: '4px 6px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  background: 'transparent',
  cursor: 'pointer',
} as const

function favoriteColor(favorite: boolean): string {
  return favorite ? 'var(--color-primary, #5F87FF)' : 'var(--text-tertiary, #8B95B0)'
}

/** The `t()` signature from `useI18n`, for the label helpers below. */
type Translate = (key: string, params?: Record<string, string | number>) => string

function actionLabel(t: Translate, state: RegistryActionState): string {
  if (state.state === 'install') return t('registry:registryEntry.install')
  if (state.state === 'update') return t('registry:registryEntry.update')
  return t('registry:registryEntry.installed')
}

export function RegistryEntryCard({
  ctx,
  entry,
  actionState,
  blockedReason,
  busy = false,
  stats,
  installedMeta,
  favorite = false,
  onToggleFavorite,
  uninstall,
  itemEnabled,
  onToggleEnabled,
  themeActive,
  onApplyTheme,
  pluginEnabled,
  onTogglePluginEnabled,
  onAction,
}: RegistryEntryCardProps): ReactElement {
  const { t } = useOptionalI18n(ctx)
  const installed = actionState.state === 'installed'
  const isUpdate = actionState.state === 'update'
  const isInstalled = installed || isUpdate
  const isExtension = entry.kind === 'plugin' || entry.kind === 'lyric-source' || entry.kind === 'theme'
  const isInstalledExtension = isExtension && isInstalled
  const isPlugin = entry.kind === 'plugin'
  const isLyric = entry.kind === 'lyric-source'
  const isTheme = entry.kind === 'theme'

  const effectiveEnabled = isPlugin
    ? (itemEnabled ?? pluginEnabled)
    : isLyric
      ? itemEnabled
      : undefined

  const effectiveToggle = isPlugin
    ? (onToggleEnabled ?? onTogglePluginEnabled)
    : onToggleEnabled

  const disabled = (installed && !isExtension) || Boolean(blockedReason) || busy
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
          alt: t('registry:registryEntry.previewAlt', { name: entry.name }),
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
      isBuiltinEntry(entry) ? h('span', { style: builtinChipStyle }, t('registry:registryEntry.builtIn')) : null,
      // Status badge for installed extensions: in-use (使用中) vs disabled (已停用)
      isInstalledExtension && (isTheme ? themeActive !== undefined : effectiveEnabled !== undefined)
        ? h(
            'span',
            {
              'data-testid': isPlugin
                ? `registry-plugin-status-${entry.id}`
                : isTheme
                  ? `registry-theme-status-${entry.id}`
                  : `registry-lyric-status-${entry.id}`,
              style: {
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                background: (isTheme ? themeActive : effectiveEnabled)
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(255, 255, 255, 0.08)',
                color: (isTheme ? themeActive : effectiveEnabled)
                  ? 'var(--color-success, #10B981)'
                  : 'var(--text-tertiary, #8B95B0)',
                border: `1px solid ${
                  (isTheme ? themeActive : effectiveEnabled)
                    ? 'color-mix(in srgb, var(--color-success, #10B981) 40%, transparent)'
                    : 'var(--border-subtle, rgba(255, 255, 255, 0.12))'
                }`,
              },
            },
            h('span', {
              style: {
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: (isTheme ? themeActive : effectiveEnabled)
                  ? 'var(--color-success, #10B981)'
                  : 'var(--text-tertiary, #8B95B0)',
              },
            }),
            (isTheme ? themeActive : effectiveEnabled)
              ? t('registry:registryEntry.inUse')
              : t('registry:registryEntry.disabled'),
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
      // GitHub stats badges: stars + downloads (contributor/user icon removed per request).
      stats
        ? h(
            'span',
            { key: 'stats', 'data-testid': `registry-stats-${entry.id}`, style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h(
              'span',
              { style: STAT_CHIP, title: t('registry:registryEntry.stars') },
              tablerIcon('star-filled', { size: 12, color: '#E5A50A' }),
              h('span', null, stats.stars !== undefined ? formatCompactCount(stats.stars) : '—'),
            ),
            h(
              'span',
              { style: STAT_CHIP, title: t('registry:registryEntry.downloads') },
              tablerIcon('download', { size: 12 }),
              h('span', null, stats.downloads !== undefined ? formatCompactCount(stats.downloads) : '—'),
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
            : t('registry:registryEntry.requiresAppVersion', { version: normalizeVersion(entry.minAppVersion) }),
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
          h('span', null, `Installed v${normalizeVersion(installedMeta.installedVersion)}`),
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
      // 1. Bottom-left corner: bookmark favorite button
      onToggleFavorite
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': `registry-favorite-${entry.id}`,
              'aria-pressed': favorite,
              'aria-label': favorite ? t('registry:registryEntry.removeFromFavorites') : t('registry:registryEntry.addToFavorites'),
              title: favorite ? t('registry:registryEntry.removeFromFavorites') : t('registry:registryEntry.addToFavorites'),
              onClick: onToggleFavorite,
              className: 'bbreg-favorite',
              style: {
                ...favoriteButtonStyle,
                color: favoriteColor(favorite),
                background: favorite ? 'rgba(95, 135, 255, 0.12)' : 'transparent',
                borderColor: favorite ? 'color-mix(in srgb, var(--color-primary, #5F87FF) 40%, transparent)' : 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
                marginRight: 'auto',
              },
            },
            tablerIcon(favorite ? 'bookmark-filled' : 'bookmark', { size: 15 }),
          )
        : h('div', { style: { marginRight: 'auto' } }),
      // 2. Actions cluster
      h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },

        // Uninstall affordance (for any kind if uninstall is provided and available)
        uninstall && uninstall.available
          ? uninstallArmed
            ? h(
                'span',
                { key: 'uninstall-armed', style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } }, t('registry:registryEntry.uninstallThis')),
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
                  uninstallBusy ? t('registry:registryEntry.uninstalling') : t('registry:registryEntry.confirmUninstall'),
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
                  t('app:common.cancel'),
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
                  title: t('registry:registryEntry.uninstallTheInstalledContent'),
                  className: 'bbreg-btn bbreg-btn-ghost',
                  style: { ...GHOST_BUTTON, opacity: uninstallBusy ? 0.6 : 1, cursor: uninstallBusy ? 'default' : 'pointer' },
                },
                tablerIcon('trash', { size: 13 }),
                uninstallBusy ? t('registry:registryEntry.uninstalling') : t('registry:registryEntry.uninstall'),
              )
          : uninstall && !uninstall.available
            ? h(
                'span',
                {
                  key: 'uninstall-note',
                  'data-testid': `registry-uninstall-note-${entry.id}`,
                  style: {
                    fontSize: 12,
                    color: 'var(--text-tertiary, #8B95B0)',
                  },
                },
                t('registry:registryEntry.uninstallFromPluginManagement'),
              )
            : null,

        // Primary action / toggle button
        isInstalledExtension
          ? isUpdate
            ? h(
                'button',
                {
                  type: 'button',
                  'data-testid': `registry-action-${entry.id}`,
                  'data-state': actionState.state,
                  onClick: busy ? undefined : onAction,
                  className: 'bbreg-btn bbreg-btn-primary',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 16px',
                    borderRadius: 999,
                    border: 'none',
                    background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                    boxShadow: 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))',
                    color: 'var(--bb-accent-on, #FFFFFF)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: busy ? 'default' : 'pointer',
                  },
                },
                tablerIcon('download', { size: 14 }),
                busy ? t('registry:registryEntry.updating') : t('registry:registryEntry.update'),
              )
            : isTheme
              ? h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': `registry-action-${entry.id}`,
                    'data-state': themeActive ? 'in-use' : 'installed',
                    disabled: themeActive,
                    onClick: themeActive ? undefined : onApplyTheme,
                    className: themeActive ? 'bbreg-btn bbreg-btn-ghost' : 'bbreg-btn bbreg-btn-primary',
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 16px',
                      borderRadius: 999,
                      border: themeActive ? '1px solid var(--border-subtle, rgba(255, 255, 255, 0.16))' : 'none',
                      background: themeActive
                        ? 'var(--surface-2, rgba(255, 255, 255, 0.06))'
                        : 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                      boxShadow: themeActive ? 'none' : 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))',
                      color: themeActive ? 'var(--text-tertiary, #8B95B0)' : 'var(--bb-accent-on, #FFFFFF)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: themeActive ? 'default' : 'pointer',
                    },
                  },
                  themeActive ? t('registry:registryEntry.inUse') : t('registry:registryEntry.use'),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    'data-testid': `registry-action-${entry.id}`,
                    'data-state': effectiveEnabled === false ? 'disabled' : 'in-use',
                    onClick: effectiveToggle,
                    className: effectiveEnabled === false ? 'bbreg-btn bbreg-btn-primary' : 'bbreg-btn bbreg-btn-ghost',
                    style: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 16px',
                      borderRadius: 999,
                      border: effectiveEnabled === false ? 'none' : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.16))',
                      background: effectiveEnabled === false
                        ? 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))'
                        : 'var(--surface-2, rgba(255, 255, 255, 0.06))',
                      boxShadow: effectiveEnabled === false ? 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))' : 'none',
                      color: effectiveEnabled === false ? 'var(--bb-accent-on, #FFFFFF)' : 'var(--text-primary, #F5F7FF)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    },
                  },
                  effectiveEnabled === false ? t('registry:registryEntry.use') : t('registry:registryEntry.disable'),
                )
          : // For non-installed items or other items (music sources): standard single action button
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
              busy
                ? isUpdate
                  ? t('registry:registryEntry.updating')
                  : t('registry:registryEntry.installing')
                : actionLabel(t, actionState),
            ),
      ),
    ),
  )
}
