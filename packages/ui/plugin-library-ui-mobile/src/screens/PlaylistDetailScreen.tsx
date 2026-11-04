import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { usePlaylist } from '@bbebee/plugin-library/hooks'
import { useTracksByUrn } from '@bbebee/plugin-player/hooks'
import type { SettingsService } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { Button, ContextMenu, EmptyState, IconButton, List, Text, TrackRow, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'

/* ── one playlist ──────────────────────────────────────────────────────── */

export function PlaylistDetailScreen({ ctx, urn }: { ctx: Context; urn?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const state = usePlaylist(ctx, urn)
  const detail = state.data
  const urns = detail?.items.map((item) => item.trackUrn) ?? []
  const tracks = useTracksByUrn(ctx, urns)
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx, { fromPlaylistUrn: urn })
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )

  const play = (trackUrn: string) => {
    if (!detail) return
    void ctx.player.playFromContext(trackUrn, urns, {
      context: { kind: 'playlist', urn: detail.urn, label: detail.name },
    })
  }

  if (!urn) return h(EmptyState, { title: t('library:playlistDetail.noPlaylistChosen') })
  if (state.status === 'error') {
    return h(EmptyState, { title: t('library:playlistDetail.couldNotOpenThePlaylist'), description: state.error?.message })
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
        h(Text, { variant: 'xl', numberOfLines: 1 }, detail.name),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          detail.isSmart
            ? t('library:playlistDetail.smartPlaylistDescription')
            : (detail.trackCount ?? urns.length) === 1
              ? t('library:playlistDetail.tracksOne', { count: detail.trackCount ?? urns.length })
              : t('library:playlistDetail.tracksOther', { count: detail.trackCount ?? urns.length }),
        ),
      ),
      h(Button, {
        onPress: () => urns[0] && play(urns[0]),
        disabled: urns.length === 0,
        testID: 'playlist-play',
        children: t('library:playlistDetail.play'),
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'playlist-tracks',
        items: urns,
        keyExtractor: (trackUrn, index) => `${trackUrn}:${index}`,
        empty: h(EmptyState, {
          icon: 'music',
          title: t('library:playlistDetail.nothingHereYet'),
          description: detail.isSmart
            ? t('library:playlistDetail.noTrackMatchesTheseRules')
            : t('library:playlistDetail.addTracksToFill'),
        }),
        renderItem: (trackUrn, index) => {
          const track = tracks.get(trackUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, trackUrn)
          return h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center' } },
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () => play(trackUrn),
                onMore: (anchor) =>
                  menu.open({ track, playlistItemId: detail.items[index]?.id }, anchor),
              }),
            ),
            detail.isSmart
              ? null
              : h(IconButton, {
                  icon: 'x',

                  // The item's own id, not the track URN: the same track twice
                  // in a playlist is two rows, and removing one must not
                  // remove both.
                  accessibilityLabel: t('library:index.removeFrom', { title: track.title, name: detail.name }),
                  variant: 'ghost',
                  onPress: () => {
                    const item = detail.items[index]
                    if (!item) return
                    setError(undefined)
                    void ctx.library.removeItems(detail.urn, [item.id]).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                  },
                }),
          )
        },
      }),
    ),
    h(ContextMenu, { ctx, ...menu.menuProps, liquid: liquidGlass }),
  )
}
