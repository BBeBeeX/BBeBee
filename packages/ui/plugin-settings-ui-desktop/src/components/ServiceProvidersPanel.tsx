import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { PluginManagerService, ServiceProviderInfo } from '@BBeBee/protocol'

export interface ServiceProvidersPanelProps {
  ctx: Context
}

/**
 * Provider choice for replaceable service keys (audit W5): when more
 * than one installed plug-in provides the same non-critical key, only
 * one can be in effect (Cordis refuses duplicate service registrations
 * in an isolate). This panel shows the provider currently in effect
 * and lets the user switch; the choice is persisted by the
 * plugin-manager and honoured at boot. Critical keys are never
 * switchable — if one ever shows up here it renders locked.
 *
 * Renders nothing while no key has multiple providers.
 */
export function ServiceProvidersPanel({ ctx }: ServiceProvidersPanelProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const infos = useServiceState<readonly ServiceProviderInfo[]>(
    ctx,
    ['plugin-manager/changed', 'plugin/loaded', 'plugin/unloaded'],
    () => {
      const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
      return pm?.listServiceProviders?.() ?? []
    },
  )

  if (infos.length === 0) return null

  const handleSwitch = async (key: string, providerId: string) => {
    const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
    if (!pm?.setServiceProvider || switching) return
    setError(null)
    setSwitching(key)
    try {
      await pm.setServiceProvider(key, providerId)
    } catch (err) {
      setError(
        t('settings:serviceProviders.switchFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    } finally {
      setSwitching(null)
    }
  }

  return h(
    'div',
    {
      'data-testid': 'service-providers-panel',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        borderRadius: 10,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        background: 'rgba(255, 255, 255, 0.02)',
        padding: '12px 14px',
        marginBottom: 16,
      },
    },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h(
        'div',
        { style: { fontSize: 14, fontWeight: 600, color: 'var(--bb-text-primary, #F8FAFC)' } },
        t('settings:serviceProviders.title'),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--bb-text-secondary, #8E8E93)' } },
        t('settings:serviceProviders.description'),
      ),
    ),
    error
      ? h(
          'div',
          { style: { fontSize: 12, color: 'var(--state-error, #EF4444)' } },
          error,
        )
      : null,
    infos.map((info) =>
      h(
        'div',
        {
          key: info.key,
          'data-testid': `service-provider-row-${info.key}`,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.025)',
          },
        },
        h(
          'code',
          {
            style: {
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--bb-text-primary, #F8FAFC)',
              fontFamily: 'ui-monospace, monospace',
            },
          },
          info.key,
        ),
        h(
          'span',
          { style: { fontSize: 11, color: 'var(--bb-text-tertiary, #6B7280)' } },
          t('settings:serviceProviders.activeLabel'),
        ),
        info.providers.map((providerId) => {
          const isActive = providerId === info.activeProvider
          return h(Button, {
            key: providerId,
            variant: isActive ? 'primary' : 'secondary',
            disabled: isActive || info.critical || switching !== null,
            loading: switching === info.key && !isActive,
            children: providerId,
            'data-testid': `service-provider-${info.key}-${providerId}`,
            onPress: () => void handleSwitch(info.key, providerId),
          })
        }),
        info.critical
          ? h(
              'span',
              { style: { fontSize: 11, color: 'var(--bb-state-warn, #F59E0B)' } },
              t('settings:serviceProviders.criticalNote'),
            )
          : null,
      ),
    ),
  )
}
