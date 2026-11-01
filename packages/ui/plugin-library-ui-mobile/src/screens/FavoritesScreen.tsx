import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { QueueSourceContext } from '@BBeBee/protocol'
import { useSaved } from '@bbebee/plugin-library/hooks'
import { useTracksByUrn } from '@bbebee/plugin-player/hooks'
import { Button, ContextMenu, EmptyState, IconButton, List, Text, TrackRow, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'

/* ── favorites ────────────────────────────────────────────────────────── */

export function FavoritesScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const saved = useSaved(ctx, 'track')
  const entries = saved.data ?? []
  const urns = entries.map((entry) => entry.urn)
  const tracks = useTracksByUrn(ctx, urns)
  const player = serviceOf<{
    playFromContext(urn: string, contextUrns?: readonly string[], opts?: { context?: QueueSourceContext }): Promise<void>
  }>(ctx, 'player')
  const [error, setError] = useState<string | undefined>(undefined)
  const menu = useTrackMenu(ctx)

  return h(
    native.View as never,
    { style: { flex: 1, backgroundColor: c().bg.base, padding: tokens.space[4], gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      h(Text, { variant: 'xl' }, t('library:unifiedLibrary.favorites')),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        urns.length === 1
          ? t('library:favorites.savedOne', { count: urns.length })
          : t('library:favorites.savedOther', { count: urns.length }),
      ),
      h(Button, {
        variant: 'secondary',
        onPress: () =>
          urns[0] &&
          player?.playFromContext(urns[0], urns, {
            context: { kind: 'favorites', label: t('library:favorites.favorites') },
          }),
        disabled: urns.length === 0,
        children: t('library:favorites.playAll'),
      }),
    ),
    error ? h(Text, { variant: 'sm', tone: 'error' }, error) : null,
    saved.status === 'error'
      ? h(Text, { tone: 'error' }, t('library:favorites.couldNotReadFavorites', { message: saved.error?.message ?? '' }))
      : null,
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<string>, {
        testID: 'favorites-list',
        items: urns,
        keyExtractor: (entryUrn) => entryUrn,
        empty: h(EmptyState, {
          icon: '♡',
          title: t('library:index.nothingSavedYet'),
          description: t('library:index.saveATrackFromThe'),
        }),
        renderItem: (entryUrn) => {
          const track = tracks.get(entryUrn)
          if (!track) return h(Text, { variant: 'sm', tone: 'muted' }, entryUrn)
          return h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center' } },
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(TrackRow, {
                track,
                onPress: () =>
                  player?.playFromContext(entryUrn, urns, {
                    context: { kind: 'favorites', label: t('library:favorites.favorites') },
                  }),
                onMore: (anchor) => menu.open({ track }, anchor),
              }),
            ),
            h(IconButton, {
              icon: '♥',
              accessibilityLabel: t('library:index.removeFromFavorites', { title: track.title }),
              variant: 'primary',
              onPress: () => {
                setError(undefined)
                void ctx.library
                  .setSaved(entryUrn, false)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
              },
            }),
          )
        },
      }),
    ),
    h(ContextMenu, { ctx, ...menu.menuProps }),
  )
}
