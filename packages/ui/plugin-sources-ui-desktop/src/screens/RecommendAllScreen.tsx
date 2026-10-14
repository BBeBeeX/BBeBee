import { createElement as h, Fragment, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, UiService } from '@BBeBee/protocol'
import { useRecommendFeed } from '@BBeBee/plugin-sources/hooks'
import { Button, EmptyState, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from '../components/RecommendCard.js'
import { SourceConfigureModal } from '../components/SourceConfigureModal.js'

/**
 * One source's whole recommendation feed, as a grid.
 *
 * The page "Show all" lands on. Twenty cards per step — two of the feed's
 * ten-card pages — and a show-more control beneath, until a short page says
 * the curated list has run out and the control stands down.
 */
export function RecommendAllScreen({
  ctx,
  sourceId,
  name,
  onOpenAlbum,
}: {
  ctx: Context
  sourceId?: string
  name?: string
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const feed = useRecommendFeed(ctx, sourceId)
  const [configureOpen, setConfigureOpen] = useState(false)

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

  return h(
    'section',
    {
      'aria-label': t('sources:recommendAll.allRecommendations'),
      'data-testid': 'recommend-all-screen',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] },
    },
    h(
      Text,
      { variant: 'lg', testID: 'recommend-all-title' },
      t('sources:recommendAll.allRecommendedPlaylistsTitle', {
        name: name ?? t('sources:recommend.recommendations'),
      }),
    ),
    !sourceId
      ? h(EmptyState, { title: t('sources:recommendAll.noMusicSourceSelected'), description: t('sources:recommendAll.enterFromShowAllOn') })
      : feed.items.length === 0 && feed.loading
        ? h(Text, { variant: 'sm', tone: 'muted' }, t('sources:source.loading'))
        : feed.items.length === 0 && feed.error
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[2] } },
              h(Text, { variant: 'sm', tone: 'error' }, t('sources:recommendAll.failedToLoadRecommendations', { message: feed.error.message })),
              h(
                'div',
                { style: { display: 'flex', gap: tokens.space[3], alignItems: 'center' } },
                h(Button, { onPress: feed.loadMore, testID: 'recommend-retry', children: t('app:common.retry') }),
                sourceId
                  ? h(Button, { onPress: () => setConfigureOpen(true), testID: 'recommend-configure', children: t('sources:sourcesList.configure') })
                  : null,
              ),
            )
          : feed.items.length === 0
            ? h(EmptyState, { title: t('sources:recommendAll.thisSourceHasNoRecommendations'), description: t('sources:recommendAll.itImplementsTheRecommendationInterface') })
            : h(
                Fragment,
                null,
                h(
                  'div',
                  {
                    'data-testid': 'recommend-grid',
                    style: {
                      display: 'grid',
                      // Fixed tracks matching the card's fixed size: the kit's
                      // Artwork takes a numeric size, so the grid flows the
                      // cells rather than stretching the card.
                      gridTemplateColumns: 'repeat(auto-fill, 160px)',
                      gap: tokens.space[4],
                    },
                  },
                  ...feed.items.map((entry) =>
                    h(RecommendCard, {
                      key: entry.id,
                      ctx,
                      entry,
                      onPress: openCard,
                    }),
                  ),
                ),
                feed.error
                  ? h(Text, { variant: 'sm', tone: 'error' }, t('sources:source.failedToLoad', { message: feed.error.message }))
                  : null,
                feed.hasMore
                  ? h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'center', padding: tokens.space[2] } },
                      h(Button, {
                        onPress: feed.loadMore,
                        testID: 'recommend-show-more',
                        disabled: feed.loading,
                        loading: feed.loading,
                        children: feed.loading ? t('sources:source.loading') : t('sources:recommendAll.showMore'),
                      }),
                    )
                  : null,
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
