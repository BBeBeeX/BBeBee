/**
 * Favorites for the registry screen, persisted per user in `localStorage`.
 *
 * A favorite is a view-level mark ("keep this entry at hand"), not domain
 * state: it names an index entry the user wants to find again, it has no
 * service that owns it, and it must survive a reload without inventing a
 * store. `localStorage` under `bbebee_registry_favorites` is therefore the
 * whole story — the same trade `useViewMode` makes for view modes.
 *
 * Storage failures (private mode, quota) degrade to session-only state: the
 * set still toggles, the write is skipped, nothing throws.
 */

import { useCallback, useState } from 'react'

/** The `localStorage` key holding the favorited entry ids as a JSON array. */
export const REGISTRY_FAVORITES_KEY = 'bbebee_registry_favorites'

function readStoredFavorites(): ReadonlySet<string> {
  try {
    const raw = window.localStorage?.getItem(REGISTRY_FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    // Unreadable storage (or a corrupted value) reads as "nothing favorited",
    // not as an error — the tab still works, the list just starts empty.
    return new Set()
  }
}

function writeStoredFavorites(favorites: ReadonlySet<string>): void {
  try {
    window.localStorage?.setItem(REGISTRY_FAVORITES_KEY, JSON.stringify([...favorites]))
  } catch {
    // Storage unavailable — the choice lives for this session only.
  }
}

export interface UseFavoritesResult {
  /** Every favorited entry id, live. */
  readonly favorites: ReadonlySet<string>
  /** Add the id when absent, remove it when present. */
  toggle: (entryId: string) => void
  isFavorite: (entryId: string) => boolean
}

export function useFavorites(): UseFavoritesResult {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(readStoredFavorites)

  const toggle = useCallback((entryId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      writeStoredFavorites(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((entryId: string) => favorites.has(entryId), [favorites])

  return { favorites, toggle, isFavorite }
}
