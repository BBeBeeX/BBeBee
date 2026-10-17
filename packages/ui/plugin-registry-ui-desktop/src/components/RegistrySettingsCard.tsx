/**
 * The registry settings card ("Registry & updates"), rendered inside Settings → sources.
 *
 * Three things only: when the last check ran, the auto-check toggle (written
 * to the settings document), and a manual check whose result is listed inline
 * and navigates to the registry screen. All domain behaviour stays in the
 * `contentRegistry` service — this card holds view state only.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, RegistryUpdate } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Switch, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { REGISTRY_VIEWS } from '@BBeBee/plugin-registry/views'
import { formatDateTime } from '../utils/format.js'

interface RegistryServiceLike {
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  lastCheckedAt?(): number | undefined
}

interface SettingsServiceLike {
  getSync(): AppSettings
  update(patch: Partial<AppSettings>): Promise<unknown>
}

const rowLabelStyle = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F7FF)' } as const
const rowDescStyle = {
  fontSize: 12,
  color: 'var(--text-secondary, #C5CAD8)',
  lineHeight: 1.45,
} as const

export function RegistrySettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const registry = serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')
  const settings = serviceOf<SettingsServiceLike>(ctx, 'settings')

  const [lastCheckedAt, setLastCheckedAt] = useState<number | undefined>(() => registry?.lastCheckedAt?.())
  const [autoCheck, setAutoCheck] = useState<boolean>(() => settings?.getSync().registryAutoCheck !== false)
  const [checking, setChecking] = useState(false)
  const [updates, setUpdates] = useState<readonly RegistryUpdate[]>(() => {
    const svc = serviceOf<RegistryServiceLike & { updates?: () => readonly RegistryUpdate[] }>(
      ctx,
      'contentRegistry',
    )
    return svc?.updates?.() ?? []
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // ⚠️ `serviceOf` answers a fresh proxy per call, so services are read
    // inside the effect, keyed on `ctx` — never put one in a dep array.
    const readRegistry = () => serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')
    const syncSettings = (s: AppSettings) => setAutoCheck(s.registryAutoCheck !== false)
    const offSettings = ctx.on('settings/changed', syncSettings)
    const offUpdates = ctx.on('registry/updates-available', (list: readonly RegistryUpdate[]) => {
      setUpdates(list)
      setLastCheckedAt(readRegistry()?.lastCheckedAt?.())
    })
    return () => {
      offSettings()
      offUpdates()
    }
  }, [ctx])

  const toggleAutoCheck = (value: boolean) => {
    setAutoCheck(value)
    void settings?.update({ registryAutoCheck: value })
  }

  const runCheck = async () => {
    if (checking) return
    const svc = serviceOf<RegistryServiceLike>(ctx, 'contentRegistry')
    if (!svc) return
    setChecking(true)
    setError(null)
    try {
      const result = await svc.checkUpdates()
      setUpdates(result)
      setLastCheckedAt(svc.lastCheckedAt?.())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }

  const navigateToScreen = () => {
    const ui = serviceOf<{ navigate(id: string, params?: Record<string, unknown>): void }>(ctx, 'ui')
    ui?.navigate?.(REGISTRY_VIEWS.screen)
  }

  return h(
    'div',
    { 'data-testid': 'registry-settings-card', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 4px' } },
    // Last check + manual check
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: rowLabelStyle }, t('registry:registrySettings.lastChecked')),
        h('div', { 'data-testid': 'registry-last-checked', style: rowDescStyle }, formatDateTime(lastCheckedAt)),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'registry-check-updates',
          onClick: () => void runCheck(),
          disabled: checking || !registry,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
            color: 'var(--bb-accent-on, #FFFFFF)',
            fontWeight: 600,
            fontSize: 13,
            cursor: checking ? 'default' : 'pointer',
            opacity: checking ? 0.75 : 1,
          },
        },
        tablerIcon('download', { size: 14 }),
        checking ? t('registry:registrySettings.checking') : t('registry:registrySettings.checkUpdates'),
      ),
    ),
    // Auto-check toggle
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 } },
        h('div', { style: rowLabelStyle }, t('registry:registrySettings.dailyAutoCheck')),
        h('div', { style: rowDescStyle }, t('registry:registrySettings.checksForCommunityContentUpdates')),
      ),
      h(Switch, {
        checked: autoCheck,
        onChange: toggleAutoCheck,
        accessibilityLabel: t('registry:registrySettings.dailyAutoCheck'),
      }),
    ),
    error
      ? h(
          'div',
          {
            'data-testid': 'registry-check-error',
            style: {
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-error, #F43F5E)',
              color: 'var(--color-error, #F43F5E)',
              fontSize: 13,
            },
          },
          error,
        )
      : null,
    // Update list
    updates.length > 0
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: rowLabelStyle }, t('registry:registrySettings.updatesAvailableCount', { count: updates.length })),
          updates.map((update) =>
            h(
              'button',
              {
                key: `${update.kind}:${update.id}`,
                type: 'button',
                'data-testid': `registry-update-item-${update.id}`,
                onClick: navigateToScreen,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
                  color: 'var(--text-primary, #F5F7FF)',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                },
              },
              update.builtin ? h('span', { style: rowDescStyle }, t('registry:registrySettings.builtIn')) : null,
              h('span', { style: { fontWeight: 600 } }, update.name),
              h(
                'span',
                { style: rowDescStyle },
                `${update.installedVersion} → ${update.availableVersion}`,
              ),
              h('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, tablerIcon('chevron-right', { size: 14 })),
            ),
          ),
        )
      : h(
          'div',
          { 'data-testid': 'registry-updates-empty', style: rowDescStyle },
          t('registry:registrySettings.everythingIsUpToDate'),
        ),
  )
}
