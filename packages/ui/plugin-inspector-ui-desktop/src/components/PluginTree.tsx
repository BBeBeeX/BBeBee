/**
 * Plugin Tree Navigation Component.
 *
 * Renders the collapsible hierarchical tree grouped by architectural layers:
 *   ▼ Kernel
 *   ▼ Core
 *   ▼ Logs
 *   ▼ Feature
 *   ▼ UI
 *
 * Clicking a tree item selects and focuses the plugin in the Graph Canvas.
 */

import { memo, useMemo, useState, type ReactElement } from 'react'
import type { LayerId, PluginGraph, PluginNode } from '../graph-model.js'
import { ALL_LAYER_IDS, SYSTEM_LAYERS } from '../layer-resolver.js'

export interface PluginTreeProps {
  graph: PluginGraph
  selectedNodeId: string | null
  onSelectPlugin: (id: string) => void
  onSelectLayer?: (layerId: LayerId) => void
}

const STATUS_DOT_COLORS: Record<string, string> = {
  ACTIVE: '#38bdf8',
  PENDING: '#f59e0b',
  LOADING: '#eab308',
  FAILED: '#ef4444',
  DISPOSED: '#64748b',
  UNLOADING: '#a855f7',
  UNKNOWN: '#94a3b8',
}

export const PluginTree = memo(function PluginTree({
  graph,
  selectedNodeId,
  onSelectPlugin,
  onSelectLayer,
}: PluginTreeProps): ReactElement {
  // Collapsed layer state: all expanded by default
  const [collapsedLayers, setCollapsedLayers] = useState<Record<string, boolean>>({})
  const [filterText, setFilterText] = useState('')

  const toggleLayer = (layerId: string) => {
    setCollapsedLayers((prev) => ({ ...prev, [layerId]: !prev[layerId] }))
  }

  // Group plugins by layer and apply tree filter
  const pluginsByLayer = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    const map = new Map<LayerId, PluginNode[]>()
    for (const lid of ALL_LAYER_IDS) map.set(lid, [])

    for (const p of graph.plugins) {
      if (q && !p.name.toLowerCase().includes(q) && !p.displayName.toLowerCase().includes(q)) {
        continue
      }
      map.get(p.layer)?.push(p)
    }
    return map
  }, [graph.plugins, filterText])

  return (
    <div
      className="plugin-tree-panel"
      data-testid="plugin-tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 250,
        height: '100%',
        background: '#090e1a',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      {/* Tree Header & Quick Search */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#0c1322',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.8,
            color: '#94a3b8',
            marginBottom: 8,
          }}
        >
          PLUGIN HIERARCHY
        </div>
        <input
          type="text"
          placeholder="Filter tree..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{
            width: '100%',
            background: '#060a14',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 4,
            padding: '5px 8px',
            color: '#f8fafc',
            fontSize: 11,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Layer Accordion List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 6px',
        }}
      >
        {ALL_LAYER_IDS.map((layerId) => {
          const layerInfo = SYSTEM_LAYERS[layerId]
          const plugins = pluginsByLayer.get(layerId) ?? []
          const isCollapsed = Boolean(collapsedLayers[layerId])

          return (
            <div key={layerId} style={{ marginBottom: 6 }}>
              {/* Layer Title Row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '5px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: 'rgba(255, 255, 255, 0.03)',
                  transition: 'background 0.15s ease',
                }}
              >
                <div
                  onClick={() => toggleLayer(layerId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}
                >
                  <span style={{ fontSize: 10, color: '#64748b' }}>
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: layerInfo.color,
                      display: 'inline-block',
                    }}
                  />
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectLayer?.(layerId)
                    }}
                    title={`Focus ${layerInfo.name} Layer`}
                    style={{
                      fontWeight: 600,
                      color: '#cbd5e1',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {layerInfo.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectLayer?.(layerId)
                    }}
                    title={`Focus on ${layerInfo.name} Layer`}
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: 3,
                      color: '#38bdf8',
                      fontSize: 9,
                      padding: '1px 4px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    FOCUS
                  </button>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#64748b',
                      background: 'rgba(255, 255, 255, 0.06)',
                      padding: '1px 5px',
                      borderRadius: 8,
                    }}
                  >
                    {plugins.length}
                  </span>
                </div>
              </div>

              {/* Plugin Items */}
              {!isCollapsed && (
                <div style={{ paddingLeft: 18, marginTop: 2 }}>
                  {plugins.length === 0 ? (
                    <div style={{ padding: '4px 8px', fontSize: 10, color: '#475569' }}>
                      (empty)
                    </div>
                  ) : (
                    plugins.map((p) => {
                      const isSelected = selectedNodeId === p.id
                      const dotColor = STATUS_DOT_COLORS[p.status] ?? '#94a3b8'
                      const shortName = p.name.replace(/^@BBeBee\//, '')

                      return (
                        <div
                          key={p.id}
                          data-testid={`tree-item-${p.id}`}
                          onClick={() => {
                            onSelectPlugin(p.id)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 8px',
                            margin: '1px 0',
                            borderRadius: 4,
                            cursor: 'pointer',
                            background: isSelected
                              ? 'rgba(56, 189, 248, 0.16)'
                              : 'transparent',
                            border: isSelected
                              ? '1px solid rgba(56, 189, 248, 0.35)'
                              : '1px solid transparent',
                            color: isSelected ? '#38bdf8' : '#94a3b8',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: dotColor,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontSize: 11,
                            }}
                            title={p.name}
                          >
                            {shortName}
                          </span>
                          {p.status !== 'ACTIVE' && (
                            <span
                              style={{
                                fontSize: 9,
                                color: dotColor,
                                background: 'rgba(0, 0, 0, 0.4)',
                                padding: '1px 4px',
                                borderRadius: 3,
                              }}
                            >
                              {p.status}
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
