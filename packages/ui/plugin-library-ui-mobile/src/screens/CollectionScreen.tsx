import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { QueueSourceContext } from '@BBeBee/protocol'
import { useCollectionDetail, type CollectionMember } from '@bbebee/plugin-library/hooks'
import { ALBUM_VIEWS } from '@bbebee/plugin-album/views'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { Button, ContextMenu, EmptyState, List, Text, TrackRow, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'

/* ── one collection ────────────────────────────────────────────────────── */

/**
 * A collection is a folder: tracks play, albums open the album page,
 * playlists open the playlist page. A member no service can answer for still
 * shows, titled by its URN — hiding it would lose something the user put
 * there.
 */
export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const state = useCollectionDetail(ctx, id)
  const detail = state.data
  const members = detail?.members ?? []
  const trackUrns = members
    .filter((member) => member.kind === 'track' && member.track)
    .map((member) => member.urn)
  const menu = useTrackMenu(ctx)
  const player = serviceOf<{ playNow(urns: string[], opts?: { context?: QueueSourceContext }): Promise<void> }>(ctx, 'player')

  if (!id) return h(EmptyState, { title: t('library:collection.noCollectionChosen') })
  if (state.status === 'error') {
    return h(EmptyState, { title: t('library:collection.couldNotOpenTheCollection'), description: state.error?.message })
  }
  if (!detail) return h(EmptyState, { title: t('library:collection.loading') })

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.collection?.name ?? t('library:collection.collectionFallback')),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          members.length === 1
            ? t('library:collection.itemsOne', { count: members.length })
            : t('library:collection.itemsOther', { count: members.length }),
        ),
      ),
      h(Button, {
        onPress: () =>
          trackUrns[0] &&
          void player?.playNow(trackUrns, {
            context: { kind: 'playlist', label: detail.collection?.name ?? t('library:collection.collectionFallback') },
          }),
        disabled: trackUrns.length === 0,
        testID: 'collection-play',
        children: t('library:playlistDetail.play'),
      }),
    ),
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: [...members],
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: '🗂',
          title: t('library:collection.nothingInThisCollectionYet'),
          description: t('library:collection.addAlbumsOrPlaylistsFrom'),
        }),
        renderItem: (member) => {
          if (member.kind === 'track' && member.track) {
            return h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center' } },
              h(
                native.View as never,
                { style: { flex: 1, minWidth: 0 } },
                h(TrackRow, {
                  track: member.track,
                  onPress: () =>
                    void player?.playNow(trackUrns, {
                      context: { kind: 'playlist', label: detail.collection?.name ?? t('library:collection.collectionFallback') },
                    }),
                  onMore: (anchor) => menu.open({ track: member.track! }, anchor),
                }),
              ),
            )
          }
          return h(MemberRow, {
            member,
            onOpen: () => {
              if (member.kind === 'album') ctx.ui.navigate(ALBUM_VIEWS.album, { urn: member.urn })
              else if (member.kind === 'playlist') ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
            },
          })
        },
      }),
    ),
    h(ContextMenu, { ctx, ...menu.menuProps }),
  )
}

/** An album/playlist/unknown member: a labelled row that opens where it can. */
function MemberRow({ member, onOpen }: { member: CollectionMember; onOpen: () => void }): ReactElement {
  const native = nativePrimitives()
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    native.Pressable as never,
    {
      accessibilityRole: openable ? 'button' : undefined,
      accessibilityLabel: member.title,
      disabled: !openable,
      onPress: openable ? onOpen : undefined,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
      },
    },
    h(Text, { variant: 'md' }, member.kind === 'album' ? '💿' : member.kind === 'playlist' ? '≡' : '•'),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { numberOfLines: 1 }, member.title),
      member.subtitle ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1 }, member.subtitle) : null,
    ),
  )
}
