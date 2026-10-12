import type { Context } from 'cordis'
import { parseUrn } from '@BBeBee/protocol'
import type { MenuItemSpec, SubmenuSpec } from '@BBeBee/ui-core'
import type { Collection, LibraryService } from '@BBeBee/protocol'
import { menuTranslate } from '../utils/i18n.js'

/**
 * "Move/add to a collection" — the folder counterpart of the playlist submenu.
 */
export function addToCollectionSubmenu(
  library: LibraryService | undefined,
  urns: readonly string[],
  collections: readonly Collection[],
  opts?: {
    title?: string
    searchPlaceholder?: string
    createLabel?: string
    currentFolderId?: string
    onSelectFolder?: (folderId: string | null) => void | Promise<void>
    onMoved?: (targetFolderId?: string | null) => void
    ctx?: Context
  },
): SubmenuSpec | undefined {
  const allowedUrns = urns.filter((urn) => {
    try {
      return parseUrn(urn).kind !== 'track'
    } catch {
      return true
    }
  })
  if (!library || (allowedUrns.length === 0 && !opts?.onSelectFolder)) return undefined
  const items: MenuItemSpec[] = []

  if (opts?.currentFolderId) {
    items.push({
      id: '__move_root',
      label: menuTranslate(opts?.ctx, 'app:common.menu.moveToRoot', 'Move to root'),
      icon: 'folder',
      onSelect: async () => {
        if (opts.onSelectFolder) {
          await opts.onSelectFolder(null)
        } else {
          await library.removeFromCollection(opts.currentFolderId!, allowedUrns).catch(() => {})
          opts.onMoved?.(null)
        }
      },
    })
  }

  const candidateCollections = opts?.currentFolderId
    ? collections.filter((c) => c.id !== opts.currentFolderId)
    : collections

  for (const collection of candidateCollections) {
    items.push({
      id: collection.id,
      label: collection.name,
      icon: 'folder',
      onSelect: async () => {
        if (opts?.onSelectFolder) {
          await opts.onSelectFolder(collection.id)
        } else {
          if (opts?.currentFolderId && opts.currentFolderId !== collection.id) {
            await library.removeFromCollection(opts.currentFolderId, allowedUrns).catch(() => {})
          }
          await library.addToCollection(collection.id, allowedUrns)
          opts?.onMoved?.(collection.id)
        }
      },
    })
  }

  return {
    title: opts?.title ?? menuTranslate(opts?.ctx, 'app:common.menu.addToCollection', 'Add to collection'),
    searchPlaceholder: opts?.searchPlaceholder ?? menuTranslate(opts?.ctx, 'app:common.menu.findCollection', 'Find collection'),
    emptyLabel: menuTranslate(opts?.ctx, 'app:common.menu.noMatchingCollections', 'No matching collections'),
    create: {
      label: opts?.createLabel ?? menuTranslate(opts?.ctx, 'app:common.menu.newCollection', 'New collection'),
      placeholder: menuTranslate(opts?.ctx, 'app:common.menu.collectionName', 'Collection name'),
      onSelect: async (name) => {
        const collection = await library.createCollection(name)
        if (opts?.onSelectFolder) {
          await opts.onSelectFolder(collection.id)
        } else {
          if (opts?.currentFolderId && opts.currentFolderId !== collection.id) {
            await library.removeFromCollection(opts.currentFolderId, allowedUrns).catch(() => {})
          }
          await library.addToCollection(collection.id, allowedUrns)
          opts?.onMoved?.(collection.id)
        }
      },
    },
    items,
  }
}
