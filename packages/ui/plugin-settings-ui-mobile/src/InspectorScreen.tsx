/**
 * System architecture & plugin topology (Inspector) — the mobile
 * transcription of the desktop twin's PCB canvas. The data read is the same
 * non-invasive walk over the live Cordis runtime (`ctx.registry` fibers and
 * `ctx.reflect.store` service providers); a phone renders it as the tree it
 * is — one row per plugin with the services it provides — instead of a
 * circuit board.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { EmptyState, Text, TextField, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

/** One plugin row: name, the services it provides, and its runtime state. */
interface PluginRowData {
  name: string
  services: string[]
  active: boolean
}

/**
 * The same defensive walk `plugin-inspector-ui-desktop`'s adapter performs:
 * a cordis registry can mutate during iteration, so every read is guarded.
 */
function collectPlugins(ctx: Context): PluginRowData[] {
  const serviceOwners = new Map<string, string>()
  try {
    const reflectStore = (
      ctx.reflect as unknown as { store?: Record<symbol, { name?: string; fiber?: { name?: string } }> }
    )?.store
    if (reflectStore) {
      for (const sym of Object.getOwnPropertySymbols(reflectStore)) {
        const entry = reflectStore[sym]
        if (entry?.name && entry.fiber?.name) {
          serviceOwners.set(entry.name, entry.fiber.name)
        }
      }
    }
  } catch {
    // The runtime mutated mid-read; render what was collected.
  }

  const rows: PluginRowData[] = []
  try {
    const registry = ctx.registry as unknown as {
      entries?: () => Iterable<[unknown, { name?: string; fibers?: Iterable<{ name?: string; active?: boolean }> }]>
    }
    if (typeof registry.entries !== 'function') return rows
    for (const [plugin, runtime] of registry.entries()) {
      const pObj = plugin as { name?: unknown } | null | undefined
      const name =
        (typeof pObj?.name === 'string' ? pObj.name : undefined) ?? runtime?.name ?? undefined
      if (!name) continue
      const active = Array.from(runtime?.fibers ?? []).some((fiber) => fiber.active)
      const services = Array.from(serviceOwners.entries())
        .filter(([, owner]) => owner === name)
        .map(([service]) => service)
      rows.push({ name, services, active })
    }
  } catch {
    // Same defensive fallback as the desktop adapter.
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export function InspectorScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [searchTerm, setSearchTerm] = useState('')

  const plugins = useMemo(() => collectPlugins(ctx), [ctx])
  const serviceCount = new Set(plugins.flatMap((row) => row.services)).size

  const needle = searchTerm.trim().toLowerCase()
  const filtered = needle
    ? plugins.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.services.some((service) => service.toLowerCase().includes(needle)),
      )
    : plugins

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(Text, { variant: 'xl' }, t('settings:debug.systemArchitecturePluginTopologyInspector')),
    h(
      Text,
      { variant: 'xs', tone: 'muted' },
      `${t('inspector:statusBar.plugins')} ${plugins.length} · ${t('inspector:statusBar.services')} ${serviceCount}`,
    ),
    h(TextField, {
      value: searchTerm,
      onChange: setSearchTerm,
      placeholder: t('settings:logs.searchLogContentModuleOr'),
      testID: 'inspector-search',
    }),
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      filtered.length === 0
        ? h(EmptyState, {
            icon: '🔌',
            title: t('settings:debug.inspectorDesc'),
          })
        : h(
            native.ScrollView as never,
            { style: { flex: 1 }, contentContainerStyle: { gap: tokens.space[2], paddingBottom: tokens.space[4] } },
            ...filtered.map((row) =>
              h(
                native.View as never,
                {
                  key: row.name,
                  style: {
                    padding: tokens.space[3],
                    borderRadius: tokens.radius.sm,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    borderWidth: 1,
                    borderColor: row.active ? c().accent.muted : c().border.subtle,
                    gap: tokens.space[1],
                  },
                },
                h(
                  native.View as never,
                  { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
                  h(native.View as never, {
                    style: {
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: row.active ? c().state.ok : c().text.disabled,
                    },
                  }),
                  h(Text, { variant: 'md', numberOfLines: 1, children: row.name }),
                ),
                row.services.length > 0
                  ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 2 }, row.services.join(', '))
                  : null,
              ),
            ),
          ),
    ),
  )
}
