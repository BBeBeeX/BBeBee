/**
 * System logs (Discover) — the mobile transcription of the desktop twin's
 * `LogsScreen`. Same data (the `logBuffer` service's ring buffer, polled
 * every second), same level filter and content search, newest first; the
 * copy-to-clipboard affordance stays desktop-only — a phone has no clipboard
 * bridge wired here.
 */

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { LogLevel, LogRecord } from '@BBeBee/protocol'
import { Button, EmptyState, List, Text, TextField, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

interface LogBufferService {
  all: readonly LogRecord[]
  clear(): void
  toNdjson(): string
}

const LEVELS: readonly ('all' | LogLevel)[] = ['all', 'debug', 'info', 'warn', 'error']

export function LogsScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [records, setRecords] = useState<readonly LogRecord[]>([])
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Poll log buffer every 1000ms — the desktop twin's cadence.
  useEffect(() => {
    const fetchLogs = () => {
      const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
      if (buffer) {
        setRecords([...buffer.all])
      }
    }
    fetchLogs()
    const timer = setInterval(fetchLogs, 1000)
    return () => clearInterval(timer)
  }, [ctx])

  const filtered = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return records
      .filter((rec) => {
        if (levelFilter !== 'all' && rec.level !== levelFilter) return false
        if (search) {
          return rec.message.toLowerCase().includes(search) || rec.scope.toLowerCase().includes(search)
        }
        return true
      })
      .slice(-300)
      .reverse()
  }, [records, levelFilter, searchTerm])

  const handleClear = () => {
    serviceOf<LogBufferService>(ctx, 'logBuffer')?.clear?.()
    setRecords([])
  }

  const levelColor = (level: LogLevel): string =>
    level === 'error'
      ? c().state.error
      : level === 'warn'
        ? c().state.warn
        : level === 'debug'
          ? c().text.disabled
          : c().text.secondary

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(Text, { variant: 'xl' }, t('settings:logs.title')),
    h(
      Text,
      { variant: 'xs', tone: 'muted' },
      t('settings:logs.recordsBuffered', { records: records.length, filtered: filtered.length }),
    ),
    h(TextField, {
      value: searchTerm,
      onChange: setSearchTerm,
      placeholder: t('settings:logs.searchLogContentModuleOr'),
      testID: 'logs-search',
    }),
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] } },
      ...LEVELS.map((level) => {
        const active = levelFilter === level
        return h(
          native.Pressable as never,
          {
            key: level,
            accessibilityRole: 'button',
            accessibilityLabel: level,
            accessibilityState: { selected: active },
            testID: `logs-level-${level}`,
            onPress: () => setLevelFilter(active && level !== 'all' ? 'all' : level),
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
            children: level,
          }),
        )
      }),
      h(Button, {
        variant: 'ghost',
        onPress: handleClear,
        testID: 'logs-clear',
        children: t('settings:logs.clearLogs'),
      }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<LogRecord>, {
        testID: 'logs-list',
        items: filtered,
        estimatedItemSize: 56,
        keyExtractor: (rec) => String(rec.sn),
        empty: h(EmptyState, {
          icon: 'clock',
          title: t('settings:logs.noMatchingRecords'),
        }),

        renderItem: (rec) =>
          h(
            native.View as never,
            { style: { paddingVertical: tokens.space[1], gap: 1 } },
            h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
              h(Text, { style: { color: levelColor(rec.level), fontSize: 11, fontWeight: '700' } }, rec.level.toUpperCase()),
              h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1 }, rec.scope),
              h(Text, { variant: 'xs', tone: 'muted' }, new Date(rec.time).toLocaleTimeString()),
            ),
            h(Text, { variant: 'sm', numberOfLines: 3, children: rec.message }),
          ),
      }),
    ),
  )
}
