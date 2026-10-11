/**
 * View mode selector for track/album tables.
 *
 * A page offers Compact (no covers, artists as their own column) and List (the
 * full row with covers); album grids may additionally offer Tiled (the card
 * grid). The choice persists per page in `localStorage` so a page the user
 * prefers compact stays compact.
 */

import { useCallback, useState } from 'react'
import type { MenuItemSpec } from '@BBeBee/ui-core'
import { tablerIcon } from '../icons/index.js'

export type TrackViewMode = 'compact' | 'list'
export type AlbumViewMode = TrackViewMode | 'tiled'

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const stored = window.localStorage?.getItem(key)
    if (stored && (allowed as readonly string[]).includes(stored)) return stored as T
  } catch {
    // Storage unavailable — the fallback is the answer.
  }
  return fallback
}

/** View-mode state persisted under `bbebee_view_mode:<key>`. */
export function useViewMode<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (mode: TrackViewMode | AlbumViewMode) => void] {
  const [mode, setMode] = useState<T>(() => readStored(`bbebee_view_mode:${key}`, fallback, allowed))
  const update = useCallback(
    (next: TrackViewMode | AlbumViewMode) => {
      setMode(next as T)
      try {
        window.localStorage?.setItem(`bbebee_view_mode:${key}`, next)
      } catch {
        // Storage unavailable — the choice lives for this session only.
      }
    },
    [key],
  )
  return [mode, update]
}

const MODE_LABELS = { compact: 'Compact', list: 'List', tiled: 'Tiled' } as const

/**
 * Append the View mode section to a sort menu: a hairline divider closes the
 * sort options, then a flush-left muted View mode heading and one entry per
 * mode, a check icon marking the active one.
 */
export function viewModeMenuItems(
  base: MenuItemSpec[],
  value: TrackViewMode | AlbumViewMode,
  onChange: (mode: TrackViewMode | AlbumViewMode) => void,
  opts: { allowTiled?: boolean } = {},
): MenuItemSpec[] {
  const modes: (TrackViewMode | AlbumViewMode)[] = opts.allowTiled
    ? ['compact', 'list', 'tiled']
    : ['compact', 'list']
  const section: MenuItemSpec[] = [
    { id: 'view-mode-header', label: 'View mode', heading: true, disabled: true },
    ...modes.map((mode) => ({
      id: `view-mode-${mode}`,
      label: MODE_LABELS[mode],
      icon: value === mode ? tablerIcon('check', { size: 16 }) : undefined,
      onSelect: () => onChange(mode),
    })),
  ]
  if (base.length === 0) return section
  return [...base.slice(0, -1), { ...base[base.length - 1]!, divider: true }, ...section]
}

/**
 * `View mode: Compact/List(/Tiled)` — a segmented capsule rendered next to the
 * page's sort control. The active segment is highlighted, not filled.
 */
