/**
 * The plugin management screen, React Native — the mobile half of the
 * plugin-management surface (desktop keeps its own inside
 * `plugin-settings-ui-desktop`'s `plugins` section).
 *
 * Three things only: the list of known plugins grouped by architectural
 * layer, an enable/disable toggle per row written through the headless
 * `plugin-manager` service, and a persistent hint that on mobile the change
 * takes effect at the next launch (no `PluginLifecycleBridge` is wired here
 * — `setEnabled` persists the override and emits its events; nothing loads
 * or unloads at runtime, and the rows' state lines show exactly that).
 * Installs/uninstalls are out of scope: npm installs refuse on mobile, and
 * the registry UI owns content installs.
 *
 * All domain behaviour stays in the `plugin-manager` service — this screen
 * holds view state only, and refusals are surfaced verbatim.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PluginInfo } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'
import { Text, nativePrimitives, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { PluginRow } from '../components/PluginRow.js'
import { changesApplyAtNextLaunch } from '../i18n.js'

/**
 * The same layer grouping and order the desktop plugins section renders;
 * a group with no plugins leaves no hole.
 */
const GROUPS: readonly { systemId: string; titleKey: string }[] = [
  { systemId: 'layer-2', titleKey: 'settings:plugins.core' },
  { systemId: 'layer-3', titleKey: 'settings:plugins.logs' },
  { systemId: 'layer-4', titleKey: 'settings:plugins.features' },
  { systemId: 'layer-5', titleKey: 'settings:plugins.ui' },
]

export function PluginManagerScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const p = usePalette()
  const [error, setError] = useState<string | null>(null)

  // The service re-reads `list()` on every plugin-manager / plugin lifecycle
  // event, so the list tracks both persisted toggles and runtime reality.
  const plugins = useServiceState<readonly PluginInfo[]>(
    ctx,
    [
      'plugin-manager/enabled-changed',
      'plugin-manager/changed',
      'plugin/loaded',
      'plugin/unloaded',
      'plugin/failed',
    ],
    () => serviceOf<{ list(): readonly PluginInfo[] }>(ctx, 'plugin-manager')?.list() ?? [],
  )

  const handleToggle = (plugin: PluginInfo, enabled: boolean) => {
    setError(null)
    void serviceOf<{
      setEnabled(id: string, enabled: boolean): Promise<void>
    }>(ctx, 'plugin-manager')
      ?.setEnabled(plugin.id, enabled)
      .catch((err: unknown) => {
        // The service's refusal (critical provider, store failure) is shown
        // verbatim — never hidden, never special-cased into a friendlier lie.
        // The list needs no manual rollback: a refused setEnabled never
        // mutated the service, so the next render still reads the old flag.
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  const renderGroup = (systemId: string, title?: string) => {
    const groupPlugins = plugins.filter((plugin) => plugin.systemId === systemId)
    if (groupPlugins.length === 0) return null
    return h(
      native.View as never,
      { key: systemId, testID: `manager-group-${systemId}` },
      title
        ? h(Text, { variant: 'sm', tone: 'accent' }, title)
        : null,
      groupPlugins.map((plugin) =>
        h(PluginRow, { key: plugin.id, ctx, plugin, onToggle: handleToggle }),
      ),
    )
  }

  return h(
    native.View as never,
    {
      testID: 'plugin-manager-screen',
      style: { flex: 1, backgroundColor: p.bg.base, padding: tokens.space[4], gap: tokens.space[2] },
    },
    // Screen title + the next-launch hint (the platform's actual semantics —
    // there is no mobile lifecycle bridge, so toggles only persist).
    h(Text, { variant: 'xl', children: t('settings:settings.plugins') }),
    h(
      Text,
      { variant: 'xs', tone: 'muted', testID: 'manager-next-launch-hint' },
      changesApplyAtNextLaunch(t),
    ),
    error
      ? h(
          native.View as never,
          {
            testID: 'manager-toggle-error',
            style: {
              padding: tokens.space[2],
              borderRadius: tokens.radius.sm,
              borderWidth: 1,
              borderColor: p.state.error,
            },
          },
          h(Text, { variant: 'xs', tone: 'error', children: t('settings:pluginDetails.error', { error }) }),
        )
      : null,
    // Layer groups, desktop's order and titles.
    ...GROUPS.map((group) => renderGroup(group.systemId, t(group.titleKey))),
    plugins.length === 0
      ? h(
          Text,
          { variant: 'sm', tone: 'muted', testID: 'manager-empty' },
          t('settings:plugins.noMatchingPlugins'),
        )
      : null,
  )
}
