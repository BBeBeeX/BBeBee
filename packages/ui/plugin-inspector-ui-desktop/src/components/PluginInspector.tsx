/**
 * Plugin Inspector Drawer Component.
 *
 * Displays rich architectural telemetry for the selected Plugin, Service,
 * Event, or Edge relationship:
 * - Identification & Metadata (Name, ID, Version, Stratum Layer, Status)
 * - Service Provisions & Requirements (with highlighted missing dependencies)
 * - Event hooks & Active runtime effects
 * - Relationship semantics for selected orthogonal traces
 */

import { memo, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { useI18n } from '@BBeBee/ui-kit-desktop'
import type { FocusType, PluginGraph } from '../graph-model.js'

export interface PluginInspectorProps {
  /** The app context — read for the interface language via `useI18n`. */
  ctx: Context
  graph: PluginGraph
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onClose: () => void
  onSelectNode: (id: string) => void
  onFocusNode?: (type: FocusType, id: string) => void
}

export const PluginInspector = memo(function PluginInspector({
  ctx,
  graph,
  selectedNodeId,
  selectedEdgeId,
  onClose,
  onSelectNode,
  onFocusNode,
}: PluginInspectorProps): ReactElement {
  const { t } = useI18n(ctx)
  // Find selected entity
  const selectedPlugin = selectedNodeId
    ? graph.plugins.find((p) => p.id === selectedNodeId)
    : null
  const selectedService = selectedNodeId
    ? graph.services.find((s) => s.id === selectedNodeId)
    : null
  const selectedEvent = selectedNodeId
    ? graph.events.find((e) => e.id === selectedNodeId)
    : null
  const selectedEdge = selectedEdgeId
    ? graph.edges.find((e) => e.id === selectedEdgeId)
    : null

  const canFocus = Boolean(selectedPlugin || selectedService || selectedEvent)
  const focalType: FocusType = selectedPlugin
    ? 'plugin'
    : selectedService
      ? 'service'
      : selectedEvent
        ? 'event'
        : 'overview'
  const focalId = selectedPlugin?.id || selectedService?.id || selectedEvent?.id || ''

  return (
    <div
      className="plugin-inspector-panel"
      data-testid="plugin-inspector"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 320,
        height: '100%',
        background: '#090e1a',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#0c1322',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.8,
            color: '#94a3b8',
          }}
        >
          {selectedPlugin
            ? t('inspector:pluginInspector.pluginInspector')
            : selectedService
              ? t('inspector:pluginInspector.serviceInspector')
              : selectedEvent
                ? t('inspector:pluginInspector.eventInspector')
                : selectedEdge
                  ? t('inspector:pluginInspector.relationshipInspector')
                  : t('inspector:pluginInspector.systemOverview')}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {canFocus && onFocusNode && (
            <button
              data-testid="inspector-focus-btn"
              onClick={() => onFocusNode(focalType, focalId)}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid #38bdf8',
                borderRadius: 4,
                color: '#38bdf8',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              title={t('inspector:pluginInspector.focusGraphOnThisNode')}
            >
              {t('inspector:graphToolbar.focus')}
            </button>
          )}

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: 14,
              padding: '2px 6px',
            }}
            title={t('inspector:pluginInspector.closePanel')}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
        }}
      >
        {/* 1. Plugin Detail View */}
        {selectedPlugin && (
          <div data-testid="inspector-plugin-detail">
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#f8fafc',
                  wordBreak: 'break-all',
                }}
              >
                {selectedPlugin.displayName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#64748b',
                  marginTop: 3,
                  wordBreak: 'break-all',
                }}
              >
                {selectedPlugin.id}
              </div>
            </div>

            {/* Badges Row */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background:
                    selectedPlugin.status === 'ACTIVE'
                      ? 'rgba(56, 189, 248, 0.16)'
                      : 'rgba(239, 68, 68, 0.16)',
                  color:
                    selectedPlugin.status === 'ACTIVE' ? '#38bdf8' : '#ef4444',
                  border: `1px solid ${
                    selectedPlugin.status === 'ACTIVE'
                      ? 'rgba(56, 189, 248, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'
                  }`,
                }}
              >
                ● {selectedPlugin.status}
              </span>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: '#cbd5e1',
                }}
              >
                {selectedPlugin.layerName} (L{selectedPlugin.layer.slice(-1)})
              </span>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#94a3b8',
                  background: 'rgba(255, 255, 255, 0.04)',
                }}
              >
                v{selectedPlugin.version ?? '0.0.0'}
              </span>
            </div>

            {/* Description */}
            {selectedPlugin.description && (
              <div
                style={{
                  padding: '8px 10px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 4,
                  color: '#94a3b8',
                  fontSize: 11,
                  lineHeight: 1.4,
                  marginBottom: 16,
                }}
              >
                {selectedPlugin.description}
              </div>
            )}

            {/* Stalled / Waiting Alert */}
            {selectedPlugin.waitingFor.length > 0 && (
              <div
                style={{
                  padding: 10,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 4,
                  color: '#fca5a5',
                  fontSize: 11,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {t('inspector:pluginInspector.pendingInjection')}
                </div>
                <div>
                  {t('inspector:pluginInspector.waitingForServices', {
                    services: selectedPlugin.waitingFor.join(', '),
                  })}
                </div>
              </div>
            )}

            {/* Services Provided */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#2dd4bf',
                  marginBottom: 6,
                }}
              >
                {t('inspector:pluginInspector.providesServices', {
                  count: selectedPlugin.provides.length,
                })}
              </div>
              {selectedPlugin.provides.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 11 }}>
                  {t('inspector:pluginInspector.none')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPlugin.provides.map((s) => (
                    <div
                      key={s}
                      onClick={() => onSelectNode(`service:${s}`)}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(45, 212, 191, 0.08)',
                        border: '1px solid rgba(45, 212, 191, 0.25)',
                        borderRadius: 4,
                        color: '#2dd4bf',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      ◇ {s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Services Required (Injected) */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#38bdf8',
                  marginBottom: 6,
                }}
              >
                {t('inspector:pluginInspector.requiresServices', {
                  count: selectedPlugin.requires.length,
                })}
              </div>
              {selectedPlugin.requires.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 11 }}>
                  {t('inspector:pluginInspector.none')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPlugin.requires.map((r) => {
                    const isMissing = selectedPlugin.waitingFor.includes(r)
                    return (
                      <div
                        key={r}
                        onClick={() => onSelectNode(`service:${r}`)}
                        style={{
                          padding: '4px 8px',
                          background: isMissing
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(56, 189, 248, 0.08)',
                          border: `1px solid ${
                            isMissing
                              ? 'rgba(239, 68, 68, 0.4)'
                              : 'rgba(56, 189, 248, 0.25)'
                          }`,
                          borderRadius: 4,
                          color: isMissing ? '#fca5a5' : '#38bdf8',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {isMissing ? '⚠ ' : '◇ '}
                        {r}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Dependencies */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#94a3b8',
                  marginBottom: 6,
                }}
              >
                {t('inspector:pluginInspector.dependencies', {
                  count: selectedPlugin.dependencies.length,
                })}
              </div>
              {selectedPlugin.dependencies.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 11 }}>
                  {t('inspector:pluginInspector.none')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPlugin.dependencies.map((dep) => (
                    <div
                      key={dep}
                      onClick={() => onSelectNode(dep)}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 4,
                        color: '#cbd5e1',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      → {dep}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Events Listened */}
            {selectedPlugin.eventsListened.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#c084fc',
                    marginBottom: 6,
                  }}
                >
                  {t('inspector:pluginInspector.eventHooks', {
                    count: selectedPlugin.eventsListened.length,
                  })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPlugin.eventsListened.map((ev) => (
                    <div
                      key={ev}
                      onClick={() => onSelectNode(`event:${ev}`)}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(192, 132, 252, 0.08)',
                        border: '1px solid rgba(192, 132, 252, 0.25)',
                        borderRadius: 4,
                        color: '#c084fc',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      ● {ev}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Effects */}
            {selectedPlugin.effects.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fbbf24',
                    marginBottom: 6,
                  }}
                >
                  {t('inspector:pluginInspector.labelledEffects', {
                    count: selectedPlugin.effects.length,
                  })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPlugin.effects.map((eff, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(251, 191, 36, 0.06)',
                        border: '1px solid rgba(251, 191, 36, 0.2)',
                        borderRadius: 4,
                        color: '#fbbf24',
                        fontSize: 11,
                      }}
                    >
                      · {eff.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. Service Detail View */}
        {selectedService && (
          <div data-testid="inspector-service-detail">
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#2dd4bf' }}>
                ◇ {selectedService.name}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                {selectedService.id}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background:
                    selectedService.status === 'ACTIVE'
                      ? 'rgba(45, 212, 191, 0.16)'
                      : 'rgba(245, 158, 11, 0.16)',
                  color: selectedService.status === 'ACTIVE' ? '#2dd4bf' : '#f59e0b',
                }}
              >
                ● {selectedService.status}
              </span>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
                {t('inspector:pluginInspector.provider')}
              </div>
              {selectedService.provider ? (
                <div
                  onClick={() => onSelectNode(selectedService.provider!)}
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 4,
                    color: '#38bdf8',
                    cursor: 'pointer',
                  }}
                >
                  ○ {selectedService.provider}
                </div>
              ) : (
                <div style={{ color: '#ef4444' }}>
                  {t('inspector:pluginInspector.missingProvider')}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
                {t('inspector:pluginInspector.consumers', {
                  count: selectedService.consumers.length,
                })}
              </div>
              {selectedService.consumers.length === 0 ? (
                <div style={{ color: '#475569' }}>{t('inspector:pluginInspector.none')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedService.consumers.map((c) => (
                    <div
                      key={c}
                      onClick={() => onSelectNode(c)}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 4,
                        color: '#cbd5e1',
                        cursor: 'pointer',
                      }}
                    >
                      ○ {c}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. Event Detail View */}
        {selectedEvent && (
          <div data-testid="inspector-event-detail">
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#c084fc' }}>
                ● {selectedEvent.name}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                {t('inspector:pluginInspector.activeListeners', {
                  count: selectedEvent.listenersCount,
                })}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
                {t('inspector:pluginInspector.sUBSCRIBINGPLUGINS')}
              </div>
              {selectedEvent.listeners.length === 0 ? (
                <div style={{ color: '#475569' }}>{t('inspector:pluginInspector.dynamicListenersOnly')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedEvent.listeners.map((l) => (
                    <div
                      key={l}
                      onClick={() => onSelectNode(l)}
                      style={{
                        padding: '4px 8px',
                        background: 'rgba(192, 132, 252, 0.08)',
                        border: '1px solid rgba(192, 132, 252, 0.25)',
                        borderRadius: 4,
                        color: '#c084fc',
                        cursor: 'pointer',
                      }}
                    >
                      ○ {l}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. Edge Relationship View */}
        {selectedEdge && (
          <div data-testid="inspector-edge-detail">
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                {t('inspector:pluginInspector.relationship')}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#38bdf8',
                  textTransform: 'uppercase',
                  marginTop: 3,
                }}
              >
                {t('inspector:pluginInspector.edgeTrace', { type: selectedEdge.type })}
              </div>
            </div>

            <div
              style={{
                padding: 12,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>
                {t('inspector:pluginInspector.source')}
              </div>
              <div
                onClick={() => onSelectNode(selectedEdge.source)}
                style={{
                  fontWeight: 600,
                  color: '#38bdf8',
                  cursor: 'pointer',
                  marginBottom: 12,
                }}
              >
                {selectedEdge.source}
              </div>

              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>
                {t('inspector:pluginInspector.relationLabel')}
              </div>
              <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 12 }}>
                {selectedEdge.label ?? selectedEdge.type}
              </div>

              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>
                {t('inspector:pluginInspector.target')}
              </div>
              <div
                onClick={() => onSelectNode(selectedEdge.target)}
                style={{ fontWeight: 600, color: '#38bdf8', cursor: 'pointer' }}
              >
                {selectedEdge.target}
              </div>
            </div>
          </div>
        )}

        {/* 5. System Overview (when nothing is selected) */}
        {!selectedPlugin && !selectedService && !selectedEvent && !selectedEdge && (
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#f8fafc',
                marginBottom: 12,
              }}
            >
              {t('inspector:pluginInspector.sYSTEMARCHITECTURE')}
            </div>

            <div
              style={{
                padding: 12,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 6,
                marginBottom: 16,
                lineHeight: 1.5,
                color: '#94a3b8',
                fontSize: 11,
              }}
            >
              {t('inspector:pluginInspector.systemOverviewHint')}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
              {t('inspector:pluginInspector.lAYERSTRATA')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {graph.layers.map((l) => {
                const layerPluginCount = graph.plugins.filter((p) => p.layer === l.id).length
                return (
                  <div
                    key={l.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: 4,
                      borderLeft: `3px solid ${l.color}`,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#cbd5e1' }}>
                      L{l.order} · {l.name}
                    </span>
                    <span style={{ color: '#64748b' }}>
                      {layerPluginCount === 1
                        ? t('inspector:pluginInspector.pluginCount.one', {
                            count: layerPluginCount,
                          })
                        : t('inspector:pluginInspector.pluginCount.other', {
                            count: layerPluginCount,
                          })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
