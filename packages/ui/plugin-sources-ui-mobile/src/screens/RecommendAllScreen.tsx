/**
 * One source's whole recommendation feed — the mobile twin of the desktop
 * `RecommendAllScreen`, the page a shelf's "show all" lands on.
 *
 * Same feed hook, same step semantics (twenty cards per step, a short page
 * stands the show-more control down). The grid is a recycled list of two-card
 * rows rather than desktop's CSS grid: cards keep their fixed width and the
 * recycling rule (rules/ui.md §3) holds on a feed that can run long.
 */

import { createElement as h, Fragment, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, UiService } from '@BBeBee/protocol'
import { usePlayAlbum, useRecommendFeed } from '@bbebee/plugin-sources/hooks'
import { Button, EmptyState, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from '../components/RecommendCard.js'
import { SourceConfigureModal } from '../SourceConfigureModal.js'

export interface RecommendAllScreenProps {
  ctx: Context
  sourceId?: string
  name?: string
  onOpenAlbum?: (urn: string) => void
}

export function RecommendAllScreen({
  ctx,
  sourceId,
  name,
  onOpenAlbum,
}: RecommendAllScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const feed = useRecommendFeed(ctx, sourceId)
  const [configureOpen, setConfigureOpen] = useState(false)
  const playCard = usePlayAlbum(ctx)

  const openCard = (entry: BrowseEntry) => {
    if (!entry.urn) return
    if (entry.kind === 'playlist') {
      serviceOf<UiService>(ctx, 'ui')?.navigate('library.playlist', { urn: entry.urn })
      return
    }
    if (entry.kind === 'album') {
      onOpenAlbum?.(entry.urn)
      serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn: entry.urn })
    }
  }

  const rows: (readonly BrowseEntry[])[] = []
  for (let i = 0; i < feed.items.length; i += 2) {
    rows.push(feed.items.slice(i, i + 2))
  }

  return h(
    Fragment,
    null,
    h(
      native.View as never,
      {
        accessibilityLabel: t('sources:recommendAll.allRecommendations'),
        testID: 'recommend-all-screen',
        style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] },
      },
      h(
        Text,
        { variant: 'lg', testID: 'recommend-all-title' },
        t('sources:recommendAll.allRecommendedPlaylistsTitle', {
          name: name ?? t('sources:recommend.recommendations'),
        }),
      ),
      !sourceId
        ? h(EmptyState, {
            title: t('sources:recommendAll.noMusicSourceSelected'),
            description: t('sources:recommendAll.enterFromShowAllOn'),
          })
        : feed.items.length === 0 && feed.loading
          ? h(Text, { variant: 'sm', tone: 'muted', children: t('sources:source.loading') })
          : feed.items.length === 0 && feed.error
            ? h(
                native.View as never,
                { style: { gap: tokens.space[2] } },
                h(
                  Text,
                  { variant: 'sm', tone: 'error' },
                  t('sources:recommendAll.failedToLoadRecommendations', { message: feed.error.message }),
                ),
                h(
                  native.View as never,
                  { style: { flexDirection: 'row', gap: tokens.space[3] } },
                  h(Button, {
                    variant: 'ghost',
                    onPress: feed.reload,
                    testID: 'recommend-retry',
                    children: t('app:common.retry'),
                  }),
                  h(Button, {
                    variant: 'ghost',
                    onPress: () => setConfigureOpen(true),
                    testID: 'recommend-configure',
                    children: t('sources:sourcesList.configure'),
                  }),
                ),
              )
            : feed.items.length === 0
              ? h(EmptyState, {
                  title: t('sources:recommendAll.thisSourceHasNoRecommendations'),
                  description: t('sources:recommendAll.itImplementsTheRecommendationInterface'),
                })
              : h(
                  Fragment,
                  null,
                  h(
                    native.FlashList as never,
                    {
                      data: rows,
                      keyExtractor: (row: readonly BrowseEntry[]) => row.map((e) => e.id).join('|'),
                      renderItem: ({ item }: { item: readonly BrowseEntry[] }) =>
                        h(
                          native.View as never,
                          { style: { flexDirection: 'row', gap: tokens.space[4] } },
                          ...item.map((entry) =>
                            h(RecommendCard, {
                              key: entry.id,
                              ctx,
                              entry,
                              onPress: openCard,
                              onPlay: playCard,
                            }),
                          ),
                        ),
                      contentContainerStyle: { gap: tokens.space[4] },
                    },
                  ),
                  feed.error
                    ? h(
                        Text,
                        { variant: 'sm', tone: 'error' },
                        t('sources:source.failedToLoad', { message: feed.error.message }),
                      )
                    : null,
                  feed.hasMore
                    ? h(Button, {
                        onPress: feed.loadMore,
                        testID: 'recommend-show-more',
                        disabled: feed.loading,
                        loading: feed.loading,
                        children: feed.loading
                          ? t('sources:source.loading')
                          : t('sources:recommendAll.showMore'),
                      })
                    : null,
                ),
    ),
    h(SourceConfigureModal, {
      ctx,
      sourceId,
      open: configureOpen,
      onClose: () => {
        setConfigureOpen(false)
        feed.reload()
      },
    }),
  )
}
