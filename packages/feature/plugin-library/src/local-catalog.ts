/**
 * Whole-catalogue reads over the *local* source, shared by the library shell's
 * hydration pass.
 *
 * `listTracks`/`listAlbums` are paged, and every caller that wants "all local
 * music" needs the same drain-until-`hasMore` loop with the same page size.
 * Written once here so the two shells cannot grow two different page sizes —
 * and so a change to the paging convention is one edit.
 */

import type { Album, SourcesService, Track } from '@BBeBee/protocol'

/** Every track the local source currently knows about, across all pages. */
export async function fetchAllLocalTracks(sources: SourcesService): Promise<Track[]> {
  const all: Track[] = []
  let cursor: string | undefined
  do {
    const page = await sources.listTracks({
      sourceIds: ['local'],
      page: cursor ? { cursor, limit: 500 } : { limit: 500 },
    })
    all.push(...page.items)
    cursor = page.hasMore && page.cursor ? page.cursor : undefined
  } while (cursor)
  return all
}

/** Every album the local source currently knows about, across all pages. */
export async function fetchAllLocalAlbums(sources: SourcesService): Promise<Album[]> {
  if (!sources.listAlbums) return []
  const all: Album[] = []
  let cursor: string | undefined
  do {
    const page = await sources.listAlbums({
      sourceIds: ['local'],
      page: cursor ? { cursor, limit: 500 } : { limit: 500 },
    })
    all.push(...page.items)
    cursor = page.hasMore && page.cursor ? page.cursor : undefined
  } while (cursor)
  return all
}
