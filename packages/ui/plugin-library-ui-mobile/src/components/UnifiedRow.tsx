/**
 * The unified library row — the mobile transcription of the desktop twin's
 * `UnifiedLibraryRow`. One row shape for playlists, albums, folders and
 * artists: artwork (or the folder/favourite treatment), title, pin flag in
 * the subtitle line. Hover-only controls become touch affordances: the row
 * tap opens, the long-press opens the menu, and a folder row carries its own
 * expand chevron.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { ArtworkRef } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { c, Text, nativePrimitives, tablerIcon } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { CachedArtwork } from './CachedArtwork.js'

/** One row of the unified library. Same shape as the desktop twin's. */
export interface UnifiedItem {
  id: string
  urn?: string
  kind: 'playlist' | 'album' | 'collection' | 'favorite' | 'local' | 'artist'
  title: string
  subtitle: string
  creator?: string
  artwork?: ArtworkRef
  artworkSeed: string
  pinned: boolean
  addedAt: number
  lastPlayedAt?: number
  isDownloaded?: boolean
  onOpen: () => void
  onPlay: () => void
  onDelete?: () => void
  onMore: (anchor?: MenuAnchor) => void
}

export function UnifiedRow({
  ctx,
  item,
  isChild,
}: {
  ctx: Context
  item: UnifiedItem
  isFolder?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
  isChild?: boolean
}): ReactElement {
  const native = nativePrimitives()
  const isFav = item.kind === 'favorite'
  const isArt = item.kind === 'artist'

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: item.title,
      testID: `unified-row-${item.id}`,
      onPress: () => item.onOpen(),
      onLongPress: () => item.onMore(),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: 68,
        paddingVertical: 8,
        paddingHorizontal: 8,
        marginVertical: 4,
        borderRadius: 12,
        paddingLeft: isChild ? tokens.space[6] : 8,
      },
    },
    // The artwork slot: the favourite gradient, the folder square, or the
    // resolved cover with its identicon fallback — the same treatments as the
    // desktop row.
    h(
      native.View as never,
      {
        style: {
          width: 58,
          height: 58,
          borderRadius: isArt ? 29 : 8,
          overflow: 'hidden',
          flexShrink: 0,
        },
      },
      isFav
        ? h(
            native.View as never,
            {
              style: {
                width: 58,
                height: 58,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#8e8ee5',
              },
            },
            tablerIcon('heart-filled', { size: 30, color: '#FFFFFF' }) ??
              h(Text, { style: { color: '#FFFFFF', fontSize: 26 } }, '♥'),
          )
        : item.kind === 'collection'
          ? h(
              native.View as never,
              {
                style: {
                  width: 58,
                  height: 58,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c().bg.overlay,
                },
              },
              tablerIcon('folder', { size: 30, color: c().text.secondary }) ??
                h(Text, { style: { fontSize: 26 } }, '📁'),
            )
          : h(CachedArtwork, {
              ctx,
              artwork: item.artwork,
              seed: item.artworkSeed,
              size: 58,
              radius: isArt ? 29 : 8,
            }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0, gap: 4 } },
      h(Text, { numberOfLines: 1, style: { fontSize: 16, fontWeight: '600' }, children: item.title }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1] } },
        item.pinned
          ? tablerIcon('pin', { size: 14, color: c().accent.base }) ??
            h(Text, { style: { fontSize: 12 } }, '📌')
          : null,
        h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, style: { fontSize: 13 }, children: item.subtitle }),
      ),
    ),
  )
}
