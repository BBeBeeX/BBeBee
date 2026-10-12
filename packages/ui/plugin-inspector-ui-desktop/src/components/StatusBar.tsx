/**
 * Status Bar Component.
 *
 * Displays live runtime telemetry, aggregate counts, active filter states,
 * and viewport scale.
 */

import { memo, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { useI18n } from '@BBeBee/ui-kit-desktop'
import type { PluginGraph } from '../graph-model.js'

export interface StatusBarProps {
  /** The app context — read for the interface language via `useI18n`. */
  ctx: Context
  graph: PluginGraph
  zoom: number
  visibleNodeCount: number
  visibleEdgeCount: number
}

export const StatusBar = memo(function StatusBar({
  ctx,
  graph,
  zoom,
  visibleNodeCount,
  visibleEdgeCount,
}: StatusBarProps): ReactElement {
  const { t } = useI18n(ctx)
  const { counts } = graph
  const hasFailed = counts.failedPlugins > 0
  const hasPending = counts.pendingPlugins > 0

  return (
    <div
      className="graph-status-bar"
      data-testid="graph-status-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 16px',
        background: '#070b16',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#94a3b8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 10.5,
        userSelect: 'none',
      }}
    >
      {/* Left: Runtime Status & Counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: hasFailed ? '#ef4444' : hasPending ? '#f59e0b' : '#38bdf8',
            }}
          />
          <span style={{ color: '#f8fafc', fontWeight: 600 }}>
            {hasFailed ? t('inspector:status.rUNTIMEWARNING') : t('inspector:status.rUNTIMEACTIVE')}
          </span>
        </div>

        <div>
          {t('inspector:statusBar.plugins')}{' '}
          <span style={{ color: '#38bdf8' }}>
            {t('inspector:statusBar.active', { count: counts.activePlugins })}
          </span>
          {counts.pendingPlugins > 0 && (
            <span style={{ color: '#f59e0b', marginLeft: 6 }}>
              {t('inspector:statusBar.pending', { count: counts.pendingPlugins })}
            </span>
          )}
          {counts.failedPlugins > 0 && (
            <span style={{ color: '#ef4444', marginLeft: 6 }}>
              {t('inspector:statusBar.failed', { count: counts.failedPlugins })}
            </span>
          )}
          <span style={{ color: '#64748b', marginLeft: 6 }}>
            {t('inspector:statusBar.total', { count: counts.totalPlugins })}
          </span>
        </div>

        <div>
          {t('inspector:statusBar.services')}{' '}
          <span style={{ color: '#2dd4bf' }}>{counts.totalServices}</span>
        </div>

        <div>
          {t('inspector:statusBar.events')}{' '}
          <span style={{ color: '#c084fc' }}>{counts.totalEvents}</span>
        </div>
      </div>

      {/* Right: Viewport Telemetry */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div>
          {t('inspector:statusBar.visible')}{' '}
          <span style={{ color: '#e2e8f0' }}>
            {t('inspector:statusBar.nodes', { count: visibleNodeCount })},{' '}
            {t('inspector:statusBar.traces', { count: visibleEdgeCount })}
          </span>
        </div>
        <div>
          {t('inspector:statusBar.zoom')}{' '}
          <span style={{ color: '#e2e8f0' }}>{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  )
})
