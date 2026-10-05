/**
 * Folder-tree flattening for `ctx.library`.
 *
 * A collection folder is a tree, but the player plays a flat list of URNs:
 * "play this folder" has to walk every descendant collection and collect the
 * tracks they hold — including tracks reached through a playlist or an album
 * sitting inside the folder. Written once here (headless, no React) so the
 * desktop library screen's batch actions and any future shell share one
 * traversal and one notion of what a folder contains.
 *
 * Failures are swallowed deliberately: a folder whose album fetch fails still
 * plays the tracks that did resolve — a half-playable folder beats a folder
 * that refuses to play at all.
 */

import type { Context } from 'cordis'
import type { AlbumDetail, Collection } from '@BBeBee/protocol'
import { tryParseUrn } from '@BBeBee/protocol'

export async function collectAllFolderTracks(
  ctx: Context,
  collectionId: string,
  allCollections: readonly Collection[] = [],
  albumsMap: Map<string, AlbumDetail> = new Map(),
): Promise<string[]> {
  const visited = new Set<string>()
  const trackUrns = new Set<string>()

  function getDescendants(id: string): string[] {
    const direct = allCollections.filter((c) => c.parentId === id).map((c) => c.id)
    const result: string[] = [...direct]
    for (const d of direct) {
      result.push(...getDescendants(d))
    }
    return result
  }

  const folderIds = [collectionId, ...getDescendants(collectionId)]

  for (const fId of folderIds) {
    if (visited.has(fId)) continue
    visited.add(fId)
    try {
      const page = await ctx.library.listCollectionItems(fId, { limit: 1000 })
      for (const item of page.items ?? []) {
        const parsed = tryParseUrn(item.urn)
        const kind = parsed?.kind
        if (kind === 'track') {
          trackUrns.add(item.urn)
        } else if (kind === 'playlist') {
          try {
            const detail = await ctx.library.getPlaylist(item.urn)
            for (const pi of detail?.items ?? []) {
              trackUrns.add(pi.trackUrn)
            }
          } catch {
            // ignore
          }
        } else if (kind === 'album') {
          try {
            let album = albumsMap.get(item.urn)
            if (!album && ctx.sources?.getAlbum) {
              album = await ctx.sources.getAlbum(item.urn)
            }
            for (const t of album?.tracks ?? []) {
              trackUrns.add(t.urn)
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(trackUrns)
}
