/**
 * Graph Toolbar Component.
 *
 * Provides top-level controls for:
 * - Real-time full-text search across plugins, services, and events
 * - Architectural Layer filters (Kernel, Core, Logs, Feature, UI)
 * - Node & Edge type visibility toggles
 * - Multi-depth Focus traversal (depth = 1, 2, 3)
 * - Viewport zoom controls (Zoom In, Zoom Out, Fit View, Reset Layout)
 */

import { memo, useState, type ReactElement } from 'react'
import type { EdgeType, FilterOptions, LayerId } from '../graph-model.js'
import { ALL_LAYER_IDS, SYSTEM_LAYERS } from '../layer-resolver.js'

export interface GraphToolbarProps {
  filters: FilterOptions
  onUpdateFilters: (updater: (prev: FilterOptions) => FilterOptions) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onResetLayout: () => void
  selectedNodeId: string | null
}

export const GraphToolbar = memo(function GraphToolbar({
  filters,
  onUpdateFilters,
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetLayout,
  selectedNodeId,
}: GraphToolbarProps): ReactElement {
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)

  const handleSearchChange = (value: string) => {
    onUpdateFilters((prev) => ({ ...prev, searchQuery: value }))
  }

  const toggleLayer = (layerId: LayerId) => {
    onUpdateFilters((prev) => {
      const next = new Set(prev.selectedLayers)
      if (next.has(layerId)) {
        // Prevent deselecting all layers
        if (next.size > 1) next.delete(layerId)
      } else {
        next.add(layerId)
      }
      return { ...prev, selectedLayers: next }
    })
  }

  const toggleNodeType = (type: 'plugin' | 'service' | 'event') => {
    onUpdateFilters((prev) => {
      const next = new Set(prev.nodeTypes)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return { ...prev, nodeTypes: next }
    })
  }

  const toggleEdgeType = (type: EdgeType) => {
    onUpdateFilters((prev) => {
      const next = new Set(prev.edgeTypes)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return { ...prev, edgeTypes: next }
    })
  }

  const toggleFocus = () => {
    onUpdateFilters((prev) => ({
      ...prev,
      focusNodeId: prev.focusNodeId ? null : selectedNodeId,
    }))
  }

  const setFocusDepth = (depth: number) => {
    onUpdateFilters((prev) => ({ ...prev, focusDepth: depth }))
  }

  return (
    <div
      className="graph-toolbar"
      data-testid="graph-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#0a101f',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        gap: 12,
        zIndex: 10,
      }}
    >
      {/* Left: Branding & Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, color: '#f8fafc' }}>
            CORDIS TOPOLOGY
          </span>
          <span
            style={{
              fontSize: 9,
              color: '#38bdf8',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              padding: '1px 5px',
              borderRadius: 3,
            }}
          >
            v4.0-rc.9
          </span>
        </div>

        {/* Global Search Input */}
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            data-testid="toolbar-search-input"
            placeholder="Search plugins, services, events..."
            value={filters.searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              width: '100%',
              background: '#05070d',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 4,
              padding: '6px 10px',
              color: '#f8fafc',
              fontSize: 11,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {filters.searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Center: Layer Filters Quick Toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {ALL_LAYER_IDS.map((lid) => {
          const l = SYSTEM_LAYERS[lid]
          const isSelected = filters.selectedLayers.has(lid)

          return (
            <button
              key={lid}
              data-testid={`filter-layer-${lid}`}
              onClick={() => toggleLayer(lid)}
              style={{
                background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: isSelected ? `1px solid ${l.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                color: isSelected ? l.color : '#64748b',
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isSelected ? l.color : '#475569',
                }}
              />
              {l.name}
            </button>
          )
        })}
      </div>

      {/* Right: Focus & Viewport Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Focus Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            data-testid="focus-toggle-button"
            disabled={!selectedNodeId && !filters.focusNodeId}
            onClick={toggleFocus}
            style={{
              background: filters.focusNodeId
                ? 'rgba(56, 189, 248, 0.2)'
                : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${
                filters.focusNodeId ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'
              }`,
              color: filters.focusNodeId ? '#38bdf8' : '#94a3b8',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: selectedNodeId || filters.focusNodeId ? 'pointer' : 'not-allowed',
              opacity: selectedNodeId || filters.focusNodeId ? 1 : 0.4,
              fontSize: 11,
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            {filters.focusNodeId ? '★ FOCUSED' : 'FOCUS'}
          </button>

          {/* Depth Selector */}
          {filters.focusNodeId && (
            <div style={{ display: 'flex', background: '#05070d', borderRadius: 4, padding: 2 }}>
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => setFocusDepth(d)}
                  style={{
                    background: filters.focusDepth === d ? '#38bdf8' : 'transparent',
                    color: filters.focusDepth === d ? '#05070d' : '#94a3b8',
                    border: 'none',
                    borderRadius: 3,
                    padding: '2px 6px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  d{d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter Dropdown Toggle */}
        <div style={{ position: 'relative' }}>
          <button
            data-testid="filter-dropdown-toggle"
            onClick={() => setShowFilterDropdown((v) => !v)}
            style={{
              background: showFilterDropdown ? '#1e293b' : 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            ⚙ FILTERS ▾
          </button>

          {showFilterDropdown && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 32,
                width: 200,
                background: '#0c1322',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 6,
                padding: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                zIndex: 100,
              }}
            >
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 6 }}>
                NODE TYPES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                {(['plugin', 'service', 'event'] as const).map((t) => (
                  <label
                    key={t}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                      color: '#cbd5e1',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.nodeTypes.has(t)}
                      onChange={() => toggleNodeType(t)}
                    />
                    {t.toUpperCase()}
                  </label>
                ))}
              </div>

              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 6 }}>
                EDGE TYPES
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(['dependency', 'service', 'event', 'ui'] as const).map((t) => (
                  <label
                    key={t}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      cursor: 'pointer',
                      color: '#cbd5e1',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.edgeTypes.has(t)}
                      onChange={() => toggleEdgeType(t)}
                    />
                    {t.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Viewport Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#05070d', borderRadius: 4 }}>
          <button
            data-testid="zoom-in-button"
            onClick={onZoomIn}
            title="Zoom In"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            +
          </button>
          <button
            data-testid="zoom-out-button"
            onClick={onZoomOut}
            title="Zoom Out"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            -
          </button>
          <button
            data-testid="fit-view-button"
            onClick={onFitView}
            title="Fit View"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            ⊡
          </button>
          <button
            data-testid="reset-layout-button"
            onClick={onResetLayout}
            title="Reset Layout"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            ↺
          </button>
        </div>
      </div>
    </div>
  )
})
