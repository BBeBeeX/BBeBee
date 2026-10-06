/**
 * Desktop HTTP Logs Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Dedicated log viewer for outgoing third-party music source HTTP requests.
 *
 * Rows come from the transport's own request journal (`ctx.http.requestLog`),
 * which records the exchange as it happened — request headers, body, response
 * headers and the (capped, text-shaped) response body. Clicking a row expands
 * it; the previous text-line parsing remains only as a fallback for a build
 * whose transport keeps no journal.
 */

import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { HttpLogEntry, HttpService, UiService, LogRecord } from '@BBeBee/protocol'

interface LogBufferService {
  all: readonly LogRecord[]
  clear(): void
}

interface ParsedHttpLog {
  sn: number
  time: number
  method: string
  url: string
  status: number
  durationMs?: number
  raw: string
  isError: boolean
}

const HTTP_REGEX = /\[HTTP\]\s+([A-Z]+)\s+(.+?)\s+->\s+(\d+)\s+\((\d+)ms\)/

export function HttpLogsScreen({ ctx }: { ctx: Context }): ReactElement {
  const ui = serviceOf<UiService>(ctx, 'ui')
  const [entries, setEntries] = useState<readonly HttpLogEntry[]>([])
  const [records, setRecords] = useState<readonly LogRecord[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '3xx' | 'error'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedSn, setExpandedSn] = useState<number | null>(null)
  const [captureEnabled, setCaptureEnabled] = useState(true)

  // Poll the transport journal (and the text log, for the fallback) every 1000ms
  useEffect(() => {
    const fetchLogs = () => {
      const http = serviceOf<HttpService>(ctx, 'http')
      setEntries(http?.requestLog?.all() ?? [])
      const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
      if (buffer) setRecords([...buffer.all])
    }

    fetchLogs()
    const timer = setInterval(fetchLogs, 1000)
    return () => clearInterval(timer)
  }, [ctx])

  const hasJournal = useMemo(
    () => serviceOf<HttpService>(ctx, 'http')?.requestLog !== undefined,
    [ctx],
  )

  // The detail-capture switch, seeded once from the transport. The switch is
  // the user's from then on: on, requests from now on record whole; off,
  // they record the summary line only.
  useEffect(() => {
    const requestLog = serviceOf<HttpService>(ctx, 'http')?.requestLog
    if (requestLog) setCaptureEnabled(requestLog.captureEnabled())
  }, [ctx])

  const toggleCapture = () => {
    const requestLog = serviceOf<HttpService>(ctx, 'http')?.requestLog
    if (!requestLog) return
    const next = !captureEnabled
    requestLog.setCapture(next)
    setCaptureEnabled(next)
  }

  // Structured rows from the journal, newest first.
  const journalRows = useMemo(() => [...entries].reverse(), [entries])

  // Fallback rows parsed from the text log, when there is no journal.
  const parsedLogs = useMemo<ParsedHttpLog[]>(() => {
    const out: ParsedHttpLog[] = []
    for (const rec of records) {
      const match = HTTP_REGEX.exec(rec.message)
      if (match) {
        const [, method, url, statusStr, durationStr] = match
        const status = parseInt(statusStr ?? '0', 10)
        out.push({
          sn: rec.sn,
          time: rec.time,
          method: method ?? 'GET',
          url: url ?? '',
          status,
          durationMs: parseInt(durationStr ?? '0', 10),
          raw: rec.message,
          isError: status >= 400 || rec.level === 'error',
        })
      } else if (
        rec.scope === 'source-runtime' ||
        rec.scope === 'http' ||
        rec.message.toLowerCase().includes('http') ||
        rec.message.includes('source-runtime')
      ) {
        out.push({
          sn: rec.sn,
          time: rec.time,
          method: rec.scope.toUpperCase(),
          url: rec.message,
          status: rec.level === 'error' ? 500 : rec.level === 'warn' ? 400 : 200,
          raw: rec.message,
          isError: rec.level === 'error' || rec.level === 'warn',
        })
      }
    }
    return out.reverse() // Newest first
  }, [records])

  const filteredJournal = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return journalRows.filter((entry) => {
      const status = entry.status ?? 0
      if (statusFilter === '2xx' && (status < 200 || status >= 300)) return false
      if (statusFilter === '3xx' && (status < 300 || status >= 400)) return false
      if (statusFilter === 'error' && status < 400 && !entry.error) return false
      if (search) {
        return (
          entry.url.toLowerCase().includes(search) ||
          entry.method.toLowerCase().includes(search)
        )
      }
      return true
    })
  }, [journalRows, statusFilter, searchTerm])

  const filteredFallback = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return parsedLogs.filter((item) => {
      if (statusFilter === '2xx' && (item.status < 200 || item.status >= 300)) return false
      if (statusFilter === '3xx' && (item.status < 300 || item.status >= 400)) return false
      if (statusFilter === 'error' && item.status < 400 && !item.isError) return false
      if (search) {
        return item.url.toLowerCase().includes(search) || item.method.toLowerCase().includes(search)
      }
      return true
    })
  }, [parsedLogs, statusFilter, searchTerm])

  const handleClear = () => {
    const http = serviceOf<HttpService>(ctx, 'http')
    http?.requestLog?.clear()
    const buffer = serviceOf<LogBufferService>(ctx, 'logBuffer')
    buffer?.clear?.()
    setEntries([])
    setRecords([])
    setExpandedSn(null)
  }

  const rowCount = hasJournal ? filteredJournal.length : filteredFallback.length
  const captureCount = hasJournal ? journalRows.length : httpLogsFallbackCount(parsedLogs)

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
            '第三方源 HTTP 日志 (HTTP Logs)',
          ),
          h(
            'span',
            { style: { fontSize: 12, color: '#64748B' } },
            `监控第三方音乐源发起的 HTTP 请求与响应，共捕获 ${captureCount} 条网络记录` +
              (hasJournal
                ? captureEnabled
                  ? '，点击行可展开请求头与响应详情'
                  : '，详情记录已关闭，新请求仅记摘要行'
                : ''),
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        hasJournal ? renderCaptureSwitch(captureEnabled, toggleCapture) : null,
        h(Button, {
          variant: 'danger',
          children: '清空日志',
          onPress: handleClear,
        }),
      ),
    ),

    // Filters
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
      // Search input
      h('input', {
        type: 'text',
        placeholder: '过滤目标 URL、域名或请求路径…',
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
      // Status Filter Pills
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        renderFilterBtn('all', '全部', statusFilter, setStatusFilter),
        renderFilterBtn('2xx', '2xx 成功', statusFilter, setStatusFilter),
        renderFilterBtn('3xx', '3xx 重定向', statusFilter, setStatusFilter),
        renderFilterBtn('error', '异常 / 4xx / 5xx', statusFilter, setStatusFilter),
      ),
    ),

    // HTTP Requests Table / List
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
        },
      },
      rowCount === 0
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
            '暂无第三方源发起的 HTTP 请求记录',
          )
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column' } },
            // Table Header
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 16px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#94A3B8',
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                },
              },
              h('span', { style: { width: 32 } }, ''),
              h('span', { style: { width: 100 } }, '时间'),
              h('span', { style: { width: 64 } }, '方法'),
              h('span', { style: { width: 64 } }, '状态码'),
              h('span', { style: { width: 80 } }, '耗时'),
              h('span', { style: { flex: 1 } }, '请求地址 (URL) / 详情'),
            ),
            hasJournal
              ? filteredJournal.map((entry) =>
                  renderJournalRow(
                    entry,
                    // Expandable only when the exchange was recorded with
                    // its details: a summary-only row has nothing behind it.
                    entry.detailed && expandedSn === entry.sn,
                    entry.detailed
                      ? () =>
                          setExpandedSn((prev) => (prev === entry.sn ? null : entry.sn))
                      : undefined,
                  ),
                )
              : filteredFallback.map((item) => renderHttpRow(item)),
          ),
    ),
  )
}

