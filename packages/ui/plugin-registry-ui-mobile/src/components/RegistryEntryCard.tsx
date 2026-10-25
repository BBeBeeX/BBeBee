/**
 * One registry entry card, React Native — the mobile twin of the desktop
 * package's `RegistryEntryCard`, same information hierarchy and affordances,
 * rebuilt on the kit's primitives (Pressable rows, `Text` variants, token
 * spacing) and the palette resolver (`c()`) instead of CSS variables.
 *
 * Pure presentation — the install state is derived in `hooks/install-state.ts`
 * and the confirm flow lives in the screen. `stats`, when the screen passes
 * it, renders the lazily-fetched GitHub badges; the card never fetches
 * anything itself.
 *
 * Information hierarchy, top to bottom: the name (strong) → author / date /
 * stats (quiet metadata) → description (two-line clamp) → capability chips →
 * the pinned action row. The uninstall confirmation is a lightweight armed
 * state local to the card, exactly as on desktop — the heavy dialog work
 * belongs to the install flow.
 *
 * Mobile simplification: no preview image (registry preview URLs are wide
 * desktop banners; the kinds they decorate have colour chips instead) and no
 * favorite heart (the favorites view is deferred on mobile).
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntry } from '@BBeBee/protocol'
import { Button, nativePrimitives, Text, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { normalizeVersion } from '@BBeBee/toolkit'
import { isBuiltinEntry, type RegistryActionState } from '../hooks/install-state.js'
import { formatCompactCount, formatShortDate } from '../utils/format.js'

/** Lazily-fetched GitHub stats for the entry's repository, if it has one. */
export interface RegistryEntryCardStats {
  stars?: number
  contributors?: number
  downloads?: number
}

/**
 * The uninstall affordance. `available: false` renders the "manage it in
 * settings" note for kinds whose service has no remove API; the heavy
 * confirm dialog is deliberately not reused here.
 */
export interface RegistryEntryCardUninstall {
  available: boolean
  busy?: boolean
  onConfirm: () => void
}

export interface RegistryEntryCardProps {
  /** The app context — read for the interface language. */
  ctx: Context
  entry: RegistryEntry
  actionState: RegistryActionState
  /** Set when `minAppVersion` blocks the install — the button renders disabled with this reason. */
  blockedReason?: string
  busy?: boolean
  /** Present only once a lookup answered; absent renders the card exactly as before. */
  stats?: RegistryEntryCardStats
  /** Plugin title version: the installed version, else the npm latest the screen resolved. */
  titleVersion?: string
  /** Latest available version, shown as a chip when the entry has an update. */
  latestVersion?: string
  /** Uninstall affordance; absent renders nothing extra. */
  uninstall?: RegistryEntryCardUninstall
  /** Enablement state for the installed extension kinds. */
  itemEnabled?: boolean
  /** Toggle enablement for plugin / lyric source / music source. */
  onToggleEnabled?: () => void
  /** Whether the theme is active (in use); themes only. */
  themeActive?: boolean
  /** Apply-theme callback; themes only. */
  onApplyTheme?: () => void
  onAction: () => void
}

type Translate = (key: string, params?: Record<string, string | number>) => string

function actionLabel(t: Translate, state: RegistryActionState): string {
  if (state.state === 'install') return t('registry:registryEntry.install')
  if (state.state === 'update') return t('registry:registryEntry.update')
  return t('registry:registryEntry.installed')
}

function kindLabel(t: Translate, kind: RegistryEntry['kind']): string {
  switch (kind) {
    case 'music-source':
      return t('registry:registry.musicSource')
    case 'lyric-source':
      return t('registry:registry.lyricSource')
    case 'theme':
      return t('registry:registry.theme')
    case 'plugin':
      return t('registry:registry.plugin')
  }
}

