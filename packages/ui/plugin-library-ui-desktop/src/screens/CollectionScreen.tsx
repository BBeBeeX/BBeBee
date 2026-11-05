import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { formatDuration } from '@BBeBee/toolkit'
import { useCollectionView, type CollectionMember } from '@bbebee/plugin-library/hooks'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { Artwork, Button, ContextMenu, EmptyState, List, SaveToPlaylistPopover, Text, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { TrackLibraryActionButton } from '../components/TrackLibraryActionButton.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'
import { useTransport } from '@BBeBee/toolkit/hooks'

function CollectionTrackTableRow({
  ctx,
  track,
  active,
  isPlaying: _isPlaying,
  onPress,
  onMore,
  inLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  ctx: Context
  track: Track
  active?: boolean
  isPlaying?: boolean
  onPress: () => void
  onMore: (anchor: MenuAnchor) => void
  inLibrary: boolean
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const [hovered, setHovered] = useState(false)
  const artists = track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick: onPress,
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        onMore({ x: e.clientX, y: e.clientY })
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onPress()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        height: 56,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        background: hovered
          ? 'rgba(255, 255, 255, 0.08)'
          : active
            ? 'rgba(95, 135, 255, 0.08)'
            : 'transparent',
        borderLeft: active ? '3px solid var(--color-primary, #5F87FF)' : '3px solid transparent',
        transition: 'background-color 0.15s ease',
        boxSizing: 'border-box',
        width: '100%',
      },
    },
    h(Artwork, {
      artwork: track.artwork,
      seed: track.urn,
      size: tokens.size.artworkThumb,
    }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0, marginLeft: tokens.space[3], overflow: 'hidden' } },
      h(
        'span',
        {
          style: {
            color: active ? 'var(--color-primary, #5F87FF)' : 'var(--bb-text-primary, #FFFFFF)',
            fontSize: 14,
            fontWeight: active ? 600 : 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'block',
          },
        },
        track.title,
      ),
      artists ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: artists }) : null,
    ),
    h(
      'div',
      {
        style: {
          width: 120,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          paddingRight: 8,
        },
      },
      h(TrackLibraryActionButton, {
        ctx,
        track,
        hovered,
        inLibrary,
        onAddToFavorites: () => onAddToFavorites?.(track),
        onOpenPlaylistMenu,
      }),
      h(
        'span',
        {
          style: {
            fontSize: 13,
            color: 'var(--bb-text-secondary, #b3b3b3)',
            width: 45,
            textAlign: 'right',
          },
        },
        formatDuration(track.durationMs),
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': t('library:libraryTrack.more'),
          title: t('library:libraryTrack.more'),
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: 'var(--bb-text-secondary, #b3b3b3)',
            cursor: 'pointer',
            padding: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          },
        },
        tablerIcon('dots', { size: 20 }),
      ),
    ),
  )
}

/** An album/playlist/unknown member: a labelled row that opens where it can. */
function MemberRow({ member, onOpen }: { member: CollectionMember; onOpen: () => void }): ReactElement {
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    'button',
    {
      type: 'button',
      disabled: !openable,
      onClick: openable ? onOpen : undefined,
      'aria-label': member.title,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        width: '100%',
        height: tokens.size.row,
        padding: `0 ${tokens.space[3]}px`,
        border: 'none',
        borderRadius: tokens.radius.sm,
        background: 'transparent',
        cursor: openable ? 'pointer' : 'default',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
      },
    },
    member.kind === 'album'
      ? tablerIcon('disc', { size: 22 })
      : member.kind === 'playlist'
        ? tablerIcon('playlist', { size: 22 })
        : tablerIcon('dots', { size: 22 }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, member.title),
      member.subtitle ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, member.subtitle) : null,
    ),
    openable ? tablerIcon('chevron-right', { size: 20, color: 'var(--bb-text-secondary, #b3b3b3)' }) : null,
  )
}

/**
 * A collection is a folder, so its rows are whatever its members are: tracks
 * play, albums open the album page, playlists open the playlist page. A
 * member the catalogue cannot answer for still shows — titled by its URN —
 * because hiding it would silently lose something the user put there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const transport = useTransport(ctx)
  const {
    detail,
    collectionName,
    sortedMembers: members,
    trackUrns,
    loading,
    error,
    playTrack,
    playAll,
  } = useCollectionView(ctx, id)

  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)

  if (!id) return h(EmptyState, { title: t('library:collection.noCollectionChosen') })
  if (error) {
    return h(EmptyState, { title: t('library:collection.couldNotOpenTheCollection'), description: error })
  }
  if (!detail || loading) return h(EmptyState, { title: t('library:collection.loading') })

  const displayName = collectionName || t('library:collection.collectionFallback')

  return h(
    'section',
    {
      'aria-label': displayName,
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, displayName),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          members.length === 1
            ? t('library:collection.itemsOne', { count: members.length })
            : t('library:collection.itemsOther', { count: members.length }),
        ),
      ),
      h(Button, {
        onPress: () => void playAll(),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: t('library:playlistDetail.play'),
      }),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...members],
        estimatedItemSize: tokens.size.row,
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: 'folder',
          title: t('library:collection.nothingInThisCollectionYet'),
          description: t('library:collection.addAlbumsOrPlaylistsFrom'),
        }),
        renderItem: (member) => {
          const track = member.track
          if (member.kind === 'track' && track) {
            return h(CollectionTrackTableRow, {
              ctx,
              track,
              active: transport?.trackUrn === track.urn,
              isPlaying: transport?.trackUrn === track.urn && transport?.status === 'playing',
              inLibrary: isTrackInLibrary(track, true),
              onAddToFavorites: handleAddToFavorites,
              onOpenPlaylistMenu: openAddToPlaylistMenu,
              onPress: () => void playTrack(track.urn),
              onMore: (anchor) => menu.open({ track }, anchor),
            })
          }
          return h(MemberRow, {
            member,
            onOpen: () => {
              if (member.kind === 'album') {
                // 'album.view' is plugin-album's view descriptor id — serialized data, a literal, not an import.
                ctx.ui.navigate('album.view', { urn: member.urn })
              } else if (member.kind === 'playlist') ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
            },
          })
        },
      }),
    ),
    h(ContextMenu, menu.menuProps),
    h(SaveToPlaylistPopover, saveToPlaylistMenuProps),
  )
}
