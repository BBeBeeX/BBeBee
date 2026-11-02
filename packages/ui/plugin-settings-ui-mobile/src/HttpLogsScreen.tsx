/**
 * Third-party source HTTP logs — the mobile transcription of the desktop
 * twin's `HttpLogsScreen`. Same data (`ctx.http.requestLog`, the transport's
 * own request journal, polled every second), same status filter and content
 * search; the expandable desktop row becomes tap-to-expand, which is the
 * platform's disclosure pattern.
 */

import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { HttpLogEntry, HttpService } from '@BBeBee/protocol'
import { EmptyState, List, Text, TextField, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

type StatusFilter = 'all' | '2xx' | '3xx' | 'error'

const FILTERS: readonly StatusFilter[] = ['all', '2xx', '3xx', 'error']

export function HttpLogsScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [entries, setEntries] = useState<readonly HttpLogEntry[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedSn, setExpandedSn] = useState<number | null>(null)

  // Poll the transport journal every 1000ms — the desktop twin's cadence.
  useEffect(() => {
    const fetchLogs = () => {
      const http = serviceOf<HttpService>(ctx, 'http')
      setEntries(http?.requestLog?.all() ?? [])
    }
    fetchLogs()
    const timer = setInterval(fetchLogs, 1000)
    return () => clearInterval(timer)
  }, [ctx])

  const filtered = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return entries
      .filter((entry) => {
        if (statusFilter === '2xx' && !(entry.status && entry.status >= 200 && entry.status < 300)) return false
        if (statusFilter === '3xx' && !(entry.status && entry.status >= 300 && entry.status < 400)) return false
        if (statusFilter === 'error' && !(entry.error || (entry.status && entry.status >= 400))) return false
        if (search) {
          return (
            entry.url.toLowerCase().includes(search) ||
            entry.method.toLowerCase().includes(search) ||
            String(entry.status ?? '').includes(search)
          )
        }
        return true
      })
      .reverse()
  }, [entries, statusFilter, searchTerm])

  const statusTone = (entry: HttpLogEntry): string =>
    entry.error || (entry.status && entry.status >= 400)
      ? c().state.error
      : entry.status && entry.status >= 300
        ? c().state.warn
        : c().state.ok

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(Text, { variant: 'xl' }, t('settings:httpLogs.title')),
    h(
      Text,
      { variant: 'xs', tone: 'muted' },
      t('settings:httpLogs.monitorsHTTPRequestsAndResponses', { captureCount: entries.length }),
    ),
    h(TextField, {
      value: searchTerm,
      onChange: setSearchTerm,
      placeholder: t('settings:httpLogs.filterByTargetURLDomain'),
      testID: 'http-logs-search',
    }),
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] } },
      ...FILTERS.map((filter) => {
        const active = statusFilter === filter
        return h(
          native.Pressable as never,
          {
            key: filter,
            accessibilityRole: 'button',
            accessibilityLabel: filter,
            accessibilityState: { selected: active },
            testID: `http-logs-filter-${filter}`,
            onPress: () => setStatusFilter(filter),
            style: {
              minHeight: 30,
              paddingHorizontal: tokens.space[3],
              borderRadius: tokens.radius.pill,
              borderWidth: 1,
              borderColor: active ? 'transparent' : c().border.subtle,
              backgroundColor: active ? c().accent.base : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          h(Text, {
            style: {
              color: active ? c().accent.on : c().text.secondary,
              fontSize: tokens.font.size.xs,
              fontWeight: tokens.font.weight.bold,
            },
            children: filter,
          }),
        )
      }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<HttpLogEntry>, {
        testID: 'http-logs-list',
        items: filtered,
        estimatedItemSize: 72,
        keyExtractor: (entry) => String(entry.sn),
        empty: h(EmptyState, {
          icon: '🌐',
          title: t('settings:httpLogs.notCaptured'),
        }),
        renderItem: (entry) => {
          const expanded = expandedSn === entry.sn
          return h(
            native.Pressable as never,
            {
              accessibilityRole: 'button',
              accessibilityLabel: `${entry.method} ${entry.url}`,
              onPress: () => setExpandedSn(expanded ? null : entry.sn),
              style: {
                paddingVertical: tokens.space[2],
                borderBottomWidth: 1,
                borderBottomColor: c().border.subtle,
                gap: 2,
              },
            },
            h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
              h(Text, { style: { fontWeight: '700', fontSize: 12 } }, entry.method),
              h(Text, { style: { color: statusTone(entry), fontSize: 12, fontWeight: '700' } }, String(entry.status ?? '—')),
              entry.durationMs !== undefined
                ? h(Text, { variant: 'xs', tone: 'muted' }, `${entry.durationMs}ms`)
                : null,
              h(Text, { variant: 'xs', tone: 'muted' }, new Date(entry.time).toLocaleTimeString()),
            ),
            h(Text, { variant: 'xs', numberOfLines: expanded ? undefined : 1, children: entry.url }),
            expanded
              ? h(
                  native.View as never,
                  { style: { gap: tokens.space[1], paddingTop: tokens.space[1] } },
                  entry.error
                    ? h(Text, {
                        variant: 'xs',
                        style: { color: c().state.error },
                        children: t('settings:httpLogs.requestFailed', { error: entry.error }),
                      })
                    : null,
                  h(Text, {
                    variant: 'xs',
                    tone: 'muted',
                    children: `${t('settings:httpLogs.requestURLDetails')}:`,
                  }),
                  ...Object.entries(entry.requestHeaders).map(([key, value]) =>
                    h(Text, { key: key, variant: 'xs', tone: 'muted', numberOfLines: 1 }, `${key}: ${value}`),
                  ),
                  entry.requestBody
                    ? h(Text, { variant: 'xs', numberOfLines: 6, children: entry.requestBody })
                    : null,
                  entry.responseBody
                    ? h(Text, {
                        variant: 'xs',
                        tone: 'muted',
                        children: t('settings:httpLogs.lengthChars', { length: entry.responseBody.length }),
                      })
                    : null,
                )
              : null,
          )
        },
      }),
    ),
  )
}
