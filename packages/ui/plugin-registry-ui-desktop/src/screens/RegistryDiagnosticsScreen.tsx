/**
 * The registry diagnostics screen ("诊断"): a health report of the content
 * registry, assembled by the headless service from real state — lock/integrity
 * conflicts, persisted security-audit findings, index anomalies and install
 * summaries. The screen only renders it.
 *
 * It renders embedded inside the 发现 screen (which owns the page padding),
 * so this root carries no chrome of its own — no double padding, no nested
 * scroll container.
 *
 * Four groups render in descending severity: 冲突 (red) → 风险 (amber) →
 * 警告 (amber, quieter treatment) → 信息 (neutral). The token set has one
 * warm semantic color, so the red→amber→neutral hierarchy is expressed by
 * intensity as well as hue: conflict and risk carry a severity accent bar and
 * tinted count badges; warnings are outlined only; info stays on surfaces.
 * Items carrying an `entryId` offer a 查看 jump through `onNavigateToEntry`;
 * the risk group offers a one-click rescan that re-runs the security scan for
 * every risky entry. The orchestrator wires this screen into the shell — the
 * route contribution lives elsewhere.
 */

import { createElement as h, useCallback, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { RegistryDiagnosticGroup, RegistryDiagnosticItem, RegistryEntryKind } from '@BBeBee/protocol'
import { useDiagnostics } from '../hooks/use-diagnostics.js'
import { GHOST_BUTTON, PILL_BASE, TONE, WARNING_BANNER } from '../styles.js'

export interface RegistryDiagnosticsScreenProps {
  ctx: Context
  /** Jump to a registry entry (typically back into the 发现 screen with the entry highlighted). */
  onNavigateToEntry?: (entryId: string, kind: RegistryEntryKind) => void
}

/** Severity weight, for the intensity ladder: 2 = accent bar + tint, 1 = outline, 0 = neutral. */
type Severity = 2 | 1 | 0

const GROUP_ORDER: readonly {
  group: RegistryDiagnosticGroup
  label: string
  empty: string
  color: string
  severity: Severity
}[] = [
  { group: 'conflict', label: '冲突', empty: '暂无冲突', color: TONE.error, severity: 2 },
  { group: 'risk', label: '风险', empty: '暂无风险', color: TONE.warning, severity: 2 },
  { group: 'warning', label: '警告', empty: '暂无警告', color: TONE.warning, severity: 1 },
  { group: 'info', label: '信息', empty: '暂无信息', color: TONE.neutral, severity: 0 },
]

const groupListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
} as const

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
  borderRadius: 12,
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
} as const

const headerRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

/** The colored dot that anchors the group's severity at a glance. */
const dotStyle = (color: string) =>
  ({
    width: 8,
    height: 8,
    borderRadius: 999,
    background: color,
    flexShrink: 0,
  }) as const