function httpLogsFallbackCount(rows: readonly ParsedHttpLog[]): number {
  return rows.length
}

function statusColorOf(status: number): string {
  if (status >= 200 && status < 300) return '#4ADE80'
  if (status >= 300 && status < 400) return '#FACC15'
  return '#F87171'
}

function methodColorOf(method: string): string {
  if (method === 'GET') return '#38BDF8'
  if (method === 'POST') return '#A78BFA'
  if (method === 'HEAD') return '#F472B6'
  return '#94A3B8'
}

function timeStrOf(time: number): string {
  return new Date(time).toTimeString().split(' ')[0] + '.' + String(time % 1000).padStart(3, '0')
}

/** One journal row: the summary line, plus the expandable detail when open. */
function renderJournalRow(
  entry: HttpLogEntry,
  expanded: boolean,
  onToggle: (() => void) | undefined,
): ReactElement {
  const timeStr = timeStrOf(entry.time)
  const statusColor = entry.status === undefined ? '#F87171' : statusColorOf(entry.status)
  const expandable = onToggle !== undefined

  return h(
    'div',
    { key: entry.sn, style: { borderBottom: '1px solid rgba(255, 255, 255, 0.02)' } },
    h(
      'div',
      {
        onClick: onToggle,
        role: expandable ? 'button' : undefined,
        'aria-expanded': expandable ? expanded : undefined,
        style: {
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          lineHeight: 1.4,
          cursor: expandable ? 'pointer' : 'default',
          background: expanded ? 'rgba(124, 58, 237, 0.08)' : 'transparent',
        },
      },
      h(
        'span',
        { style: { width: 32, color: '#475569', flexShrink: 0, fontSize: 10 } },
        expandable ? (expanded ? '▾' : '▸') : '',
      ),
      h('span', { style: { width: 100, color: '#64748B', flexShrink: 0 } }, timeStr),
      h(
        'span',
        {
          style: {
            width: 64,
            color: methodColorOf(entry.method),
            fontWeight: 700,
            fontSize: 11,
            flexShrink: 0,
          },
        },
        entry.method,
      ),
      h(
        'span',
        {
          style: {
            width: 64,
            color: statusColor,
            fontWeight: 700,
            fontSize: 11,
            flexShrink: 0,
          },
        },
        entry.status !== undefined ? String(entry.status) : 'ERR',
      ),
      h(
        'span',
        { style: { width: 80, color: '#94A3B8', fontSize: 11, flexShrink: 0 } },
        entry.durationMs !== undefined ? `${entry.durationMs}ms` : '-',
      ),
      h(
        'span',
        {
          style: {
            flex: 1,
            color: entry.error ? '#F87171' : '#F8FAFC',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          title: entry.url,
        },
        entry.error ? `${entry.url} — ${entry.error}` : entry.url,
      ),
    ),
    expanded ? renderJournalDetail(entry) : null,
  )
}

const DETAIL_LABEL_WIDTH = 110

function renderHeaderTable(headers: Record<string, string>): ReactElement {
  const names = Object.keys(headers)
  if (names.length === 0) {
    return h('div', { style: { color: '#64748B', padding: '4px 0' } }, '（无）')
  }
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
    ...names.map((name) =>
      h(
        'div',
        { key: name, style: { display: 'flex', gap: 8 } },
        h('span', { style: { width: DETAIL_LABEL_WIDTH, color: '#7DD3FC', flexShrink: 0 } }, name),
        h(
          'span',
          { style: { color: '#CBD5E1', wordBreak: 'break-all', whiteSpace: 'pre-wrap' } },
          headers[name],
        ),
      ),
    ),
  )
}

