/**
 * Shared batch multi-selection state for lists, tables, and grids.
 *
 * Provides toggle selection, select all, clear selection, and selection count
 * for any collection of entity URNs/IDs.
 */

import { useCallback, useMemo, useState } from 'react'

export interface BatchSelectionState {
  isBatchMode: boolean
  setBatchMode: (active: boolean) => void
  setIsBatchMode: (active: boolean) => void
  selectedUrns: Set<string>
  setSelectedUrns: (urns: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  toggleSelect: (urn: string) => void
  selectAll: (allUrns: readonly string[]) => void
  clearSelection: () => void
  isSelected: (urn: string) => boolean
  isAllSelected: (allUrns: readonly string[]) => boolean
  selectedCount: number
}

export function useBatchSelection(initialActive = false): BatchSelectionState {
  const [isBatchMode, setBatchModeState] = useState(initialActive)
  const [selectedUrns, setSelectedUrns] = useState<Set<string>>(() => new Set())

  const setBatchMode = useCallback((active: boolean) => {
    setBatchModeState(active)
    if (!active) {
      setSelectedUrns(new Set())
    }
  }, [])

  const toggleSelect = useCallback((urn: string) => {
    setSelectedUrns((prev) => {
      const next = new Set(prev)
      if (next.has(urn)) {
        next.delete(urn)
      } else {
        next.add(urn)
      }
      return next
    })
  }, [])

  const selectAll = useCallback((allUrns: readonly string[]) => {
    setSelectedUrns(new Set(allUrns))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedUrns(new Set())
  }, [])

  const isSelected = useCallback(
    (urn: string) => selectedUrns.has(urn),
    [selectedUrns],
  )

  const isAllSelected = useCallback(
    (allUrns: readonly string[]) => allUrns.length > 0 && selectedUrns.size === allUrns.length,
    [selectedUrns],
  )

  const selectedCount = selectedUrns.size

  return useMemo(
    () => ({
      isBatchMode,
      setBatchMode,
      setIsBatchMode: setBatchMode,
      selectedUrns,
      setSelectedUrns,
      toggleSelect,
      selectAll,
      clearSelection,
      isSelected,
      isAllSelected,
      selectedCount,
    }),
    [
      isBatchMode,
      setBatchMode,
      selectedUrns,
      toggleSelect,
      selectAll,
      clearSelection,
      isSelected,
      isAllSelected,
      selectedCount,
    ],
  )
}
