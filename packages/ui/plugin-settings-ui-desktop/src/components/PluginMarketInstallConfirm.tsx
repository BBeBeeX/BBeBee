import { Button, Sheet, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { InstallPlan, RegistryPluginEntry } from '@BBeBee/protocol'

export interface PluginMarketInstallConfirmProps {
  ctx: Context
  entry: RegistryPluginEntry
  plan: InstallPlan
  confirming: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Shows the resolved install plan (exact version, dependency closure,
 * missing-service blockers, warnings) and requires explicit confirmation
 * before any download starts.
 */
export function PluginMarketInstallConfirm({
  ctx,
  entry,
  plan,
  confirming,
  onClose,
  onConfirm,
}: PluginMarketInstallConfirmProps): ReactElement {
  const { t } = useI18n(ctx)
  const blocked = plan.missingServices.length > 0
  return h(
    Sheet,
    {
      open: true,
      onClose,
      title: t('settings:pluginMarket.installPlanTitle'),
      accessibilityLabel: t('settings:pluginMarket.installPlanTitle'),
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflowY: 'auto',
          fontSize: 13,
          color: 'var(--bb-text-primary, #F8FAFC)',
        },
      },
      h(
        'div',
        { style: { fontSize: 14, fontWeight: 600 } },
        `${entry.name} — ${plan.target.npm}@${plan.target.version}`,
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h(
          'div',
          { style: { fontSize: 12, fontWeight: 600, color: 'var(--bb-text-secondary, #8E8E93)' } },
          t('settings:pluginMarket.planIncludesDeps'),
        ),
        plan.closure.length > 0
          ? h(
              'ul',
              { style: { margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.6 } },
              plan.closure.map((node) =>
                h('li', { key: node.id }, `${node.npm}@${node.version}`),
              ),
            )
          : h(
              'div',
              { style: { fontSize: 12, color: 'var(--bb-text-secondary, #8E8E93)' } },
              t('settings:pluginMarket.noExtraDeps'),
            ),
      ),
      blocked
        ? h(
            'div',
            {
              role: 'alert',
              style: {
                fontSize: 12,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--state-error, #EF4444)',
                lineHeight: 1.5,
              },
            },
            h(
              'div',
              { style: { fontWeight: 600, marginBottom: 4 } },
              t('settings:pluginMarket.missingServicesTitle'),
            ),
            t('settings:pluginMarket.missingServicesDesc', {
              services: plan.missingServices.join(', '),
            }),
          )
        : null,
      plan.warnings.length > 0
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(
              'div',
              { style: { fontSize: 12, fontWeight: 600, color: 'var(--bb-state-warn, #F59E0B)' } },
              t('settings:pluginMarket.warningsTitle'),
            ),
            h(
              'ul',
              {
                style: {
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'var(--bb-text-secondary, #8E8E93)',
                },
              },
              plan.warnings.map((w, i) => h('li', { key: i }, w)),
            ),
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 } },
        h(Button, {
          variant: 'secondary',
          disabled: confirming,
          children: t('app:common.cancel'),
          onPress: onClose,
        }),
        h(Button, {
          variant: 'primary',
          disabled: blocked || confirming,
          loading: confirming,
          children: t('settings:pluginMarket.confirmInstall'),
          onPress: onConfirm,
        }),
      ),
    ),
  )
}