function renderBodyBlock(body: string | undefined, label: string): ReactElement {
  if (body === undefined) {
    return h('div', { style: { color: '#64748B', padding: '4px 0' } }, '（未捕获）')
  }
  let text = body
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // Not JSON after all — the raw text is the honest answer.
    }
  }
  return h(
    'pre',
    {
      style: {
        margin: 0,
        padding: 10,
        background: 'rgba(0, 0, 0, 0.35)',
        borderRadius: 6,
        border: '1px solid rgba(255, 255, 255, 0.06)',
        color: '#CBD5E1',
        fontSize: 11,
        maxHeight: 320,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
    },
    `${label}\n${text}`,
  )
}

function detailSection(title: string, content: ReactElement): ReactElement {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    h(
      'div',
      {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: '#94A3B8',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        },
      },
      title,
    ),
    content,
  )
}

/** The expanded half of a journal row: request, then response, each whole. */
function renderJournalDetail(entry: HttpLogEntry): ReactElement {
  return h(
    'div',
    {
      style: {
        padding: '10px 16px 14px 48px',
        background: 'rgba(0, 0, 0, 0.25)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 11,
      },
    },
    entry.error
      ? h(
          'div',
          { style: { color: '#F87171' } },
          `请求失败：${entry.error}`,
        )
      : null,
    detailSection('请求头 (Request Headers)', renderHeaderTable(entry.requestHeaders)),
    detailSection(
      '请求体 (Request Body)',
      renderBodyBlock(entry.requestBody, entry.requestBody ? `长度 ${entry.requestBody.length} 字符` : ''),
    ),
    detailSection('响应头 (Response Headers)', renderHeaderTable(entry.responseHeaders)),
    detailSection(
      '响应体 (Response Body)',
      renderBodyBlock(
        entry.responseBody,
        entry.responseBody ? `长度 ${entry.responseBody.length} 字符` : '',
      ),
    ),
  )
}