export function RegistryEntryCard({
  ctx,
  entry,
  actionState,
  blockedReason,
  busy = false,
  stats,
  titleVersion,
  latestVersion,
  uninstall,
  itemEnabled,
  onToggleEnabled,
  themeActive,
  onApplyTheme,
  onAction,
}: RegistryEntryCardProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  // The palette snapshot: subscribe so a theme change repaints the card.
  const p = usePalette()
  const installed = actionState.state === 'installed'
  const isUpdate = actionState.state === 'update'
  const isInstalled = installed || isUpdate
  const isPlugin = entry.kind === 'plugin'
  const isLyric = entry.kind === 'lyric-source'
  const isTheme = entry.kind === 'theme'
  const isMusic = entry.kind === 'music-source'
  const isExtension = isPlugin || isLyric || isTheme || isMusic
  const isInstalledExtension = isExtension && isInstalled

  const disabled = (installed && !isExtension) || Boolean(blockedReason) || busy

  // The lightweight uninstall confirmation: one armed flag, reset on any
  // transition. Pure view state — the service call it eventually makes
  // lives in the screen.
  const [uninstallArmed, setUninstallArmed] = useState(false)
  const uninstallBusy = uninstall?.busy === true

  const statusValue = isTheme ? themeActive : itemEnabled

  return h(
    native.View as never,
    {
      testID: `registry-entry-${entry.id}`,
      style: {
        gap: tokens.space[2],
        padding: tokens.space[4],
        borderRadius: tokens.radius.md,
        borderWidth: 1,
        borderColor: p.border.subtle,
      },
    },
    // Title row: kind chip · name · version chip(s) · built-in / status badge.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], flexWrap: 'wrap' } },
      h(Text, { variant: 'xs', tone: 'muted', children: kindLabel(t, entry.kind) }),
      h(Text, { variant: 'md', numberOfLines: 1, children: entry.name }),
      (isPlugin ? titleVersion : entry.version)
        ? h(
            native.View as never,
            {
              key: 'version-chip',
              style: {
                paddingHorizontal: tokens.space[2],
                paddingVertical: 2,
                borderRadius: tokens.radius.pill,
                backgroundColor: p.bg.overlay,
              },
            },
            h(
              Text,
              { variant: 'xs', tone: 'muted' },
              `v${normalizeVersion((isPlugin ? titleVersion : entry.version)!)}`,
            ),
          )
        : null,
      isPlugin && entry.npm
        ? h(
            native.View as never,
            {
              key: 'npm-chip',
              style: {
                paddingHorizontal: tokens.space[2],
                paddingVertical: 2,
                borderRadius: tokens.radius.pill,
                backgroundColor: p.bg.overlay,
              },
            },
            h(Text, { variant: 'xs', tone: 'muted', children: entry.npm }),
          )
        : null,
      isBuiltinEntry(entry)
        ? h(
            native.View as never,
            {
              key: 'builtin-chip',
              style: {
                paddingHorizontal: tokens.space[2],
                paddingVertical: 2,
                borderRadius: tokens.radius.pill,
                backgroundColor: 'rgba(95, 135, 255, 0.15)',
              },
            },
            h(Text, { variant: 'xs', tone: 'accent', children: t('registry:registryEntry.builtIn') }),
          )
        : null,
      isInstalledExtension && statusValue !== undefined
        ? h(
            native.View as never,
            {
              key: 'status-badge',
              testID: isPlugin
                ? `registry-plugin-status-${entry.id}`
                : isTheme
                  ? `registry-theme-status-${entry.id}`
                  : isMusic
                    ? `registry-music-status-${entry.id}`
                    : `registry-lyric-status-${entry.id}`,
              style: {
                marginLeft: 'auto',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: tokens.space[2],
                paddingVertical: 2,
                borderRadius: tokens.radius.pill,
                backgroundColor: statusValue ? 'rgba(16, 185, 129, 0.15)' : p.bg.overlay,
              },
            },
            h(Text, { variant: 'xs', tone: statusValue ? 'ok' : 'muted', children: statusValue ? t('registry:registryEntry.inUse') : t('registry:registryEntry.disabled') }),
          )
        : null,
    ),
    // Quiet metadata line: author · date · stats.
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1], flexWrap: 'wrap' } },
      entry.author ? h(Text, { key: 'author', variant: 'xs', tone: 'muted', children: entry.author }) : null,
      entry.author && entry.updatedAt
        ? h(Text, { key: 'sep', variant: 'xs', tone: 'muted', children: '·' })
        : null,
      entry.updatedAt ? h(Text, { key: 'date', variant: 'xs', tone: 'muted', children: formatShortDate(entry.updatedAt) }) : null,
      stats
        ? h(
            native.View as never,
            {
              key: 'stats',
              testID: `registry-stats-${entry.id}`,
              style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] },
            },
            h(Text, { variant: 'xs', tone: 'muted' }, `${t('registry:registryEntry.stars')} ${stats.stars !== undefined ? formatCompactCount(stats.stars) : '—'}`),
            h(Text, { variant: 'xs', tone: 'muted' }, `${t('registry:registryEntry.downloads')} ${stats.downloads !== undefined ? formatCompactCount(stats.downloads) : '—'}`),
          )
        : null,
    ),
    entry.description
      ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 2, children: entry.description })
      : null,
    // Plugin capability chips: provided services (accent) then required ones.
    isPlugin && (entry.provides?.length || entry.services?.length)
      ? h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
          [
            ...(entry.provides ?? []).map((service) =>
              h(
                native.View as never,
                {
                  key: `provides:${service}`,
                  style: {
                    paddingHorizontal: tokens.space[2],
                    paddingVertical: 2,
                    borderRadius: tokens.radius.pill,
                    backgroundColor: 'rgba(95, 135, 255, 0.15)',
                  },
                },
                h(Text, { variant: 'xs', tone: 'accent', children: service }),
              ),
            ),
            ...(entry.services ?? []).map((service) =>
              h(
                native.View as never,
                {
                  key: `requires:${service}`,
                  style: {
                    paddingHorizontal: tokens.space[2],
                    paddingVertical: 2,
                    borderRadius: tokens.radius.pill,
                    backgroundColor: p.bg.overlay,
                  },
                },
                h(Text, { variant: 'xs', tone: 'muted', children: service }),
              ),
            ),
          ],
        )
      : null,
    entry.kind === 'plugin' && entry.minAppVersion && blockedReason
      ? h(Text, { variant: 'xs', tone: 'error', children: blockedReason })
      : null,
    // The update-available chip.
    isUpdate && latestVersion
      ? h(
          native.View as never,
          {
            key: 'latest-chip',
            testID: `registry-latest-version-${entry.id}`,
            style: {
              alignSelf: 'flex-start',
              paddingHorizontal: tokens.space[2],
              paddingVertical: 2,
              borderRadius: tokens.radius.pill,
              backgroundColor: 'rgba(95, 135, 255, 0.15)',
            },
          },
          h(Text, { variant: 'xs', tone: 'accent' }, `${t('registry:registryEntry.latestVersion')}: v${normalizeVersion(latestVersion)}`),
        )
      : null,
    // Action row: uninstall (left) · primary action (right).
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[2], flexWrap: 'wrap', marginTop: tokens.space[1] } },
      uninstall && uninstall.available
        ? uninstallArmed
          ? h(
              native.View as never,
              { key: 'uninstall-armed', style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1], flexWrap: 'wrap', flex: 1 } },
              h(Text, { variant: 'xs', tone: 'muted', children: t('registry:registryEntry.uninstallThis') }),
              h(PillButton, {
                testID: `registry-uninstall-confirm-${entry.id}`,
                label: uninstallBusy ? t('registry:registryEntry.uninstalling') : t('registry:registryEntry.confirmUninstall'),
                tone: 'danger',
                disabled: uninstallBusy,
                onPress: () => {
                  setUninstallArmed(false)
                  uninstall.onConfirm()
                },
              }),
              h(PillButton, {
                testID: `registry-uninstall-cancel-${entry.id}`,
                label: t('app:common.cancel'),
                tone: 'ghost',
                disabled: uninstallBusy,
                onPress: () => setUninstallArmed(false),
              }),
            )
          : h(PillButton, {
              key: 'uninstall',
              testID: `registry-uninstall-${entry.id}`,
              label: uninstallBusy ? t('registry:registryEntry.uninstalling') : t('registry:registryEntry.uninstall'),
              tone: 'ghost',
              disabled: uninstallBusy,
              onPress: () => setUninstallArmed(true),
            })
        : uninstall && !uninstall.available
          ? h(
              native.View as never,
              { key: 'uninstall-note', testID: `registry-uninstall-note-${entry.id}` },
              h(Text, { variant: 'xs', tone: 'muted', children: t('registry:registryEntry.uninstallFromPluginManagement') }),
            )
          : h(native.View as never, { key: 'uninstall-spacer', style: { flex: 1 } }),
      isInstalledExtension
        ? isUpdate
          ? h(PillButton, {
              key: 'update',
              testID: `registry-action-${entry.id}`,
              label: busy ? t('registry:registryEntry.updating') : t('registry:registryEntry.update'),
              tone: 'primary',
              disabled: busy,
              onPress: onAction,
            })
          : isTheme
            ? h(PillButton, {
                key: 'theme-toggle',
                testID: `registry-action-${entry.id}`,
                label: themeActive ? t('registry:registryEntry.inUse') : t('registry:registryEntry.use'),
                tone: themeActive ? 'ghost' : 'primary',
                disabled: themeActive,
                onPress: onApplyTheme ?? (() => {}),
              })
            : h(PillButton, {
                key: 'enable-toggle',
                testID: `registry-action-${entry.id}`,
                label: itemEnabled === false ? t('registry:registryEntry.use') : t('registry:registryEntry.disable'),
                tone: itemEnabled === false ? 'primary' : 'ghost',
                onPress: onToggleEnabled ?? (() => {}),
              })
        : h(PillButton, {
            key: 'action',
            testID: `registry-action-${entry.id}`,
            label: busy
              ? isUpdate
                ? t('registry:registryEntry.updating')
                : t('registry:registryEntry.installing')
              : actionLabel(t, actionState),
            tone: installed || blockedReason ? 'ghost' : 'primary',
            disabled,
            onPress: onAction,
          }),
    ),
  )
}

/** The card's pill button — a thin local wrapper over the kit's `Button`. */
function PillButton(props: {
  testID?: string
  label: string
  tone: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  onPress: () => void
}): ReactElement {
  return h(
    Button,
    {
      testID: props.testID,
      variant: props.tone === 'danger' ? 'danger' : props.tone === 'ghost' ? 'secondary' : 'primary',
      disabled: props.disabled,
      onPress: props.onPress,
      children: props.label,
    },
  )
}
