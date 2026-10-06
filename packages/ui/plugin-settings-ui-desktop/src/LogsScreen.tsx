/**
 * Desktop Discover / System Logs Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Live in-app log viewer reading from `ctx.logBuffer`.
 */

import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { UiService, LogLevel, LogRecord } from '@BBeBee/protocol'

interface LogBufferService {
  all: readonly LogRecord[]
  clear(): void
  toNdjson(): string
}

export function LogsScreen({ ctx }: { ctx: Context }): ReactElement {
  const ui = serviceOf<UiService>(ctx, 'ui')
  const [records, setRecords] = useState<readonly LogRecord[]>([])
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [copied, setCopied] = useState(false)

  // Poll log buffer every 1000ms
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
          const inMessage = rec.message.toLowerCase().includes(search)
          const inScope = rec.scope.toLowerCase().includes(search)
          return inMessage || inScope
        }
        return true
      })
      .slice(-300) // Keep the most recent 300 records for smooth rendering
      .reverse() // Newest first
  }, [records, levelFilter, searchTerm])

  const handleClear = () => {
    const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
    buffer?.clear?.()
    setRecords([])
  }

  const handleCopy = () => {
    const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
    const text = buffer?.toNdjson?.() ?? JSON.stringify(records, null, 2)
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#0B0C10',
        color: '#E2E8F0',
        padding: '24px 32px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      },
    },
    // Top Bar
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexShrink: 0,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(Button, {
          variant: 'secondary',
          children: '← 返回调试',
          onPress: () => ui?.navigate?.('debug.view'),
        }),
        h(
          'div',
          null,
          h(
            'h1',
            {
              style: {
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
                color: '#F8FAFC',
              },
            },
            '系统日志 (Discover Logs)',
          ),
          h(
            'span',
            { style: { fontSize: 12, color: '#64748B' } },
            `共缓冲 ${records.length} 条记录，当前匹配 ${filtered.length} 条 (最新排在最前)`,
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 10 } },
        h(Button, {
          variant: 'secondary',
          children: copied ? '✓ 已复制 NDJSON' : '复制全量日志',
          onPress: handleCopy,
        }),
        h(Button, {
          variant: 'danger',
          children: '清空日志',
          onPress: handleClear,
        }),
      ),
    ),

    // Filter Controls
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
          flexShrink: 0,
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.05)',
        },
      },
      // Search box
      h('input', {
        type: 'text',
        placeholder: '搜索日志内容、模块或 Scope…',
        value: searchTerm,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value),
        style: {
          flex: 1,
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 6,
          padding: '6px 12px',
          color: '#F8FAFC',
          fontSize: 13,
          outline: 'none',
        },
      }),
      // Level Pills
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        renderLevelButton('all', '全部', levelFilter, setLevelFilter),
        renderLevelButton('info', 'INFO', levelFilter, setLevelFilter),
        renderLevelButton('warn', 'WARN', levelFilter, setLevelFilter),
        renderLevelButton('error', 'ERROR', levelFilter, setLevelFilter),
        renderLevelButton('debug', 'DEBUG', levelFilter, setLevelFilter),
      ),
    ),

    // Logs Console Container
    h(
      'div',
      {
        style: {
          flex: 1,
          overflowY: 'auto',
          background: '#060709',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: 12,
          padding: '8px 0',
        },
      },
      filtered.length === 0
        ? h(
            'div',
            {
              style: {
                padding: '40px',
                textAlign: 'center',
                color: '#64748B',
                fontSize: 13,
              },
            },
            '暂无符合条件的日志记录',
          )
        : filtered.map((rec, index) => renderLogRow(rec, index)),
    ),
  )
}

function renderLevelButton(
  level: 'all' | LogLevel,
  label: string,
  current: 'all' | LogLevel,
  onChange: (level: 'all' | LogLevel) => void,
): ReactElement {
  const active = current === level
  return h(
    'button',
    {
      key: level,
      type: 'button',
      onClick: () => onChange(level),
      style: {
        background: active ? '#7C3AED' : 'rgba(255, 255, 255, 0.05)',
        color: active ? '#FFFFFF' : '#94A3B8',
        border: 'none',
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      },
    },
    label,
  )
}

function renderLogRow(rec: LogRecord, index: number): ReactElement {
  const timeStr = new Date(rec.time).toTimeString().split(' ')[0] + '.' + String(rec.time % 1000).padStart(3, '0')
  const levelBadge = getLevelBadge(rec.level)

  return h(
    'div',
    {
      key: `${rec.sn}-${index}`,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '4px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
        lineHeight: 1.5,
        wordBreak: 'break-all',
      },
    },
    // Time
    h('span', { style: { color: '#64748B', flexShrink: 0 } }, timeStr),
    // Level
    h(
      'span',
      {
        style: {
          flexShrink: 0,
          color: levelBadge.color,
          background: levelBadge.bg,
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          minWidth: 44,
          textAlign: 'center',
        },
      },
      rec.level.toUpperCase(),
    ),
    // Scope
    h(
      'span',
      {
        style: {
          flexShrink: 0,
          color: '#A78BFA',
          fontWeight: 500,
        },
      },
      `[${rec.scope}]`,
    ),
    // Message
    h(
      'span',
      {
        style: {
          flex: 1,
          color: rec.level === 'error' ? '#FCA5A5' : rec.level === 'warn' ? '#FDE047' : '#E2E8F0',
          whiteSpace: 'pre-wrap',
        },
      },
      rec.message,
    ),
  )
}

function getLevelBadge(level: LogLevel): { color: string; bg: string } {
  switch (level) {
    case 'error':
      return { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
    case 'warn':
      return { color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' }
    case 'info':
      return { color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)' }
    case 'debug':
    default:
      return { color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.12)' }
  }
}
