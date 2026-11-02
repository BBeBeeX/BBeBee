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
import { c, IconButton, Text, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
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
  isFolder,
  isExpanded,
  onToggleExpand,
  isChild,
}: {
  ctx: Context
  item: UnifiedItem
  isFolder?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
  isChild?: boolean
}): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const isFav = item.kind === 'favorite'
  const isArt = item.kind === 'artist'

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: item.title,
      onPress: () => item.onOpen(),
      onLongPress: () => item.onMore(),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
        paddingLeft: isChild ? tokens.space[6] : 0,
      },
    },
    // The artwork slot: the favourite gradient, the folder square, or the
    // resolved cover with its identicon fallback — the same treatments as the
    // desktop row.
    h(
      native.View as never,
      {
        style: {
          width: 48,
          height: 48,
          borderRadius: isArt ? 24 : 4,
          overflow: 'hidden',
          flexShrink: 0,
        },
      },
      isFav
        ? h(
            native.View as never,
            {
              style: {
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#8e8ee5',
              },
            },
            tablerIcon('heart-filled', { size: 26, color: '#FFFFFF' }) ??
              h(Text, { style: { color: '#FFFFFF', fontSize: 22 } }, '♥'),
          )
        : isFolder || item.kind === 'collection'
          ? h(
              native.View as never,
              {
                style: {
                  width: 48,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c().bg.overlay,
                },
              },
              tablerIcon('folder', { size: 26, color: c().text.secondary }) ??
                h(Text, { style: { fontSize: 22 } }, '📁'),
            )
          : h(CachedArtwork, {
              ctx,
              artwork: item.artwork,
              seed: item.artworkSeed,
              size: 48,
              radius: isArt ? 24 : 4,
            }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1, children: item.title }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[1], marginTop: 2 } },
        item.pinned
          ? tablerIcon('pin', { size: 14, color: c().accent.base }) ??
            h(Text, { style: { fontSize: 12 } }, '📌')
          : null,
        h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: item.subtitle }),
      ),
    ),
    // The overflow affordance: the desktop row's right-click / hover menu, as
    // the platform's explicit ⋯ button (a long-press also opens the menu).
    h(IconButton, {
      icon: '⋯',
      accessibilityLabel: t('library:index.moreActionsFor', { name: item.title }),
      variant: 'ghost',
      onPress: () => item.onMore(),
    }),
    // Folder rows expand inline: the children render below, indented.
    isFolder
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: isExpanded
              ? t('library:unifiedLibrary.collapseFolder')
              : t('library:unifiedLibrary.expandFolder'),
            onPress: () => {
              onToggleExpand?.()
            },
            style: {
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          tablerIcon('chevron-down', {
            size: 18,
            color: c().text.secondary,
          }) ?? h(Text, { style: { fontSize: 16, color: c().text.secondary } }, isExpanded ? '▴' : '▾'),
        )
      : null,
  )
}