/** The group's count badge: tinted for the strong severities, quiet for info. */
function countBadgeStyle(color: string, severity: Severity) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 20,
    padding: '0 7px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    color,
    ...(severity === 2
      ? {
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`,
        }
      : severity === 1
        ? { background: 'transparent', border: `1px solid color-mix(in srgb, ${color} 42%, transparent)` }
        : {
            background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          }),
  } as const
}

function groupItems(
  report: NonNullable<ReturnType<typeof useDiagnostics>['report']>,
  group: RegistryDiagnosticGroup,
): readonly RegistryDiagnosticItem[] {
  switch (group) {
    case 'conflict':
      return report.conflicts
    case 'risk':
      return report.risks
    case 'warning':
      return report.warnings
    case 'info':
      return report.info
  }
}

function messageForGroup(group: RegistryDiagnosticGroup): string {
  switch (group) {
    case 'conflict':
      return '锁记录与实际安装不一致、索引重复或能力声明冲突'
    case 'risk':
      return '安全扫描在已拉取内容中发现了 block / warn 级别的风险'
    case 'warning':
      return '索引拉取、缓存新鲜度等值得关注但不阻断的状态'
    case 'info':
      return '锁记录与已安装内容的摘要'
  }
}

export function RegistryDiagnosticsScreen({ ctx, onNavigateToEntry }: RegistryDiagnosticsScreenProps): ReactElement {
  const { report, loading, error, serviceMissing, refresh, rescanEntry, rescanning } = useDiagnostics(ctx)
  const [bulkRescanning, setBulkRescanning] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const riskEntryIds = useMemo(() => {
    const ids = (report?.risks ?? [])
      .map((item) => item.entryId)
      .filter((entryId): entryId is string => typeof entryId === 'string' && entryId.length > 0)
    return [...new Set(ids)]
  }, [report])

  const rescanAll = useCallback(async () => {
    if (bulkRescanning || riskEntryIds.length === 0) return
    setBulkRescanning(true)
    setBulkError(null)
    let failures = 0
    // Sequential on purpose: each rescan refetches that entry's document.
    for (const entryId of riskEntryIds) {
      const outcome = await rescanEntry(entryId)
      if (!outcome.ok) failures++
    }
    setBulkRescanning(false)
    if (failures > 0) {
      setBulkError(`${failures} 个条目重新扫描失败，可稍后重试`)
    }
  }, [bulkRescanning, riskEntryIds, rescanEntry])

  const busy = bulkRescanning || rescanning

  const renderItem = (item: RegistryDiagnosticItem) =>
    h(
      'div',
      {
        key: item.id,
        'data-testid': `registry-diagnostics-item-${item.id}`,
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '12px 0',
          borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #F5F7FF)' } }, item.title),
        h(
          'div',
          { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary, #C5CAD8)' } },
          item.message,
        ),
      ),
      item.entryId && item.kind && onNavigateToEntry
        ? h(
            'button',
            {
              type: 'button',
              'data-testid': `registry-diagnostics-view-${item.id}`,
              onClick: () => onNavigateToEntry(item.entryId as string, item.kind as RegistryEntryKind),
              className: 'bbreg-btn bbreg-btn-ghost',
              style: { ...GHOST_BUTTON, flexShrink: 0 },
            },
            '查看',
          )
        : null,
    )

  return h(
    'div',
    { style: groupListStyle, 'data-testid': 'registry-diagnostics-screen' },
    // Header: title + regenerate.
    h(
      'div',
      { style: headerRowStyle },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 } },
        h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 700 } }, '诊断'),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          '检查注册表的锁定一致性、安全风险与索引状态，全部数据来自真实服务状态',
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'registry-diagnostics-refresh',
          onClick: () => void refresh(),
          disabled: loading,
          className: 'bbreg-btn bbreg-btn-ghost',
          style: { ...PILL_BASE, background: 'var(--surface-2, rgba(255, 255, 255, 0.06))', borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.12))', color: 'var(--text-primary, #F5F7FF)', opacity: loading ? 0.6 : 1 },
        },
        loading ? '生成中…' : '重新生成',
      ),
    ),
    // Body states.
    loading
      ? h(
          'div',
          {
            'data-testid': 'registry-diagnostics-loading',
            style: { padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary, #8B95B0)', fontSize: 13 },
          },
          '正在生成诊断报告…',
        )
      : serviceMissing
        ? h(
            'div',
            {
              'data-testid': 'registry-diagnostics-service-missing',
              style: { padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary, #8B95B0)', fontSize: 13 },
            },
            '注册表诊断服务未加载，无法生成诊断报告。',
          )
        : error && !report
          ? h(
              'div',
              {
                'data-testid': 'registry-diagnostics-error',
                style: { ...WARNING_BANNER, borderColor: TONE.error, color: TONE.error, textAlign: 'left' },
              },
              `诊断报告生成失败：${error}`,
              h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'registry-diagnostics-retry',
                  onClick: () => void refresh(),
                  className: 'bbreg-btn bbreg-btn-ghost',
                  style: { ...GHOST_BUTTON, marginLeft: 12, verticalAlign: 'middle' },
                },
                '重试',
              ),
            )
          : report
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
                GROUP_ORDER.map(({ group, label, empty, color, severity }) => {
                  const items = groupItems(report, group)
                  return h(
                    'section',
                    {
                      key: group,
                      'data-testid': `registry-diagnostics-group-${group}`,
                      // The severity accent bar only lights up when the group
                      // actually has something to say.
                      style:
                        items.length > 0 && severity === 2
                          ? { ...cardStyle, borderLeft: `3px solid ${color}` }
                          : cardStyle,
                    },
                    h(
                      'div',
                      { style: headerRowStyle },
                      h('span', { style: dotStyle(color) }),
                      h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 700, color } }, label),
                      h('span', { style: countBadgeStyle(color, severity) }, String(items.length)),
                      h(
                        'span',
                        { style: { fontSize: 12, color: 'var(--text-tertiary, #8B95B0)', flex: 1, minWidth: 160 } },
                        messageForGroup(group),
                      ),
                      group === 'risk' && items.length > 0
                        ? h(
                            'button',
                            {
                              type: 'button',
                              'data-testid': 'registry-diagnostics-rescan',
                              onClick: () => void rescanAll(),
                              disabled: busy,
                              className: 'bbreg-btn bbreg-btn-ghost',
                              style: {
                                ...GHOST_BUTTON,
                                flexShrink: 0,
                                borderColor: `color-mix(in srgb, ${TONE.warning} 55%, transparent)`,
                                color: TONE.warning,
                                fontWeight: 600,
                                opacity: busy ? 0.6 : 1,
                              },
                            },
                            busy ? '重扫中…' : '一键重新扫描',
                          )
                        : null,
                    ),
                    items.length === 0
                      ? h(
                          'div',
                          { 'data-testid': `registry-diagnostics-empty-${group}`, style: { padding: '10px 0 2px', fontSize: 12, color: 'var(--text-tertiary, #8B95B0)' } },
                          empty,
                        )
                      : h('div', { style: { display: 'flex', flexDirection: 'column' } }, items.map(renderItem)),
                  )
                }),
                bulkError
                  ? h('div', { 'data-testid': 'registry-diagnostics-rescan-error', style: WARNING_BANNER }, bulkError)
                  : null,
              )
            : null,
  )
}
