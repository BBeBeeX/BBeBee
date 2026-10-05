import { createElement as h, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayNowOptions, Track } from '@BBeBee/protocol'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { formatDuration } from '@BBeBee/toolkit'
import { useCollectionDetail, type CollectionMember } from '@BBeBee/plugin-library/hooks'
import { serviceOf, type MenuAnchor } from '@BBeBee/ui-core'
import { Artwork, Button, ContextMenu, EmptyState, List, SaveToPlaylistPopover, Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { TrackLibraryActionButton } from '../components/TrackLibraryActionButton.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

function CollectionTrackTableRow({
  track,
  onPress,
  onMore,
  inLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  track: Track
  onPress: () => void
  onMore: (anchor: MenuAnchor) => void
  inLibrary: boolean
  onAddToFavorites?: (track: Track) => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
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
        background: hovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
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
      h(Text, { numberOfLines: 1, children: track.title }),
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
            color: '#b3b3b3',
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
          'aria-label': 'More',
          title: '更多',
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onMore({ x: rect.left, y: rect.bottom + 4 })
          },
          style: {
            background: 'none',
            border: 'none',
            color: '#b3b3b3',
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
    openable ? tablerIcon('chevron-right', { size: 20, color: '#b3b3b3' }) : null,
  )
}

/**
 * A collection is a folder, so its rows are whatever its members are: tracks
 * play, albums open the album page, playlists open the playlist page. A
 * member the catalogue cannot answer for still shows — titled by its URN —
 * because hiding it would silently lose something the user put there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const tracks = detail?.members ?? []
  const trackUrns = tracks
    .filter((member) => member.kind === 'track' && member.track)
    .map((member) => member.urn)
  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleAddToFavorites,
    openAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)


  if (!id) return h(EmptyState, { title: 'No collection chosen' })
  if (state.status === 'error') {
    return h(EmptyState, { title: 'Could not open the collection', description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: 'Loading…' })

  const players = serviceOf<{ playNow(urns: string[], opts?: PlayNowOptions): Promise<void> }>(ctx, 'player')

  return h(
    'section',
    {
      'aria-label': detail.collection?.name ?? 'Collection',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3], padding: tokens.space[4], height: '100%' },
    },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3] } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.collection?.name ?? 'Collection'),
        h(Text, { variant: 'sm', tone: 'muted' }, `${detail.members.length} items`),
      ),
      h(Button, {
        onPress: () =>
          trackUrns[0] &&
          void players?.playNow(trackUrns, {
            context: { kind: 'playlist', label: detail.collection?.name ?? '合集' },
          }),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: 'Play',
      }),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...(detail.members ?? [])],
        estimatedItemSize: tokens.size.row,
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: 'folder',
          title: 'Nothing in this collection yet',
          description: 'Add albums or playlists from the library.',
        }),
        renderItem: (member) => {
          if (member.kind === 'track' && member.track) {
            return h(CollectionTrackTableRow, {
              track: member.track,
              inLibrary: isTrackInLibrary(member.track, true),
              onAddToFavorites: handleAddToFavorites,
              onOpenPlaylistMenu: openAddToPlaylistMenu,
              onPress: () =>
                void players
                  ?.playNow(trackUrns, {
                    context: { kind: 'playlist', label: detail.collection?.name ?? '合集' },
                  })
                  .then(() => {
                    /* playNow starts at the first track; the context is the collection */
                  }),
              onMore: (anchor) => menu.open({ track: member.track! }, anchor),
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
