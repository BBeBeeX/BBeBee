/**
 * Graph Toolbar Component.
 *
 * Provides controls for:
 * - Mode Switching: [ OVERVIEW ] vs [ FOCUS ]
 * - Focus Target Indicator: "FOCUS: <plugin-name>"
 * - Depth Selector: [1] [2] [3] [ALL]
 * - Feature Toggles: ☑ Dependencies  ☑ Services  ☐ Events
 * - Real-time Search
 * - Layer Stratum Filters
 * - Fit View & Reset
 */

import { memo, type ReactElement } from 'react'
import type { FilterOptions, GraphFocus, LayerId } from '../graph-model.js'
import { ALL_LAYER_IDS, SYSTEM_LAYERS } from '../layer-resolver.js'

export interface GraphToolbarProps {
  focus: GraphFocus
  onUpdateFocus: (updater: (prev: GraphFocus) => GraphFocus) => void
  filters: FilterOptions
  onUpdateFilters: (updater: (prev: FilterOptions) => FilterOptions) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onResetLayout: () => void
  selectedNodeId: string | null
  focusedTargetName: string
}

export const GraphToolbar = memo(function GraphToolbar({
  focus,
  onUpdateFocus,
  filters,
  onUpdateFilters,
  onZoomIn,
  onZoomOut,
  onFitView,
  onResetLayout,
  focusedTargetName,
}: GraphToolbarProps): ReactElement {
  const isFocusMode = focus.mode === 'focus'

  const handleSearchChange = (value: string) => {
    onUpdateFilters((prev) => ({ ...prev, searchQuery: value }))
  }

  const toggleLayer = (layerId: LayerId) => {
    onUpdateFilters((prev) => {
      const next = new Set(prev.selectedLayers)
      if (next.has(layerId)) {
        if (next.size > 1) next.delete(layerId)
      } else {
        next.add(layerId)
      }
      return { ...prev, selectedLayers: next }
    })
  }

  const setMode = (mode: 'overview' | 'focus') => {
    onUpdateFocus((prev) => ({ ...prev, mode }))
  }

  const setDepth = (depth: number) => {
    onUpdateFocus((prev) => ({ ...prev, depth }))
  }

  const toggleDependencies = () => {
    onUpdateFocus((prev) => ({ ...prev, showDependencies: !prev.showDependencies }))
  }

  const toggleServices = () => {
    onUpdateFocus((prev) => ({ ...prev, showServices: !prev.showServices }))
  }

  const toggleEvents = () => {
    onUpdateFocus((prev) => ({ ...prev, showEvents: !prev.showEvents }))
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
        flexWrap: 'wrap',
      }}
    >
      {/* Left: Branding, Mode Toggle & Focus Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 2 }}>
          <span style={{ color: '#38bdf8', fontSize: 13 }}>⚡</span>
          <span
            style={{
              fontWeight: 800,
              letterSpacing: 1.2,
              color: '#f8fafc',
              fontSize: 11.5,
              textTransform: 'uppercase',
            }}
          >
            CORDIS TOPOLOGY
          </span>
        </div>

        {/* Mode Selector: [ OVERVIEW ] [ FOCUS ] */}
        <div
          style={{
            display: 'flex',
            background: '#05070d',
            borderRadius: 5,
            padding: 2,
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <button
            data-testid="mode-overview-button"
            onClick={() => setMode('overview')}
            style={{
              background: !isFocusMode ? '#38bdf8' : 'transparent',
              color: !isFocusMode ? '#05070d' : '#94a3b8',
              border: 'none',
              borderRadius: 3,
              padding: '4px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: 0.5,
              transition: 'all 0.15s ease',
            }}
          >
            OVERVIEW
          </button>
          <button
            data-testid="mode-focus-button"
            onClick={() => setMode('focus')}
            style={{
              background: isFocusMode ? '#38bdf8' : 'transparent',
              color: isFocusMode ? '#05070d' : '#94a3b8',
              border: 'none',
              borderRadius: 3,
              padding: '4px 10px',
              fontSize: 10.5,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: 0.5,
              transition: 'all 0.15s ease',
            }}
          >
            FOCUS
          </button>
        </div>

        {/* Current Focus Pill */}
        <div
          data-testid="focus-target-indicator"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: 4,
            padding: '4px 10px',
          }}
        >
          <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>
            {isFocusMode ? 'FOCUS:' : 'MODE:'}
          </span>
          <span
            style={{
              color: '#38bdf8',
              fontWeight: 700,
              fontSize: 11,
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={focusedTargetName}
          >
            {isFocusMode ? focusedTargetName || 'OVERVIEW' : 'GLOBAL TOPOLOGY'}
          </span>
        </div>

        {/* Depth Selector: [1] [2] [3] [ALL] (Active in Focus mode) */}
        {isFocusMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>DEPTH:</span>
            <div
              style={{
                display: 'flex',
                background: '#05070d',
                borderRadius: 4,
                padding: 2,
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {[1, 2, 3, 99].map((d) => {
                const label = d === 99 ? 'ALL' : String(d)
                const isSelected = (d === 99 && focus.depth >= 99) || focus.depth === d

                return (
                  <button
                    key={d}
                    data-testid={`depth-button-${label}`}
                    onClick={() => setDepth(d)}
                    style={{
                      background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                      color: isSelected ? '#38bdf8' : '#94a3b8',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                      borderRadius: 3,
                      padding: '2px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Center: Feature Toggles (Dependencies, Services, Events) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* ☑ Dependencies */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            cursor: 'pointer',
            color: focus.showDependencies ? '#38bdf8' : '#64748b',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={focus.showDependencies}
            onChange={toggleDependencies}
            style={{ accentColor: '#38bdf8' }}
          />
          Dependencies
        </label>

        {/* ☑ Services */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            cursor: 'pointer',
            color: focus.showServices ? '#2dd4bf' : '#64748b',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={focus.showServices}
            onChange={toggleServices}
            style={{ accentColor: '#2dd4bf' }}
          />
          Services
        </label>

        {/* ☐ Events (Default OFF) */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            cursor: 'pointer',
            color: focus.showEvents ? '#c084fc' : '#64748b',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={focus.showEvents}
            onChange={toggleEvents}
            style={{ accentColor: '#c084fc' }}
          />
          Events
        </label>
      </div>

      {/* Right: Search, Layer Quick Filters & Zoom Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Search Input */}
        <div style={{ position: 'relative', width: 170 }}>
          <input
            type="text"
            data-testid="toolbar-search-input"
            placeholder="Search..."
            value={filters.searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              width: '100%',
              background: '#05070d',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 4,
              padding: '4px 8px',
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
                right: 5,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Layer Filters (Overview or Multi-layer mode) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {ALL_LAYER_IDS.map((lid) => {
            const l = SYSTEM_LAYERS[lid]
            const isSelected = filters.selectedLayers.has(lid)

            return (
              <button
                key={lid}
                data-testid={`filter-layer-${lid}`}
                onClick={() => toggleLayer(lid)}
                title={`Toggle ${l.name} layer`}
                style={{
                  background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  border: isSelected ? `1px solid ${l.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                  color: isSelected ? l.color : '#64748b',
                  padding: '3px 6px',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  transition: 'all 0.12s ease',
                }}
              >
                {l.name[0]}
              </button>
            )
          })}
        </div>

        {/* Viewport Zoom & Fit Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#05070d',
            borderRadius: 4,
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <button
            data-testid="zoom-in-button"
            onClick={onZoomIn}
            title="Zoom In"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '3px 7px',
              cursor: 'pointer',
              fontSize: 12,
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
              padding: '3px 7px',
              cursor: 'pointer',
              fontSize: 12,
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
              color: '#38bdf8',
              padding: '3px 7px',
              cursor: 'pointer',
              fontSize: 10.5,
              fontFamily: 'inherit',
              fontWeight: 700,
            }}
          >
            FIT
          </button>
          <button
            data-testid="reset-layout-button"
            onClick={onResetLayout}
            title="Reset Layout"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              padding: '3px 7px',
              cursor: 'pointer',
              fontSize: 10.5,
              fontFamily: 'inherit',
              fontWeight: 700,
            }}
          >
            RESET
          </button>
        </div>
      </div>
    </div>
  )
})
