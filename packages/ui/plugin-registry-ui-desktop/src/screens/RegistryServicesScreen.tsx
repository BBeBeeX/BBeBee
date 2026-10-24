/**
 * The registry screen's "Services" tab: provider choice for service keys
 * claimed by more than one installed plug-in (audit W5).
 *
 * Only one provider per key can be in effect — Cordis refuses duplicate
 * service registrations in an isolate — so this page lists every key
 * with several providers, marks the one currently in effect, and lets
 * the user switch. The choice is persisted by the plugin-manager and
 * honoured at boot. Critical keys are never switchable: if one ever
 * shows up here it renders locked, with no switch control.
 *
 * It renders embedded inside the registry screen (which owns the page
 * padding), so this root carries no chrome of its own — no double
 * padding, no nested scroll container. The settings plugins section
 * keeps its own compact panel for the same choice; this page is the
 * full, always-reachable surface for it.
 */

import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PluginManagerService, ServiceProviderInfo } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { useOptionalI18n } from '../utils/optional-i18n.js'
import { RegistryEmptyState } from '../components/RegistryEmptyState.js'
import { GHOST_BUTTON, TONE } from '../styles.js'

export interface RegistryServicesScreenProps {
  ctx: Context
}

const rowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  background: 'rgba(255, 255, 255, 0.02)',
  padding: '12px 14px',
} as const

const providerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
} as const

export function RegistryServicesScreen({ ctx }: RegistryServicesScreenProps): ReactElement {
  const { t } = useOptionalI18n(ctx)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Same refresh events the settings panel's useServiceState subscribes
  // to, wired here with the registry package's own ctx.on pattern (this
  // package does not depend on ui-core).
  const [infos, setInfos] = useState<readonly ServiceProviderInfo[]>(() => {
    const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
    return pm?.listServiceProviders?.() ?? []
  })
  useEffect(() => {
    const read = () => {
      const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
      setInfos(pm?.listServiceProviders?.() ?? [])
    }
    const offs = (
      ['plugin-manager/changed', 'plugin/loaded', 'plugin/unloaded'] as const
    ).map((event) => ctx.on(event, read))
    return () => {
      for (const off of offs) off()
    }
  }, [ctx])

  const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
  if (!pm?.listServiceProviders) {
    return h(
      'div',
      { 'data-testid': 'registry-services-screen' },
      h(RegistryEmptyState, {
        icon: 'alert',
        title: t('registry:registryServices.managerNotLoaded'),
        description: t('registry:registryServices.managerNotLoadedDescription'),
      }),
    )
  }

  if (infos.length === 0) {
    return h(
      'div',
      { 'data-testid': 'registry-services-screen' },
      h(RegistryEmptyState, {
        icon: 'plug',
        title: t('registry:registryServices.noSharedServices'),
        description: t('registry:registryServices.noSharedServicesDescription'),
      }),
    )
  }

  const handleSwitch = async (key: string, providerId: string) => {
    if (switching) return
    setError(null)
    setSwitching(key)
    try {
      await pm.setServiceProvider!(key, providerId)
    } catch (err) {
      setError(t('registry:registryServices.switchFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSwitching(null)
    }
  }

  return h(
    'div',
    { 'data-testid': 'registry-services-screen', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h(
        'div',
        { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #F5F7FF)' } },
        t('registry:registryServices.title'),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
        t('registry:registryServices.subtitle'),
      ),
    ),
    error
      ? h(
          'div',
          {
            'data-testid': 'registry-services-error',
            style: {
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid color-mix(in srgb, ${TONE.error} 55%, transparent)`,
              background: `color-mix(in srgb, ${TONE.error} 10%, transparent)`,
              color: TONE.error,
              fontSize: 12,
            },
          },
          error,
        )
      : null,
    ...infos.map((info) =>
      h(
        'div',
        { key: info.key, 'data-testid': `registry-service-row-${info.key}`, style: rowStyle },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(
            'span',
            { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #F5F7FF)' } },
            info.key,
          ),
          info.critical
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: `color-mix(in srgb, ${TONE.warning} 15%, transparent)`,
                    color: TONE.warning,
                  },
                },
                t('registry:registryServices.criticalLocked'),
              )
            : null,
        ),
        ...info.providers.map((providerId) => {
          const active = info.activeProvider === providerId
          return h(
            'div',
            { key: providerId, style: providerRowStyle },
            h(
              'span',
              {
                style: {
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: active ? 'var(--text-primary, #F5F7FF)' : 'var(--text-secondary, #C5CAD8)',
                  flex: 1,
                  minWidth: 200,
                },
              },
              providerId,
            ),
            active
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                      color: 'var(--bb-accent-on, #FFFFFF)',
                    },
                  },
                  t('registry:registryServices.activeProvider'),
                )
              : info.critical
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      'data-testid': `registry-service-switch-${info.key}-${providerId}`,
                      onClick: () => void handleSwitch(info.key, providerId),
                      disabled: switching === info.key,
                      className: 'bbreg-btn bbreg-btn-ghost',
                      style: { ...GHOST_BUTTON, opacity: switching === info.key ? 0.6 : 1 },
                    },
                    switching === info.key
                      ? t('registry:registryServices.switching')
                      : t('registry:registryServices.useProvider'),
                  ),
          )
        }),
      ),
    ),
  )
}
