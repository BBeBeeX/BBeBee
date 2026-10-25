/**
 * One plugin row: display name, version/layer/domain detail line, the
 * runtime-state traffic light, and the enable/disable switch.
 *
 * The row is deliberately honest about mobile semantics: the switch shows
 * the PERSISTED flag (what the next launch will honour) while the state line
 * shows the REAL runtime state — a plugin that is still running after being
 * disabled reads "Not enabled" next to its live state instead of hiding the
 * fact. Critical-service providers render a locked, dimmed switch with the
 * refusal reason, mirroring the service's `CRITICAL_PROVIDER` refusal for
 * non-UI callers.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { I18nService, PluginInfo, PluginRuntimeState } from '@BBeBee/protocol'
import { criticalServiceKeysOfProvider } from '@BBeBee/protocol'
import { Text, nativePrimitives, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { Switch } from './Switch.js'

/** Localized runtime-state labels — the desktop `PluginDetails` spelling. */
export function formatRuntimeState(state: PluginRuntimeState, t: I18nService['t']): string {
  switch (state) {
    case 'ACTIVE':
      return t('settings:pluginDetails.stateActive')
    case 'PENDING':
      return t('settings:pluginDetails.statePending')
    case 'LOADING':
      return t('settings:pluginDetails.stateLoading')
    case 'FAILED':
      return t('settings:pluginDetails.stateFailed')
    case 'DISPOSED':
      return t('settings:pluginDetails.stateDisposed')
    case 'UNLOADING':
      return t('settings:pluginDetails.stateUnloading')
    case 'UNLOADED':
      return t('settings:pluginDetails.stateUnloaded')
    default:
      return `${state}`
  }
}

export function PluginRow(props: {
  ctx: Context
  plugin: PluginInfo
  onToggle: (plugin: PluginInfo, enabled: boolean) => void
}): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(props.ctx)
  const p = usePalette()

  const { plugin } = props
  const criticalKeys = criticalServiceKeysOfProvider(plugin.id)
  const criticalLocked = criticalKeys.length > 0
  const stateLabel = formatRuntimeState(plugin.state, t)
  const detailBits = [
    plugin.version,
    plugin.systemId,
    ...(plugin.moduleId ? [plugin.moduleId] : []),
    ...(
      // Direct dependencies at a glance — the cheap read-only detail.
      plugin.dependencies.length > 0
        ? [t('settings:pluginDetails.dependenciesCount', { count: plugin.dependencies.length })]
        : []
    ),
  ]

  return h(
    native.View as never,
    {
      testID: `manager-plugin-${plugin.id}`,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.space[3],
        paddingVertical: tokens.space[2],
        borderBottomWidth: 1,
        borderBottomColor: p.border.subtle,
      },
    },
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0, gap: 2, opacity: plugin.enabled ? 1 : 0.65 } },
      h(Text, { variant: 'md', children: plugin.displayName }),
      h(
        Text,
        { variant: 'xs', tone: 'muted', numberOfLines: 1 },
        detailBits.join(' · '),
      ),
      // Persisted flag first, real runtime state second: the pair makes the
      // "disabled but still running until next launch" case self-explaining.
      h(Text, {
        variant: 'xs',
        tone: plugin.enabled ? 'default' : 'muted',
        testID: `manager-plugin-state-${plugin.id}`,
        children: plugin.enabled
          ? t('settings:pluginTrafficLight.enabled', { state: stateLabel })
          : t('settings:pluginTrafficLight.notEnabled'),
      }),
      // A service refusal (critical provider) or a failed fiber surfaces verbatim.
      criticalLocked
        ? h(
            Text,
            { variant: 'xs', tone: 'warn', testID: `manager-plugin-locked-${plugin.id}` },
            t('settings:pluginDetails.criticalProviderLocked', { services: criticalKeys.join(', ') }),
          )
        : null,
      plugin.error
        ? h(
            Text,
            { variant: 'xs', tone: 'error', testID: `manager-plugin-error-${plugin.id}` },
            t('settings:pluginDetails.error', { error: plugin.error }),
          )
        : null,
    ),
    h(Switch, {
      checked: plugin.enabled,
      disabled: criticalLocked,
      testID: `manager-toggle-${plugin.id}`,
      accessibilityLabel: t('settings:pluginDetails.togglePluginEnabledState', {
        displayName: plugin.displayName,
      }),
      onChange: (checked) => props.onToggle(plugin, checked),
    }),
  )
}