function renderFilterBtn(
  val: 'all' | '2xx' | '3xx' | 'error',
  label: string,
  current: 'all' | '2xx' | '3xx' | 'error',
  onChange: (val: 'all' | '2xx' | '3xx' | 'error') => void,
): ReactElement {
  const active = current === val
  return h(
    'button',
    {
      key: val,
      type: 'button',
      onClick: () => onChange(val),
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

/**
 * The detail-capture switch. On (default): every exchange is recorded whole
 * and its row expands. Off: new rows record the summary line only and show
 * no chevron — there is nothing behind them to expand onto.
 */
function renderCaptureSwitch(enabled: boolean, onToggle: () => void): ReactElement {
  return h(
    'label',
    {
      'data-testid': 'http-log-capture-switch',
      onClick: onToggle,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 12,
        color: '#CBD5E1',
      },
      title: enabled
        ? '记录请求头与响应详情；关闭后新请求仅记摘要行'
        : '当前仅记摘要行；开启后新请求记录完整头与体',
    },
    h(
      'span',
      {
        style: {
          position: 'relative',
          width: 36,
          height: 20,
          borderRadius: 10,
          background: enabled ? '#7C3AED' : 'rgba(255, 255, 255, 0.15)',
          transition: 'background 0.15s ease',
          flexShrink: 0,
        },
      },
      h('span', {
        style: {
          position: 'absolute',
          top: 2,
          left: enabled ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#FFFFFF',
          transition: 'left 0.15s ease',
        },
      }),
    ),
    h('span', null, '记录详情'),
  )
}

/** The pre-journal row: a parsed text line, kept for builds without a journal. */
function renderHttpRow(item: ParsedHttpLog): ReactElement {
  const timeStr = timeStrOf(item.time)
  const statusColor = statusColorOf(item.status)
  const methodColor = methodColorOf(item.method)

  return h(
    'div',
    {
      key: `${item.sn}-${item.time}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
        lineHeight: 1.4,
      },
    },
    h('span', { style: { width: 100, color: '#64748B', flexShrink: 0 } }, timeStr),
    h(
      'span',
      {
        style: {
          width: 64,
          color: methodColor,
          fontWeight: 700,
          fontSize: 11,
          flexShrink: 0,
        },
      },
      item.method,
    ),
    h(
      'span',
      {
        style: {
          width: 64,
          color: statusColor,
          fontWeight: 700,
          fontSize: 11,
          flexShrink: 0,
        },
      },
      item.status ? String(item.status) : 'ERR',
    ),
    h(
      'span',
      { style: { width: 80, color: '#94A3B8', fontSize: 11, flexShrink: 0 } },
      item.durationMs !== undefined ? `${item.durationMs}ms` : '-',
    ),
    h(
      'span',
      {
        style: {
          flex: 1,
          color: '#F8FAFC',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
        title: item.raw,
      },
      item.url,
    ),
  )
}
