/**
 * The recommend page — the mobile twin of the desktop `RecommendScreen`, and
 * the shell's first tab ("首页").
 *
 * Same sections in the same order (recent albums, favorite albums, one shelf
 * per recommend-capable source), same hooks — all of them live in
 * `@bbebee/plugin-sources/hooks`, which is the whole point: nothing here
 * would need to be written twice, so nothing is.
 *
 * **Cold start**: desktop renders its onboarding hero and first-run wizard;
 * mobile deliberately degrades to an explicit empty state pointing at import
 * instead of porting the wizard — an honest "nothing here yet" rather than a
 * second, divergent onboarding to maintain.
 */

import { createElement as h, Fragment, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, MediaProvider, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import {
  useFavoriteAlbums,
  usePlayAlbum,
  useRecentPlayedAlbums,
  useRecommendShelf,
  useRecommendSources,
  useSources,
} from '@bbebee/plugin-sources/hooks'
import { EmptyState, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendShelfRow } from '../components/RecommendShelfRow.js'
import { SourceConfigureModal } from '../SourceConfigureModal.js'

export interface RecommendScreenProps {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}

/** One vertical-list section: either a resolved album shelf or a source shelf. */
type Section =
  | { kind: 'static'; key: string; title: string; entries: readonly BrowseEntry[] }
  | { kind: 'source'; key: string; provider: MediaProvider }

export function RecommendScreen({ ctx, onOpenAlbum }: RecommendScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const allSources = useSources(ctx)
  const recommendSources = useRecommendSources(ctx)
  const { albums: recentAlbums } = useRecentPlayedAlbums(ctx)
  const { albums: favoriteAlbums } = useFavoriteAlbums(ctx)
  const playCard = usePlayAlbum(ctx)

  const openCard = (entry: BrowseEntry) => {
    if (!entry.urn || entry.kind !== 'album') return
    onOpenAlbum?.(entry.urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn: entry.urn })
  }

  const hasAnyContent = recentAlbums.length > 0 || favoriteAlbums.length > 0 || recommendSources.length > 0
  const isColdStart = !hasAnyContent && allSources.length === 0

  const sections: Section[] = []
  if (recentAlbums.length > 0) {
    sections.push({
      kind: 'static',
      key: 'recent-played-albums',
      title: t('sources:recommend.recentlyPlayedAlbums'),
      entries: recentAlbums,
    })
  }
  if (favoriteAlbums.length > 0) {
    sections.push({
      kind: 'static',
      key: 'favorite-albums',
      title: t('sources:recommend.favoritesPicksAlbums'),
      entries: favoriteAlbums,
    })
  }
  for (const provider of recommendSources) {
    sections.push({ kind: 'source', key: provider.sourceId, provider })
  }

  return h(
    native.View as never,
    {
      accessibilityLabel: t('sources:recommend.recommendations'),
      testID: 'recommend-screen',
      style: { flex: 1, padding: tokens.space[4] },
    },
    isColdStart
      ? h(EmptyState, {
          icon: '🎵',
          title: t('sources:recommend.coldStartTitle'),
          description: t('sources:recommend.coldStartDescription'),
        })
      : !hasAnyContent
        ? h(EmptyState, {
            icon: '🎵',
            title: t('sources:recommend.noRecommendations'),
            description: t('sources:recommend.onceAMusicSourceImplementing'),
          })
        : h(
            // The page is a handful of shelves, so it scrolls as one
            // recycled list of sections rather than one long ScrollView —
            // a source count that outgrows the screen keeps scrolling cold.
            native.FlashList as never,
            {
              data: sections,
              keyExtractor: (section: Section) => section.key,
              renderItem: ({ item }: { item: Section }) =>
                item.kind === 'static'
                  ? h(RecommendShelfRow, {
                      ctx,
                      title: item.title,
                      testID: `recommend-shelf-${item.key}`,
                      entries: item.entries,
                      onOpenCard: openCard,
                      onPlayCard: playCard,
                    })
                  : h(SourceShelf, {
                      ctx,
                      provider: item.provider,
                      onOpenCard: openCard,
                      onPlayCard: playCard,
                    }),
              contentContainerStyle: { gap: tokens.space[5] },
            },
          ),
  )
}

/**
 * One source's shelf plus its configure modal — its own component for the
 * same reason as the desktop twin: the shelf and the modal it can open share
 * state the album shelves do not have.
 */
function SourceShelf({
  ctx,
  provider,
  onOpenCard,
  onPlayCard,
}: {
  ctx: Context
  provider: MediaProvider
  onOpenCard: (entry: BrowseEntry) => void
  onPlayCard: (entry: BrowseEntry) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const shelf = useRecommendShelf(ctx, provider.sourceId)
  const [configureOpen, setConfigureOpen] = useState(false)

  const showAll = () => {
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.recommendAll, {
      sourceId: provider.sourceId,
      name: provider.displayName,
    })
  }

  return h(
    Fragment,
    null,
    h(RecommendShelfRow, {
      ctx,
      title: t('sources:recommend.recommendedPlaylists', { sourceName: provider.displayName }),
      testID: `recommend-shelf-${provider.sourceId}`,
      action: {
        label: t('sources:recommend.showAll'),
        onPress: showAll,
        testID: 'recommend-show-all',
      },
      status: shelf.status,
      errorMessage: shelf.error?.message,
      onRetry: shelf.reload,
      onConfigure: () => setConfigureOpen(true),
      entries: shelf.data ?? [],
      onOpenCard,
      onPlayCard,
    }),
    h(SourceConfigureModal, {
      ctx,
      sourceId: provider.sourceId,
      open: configureOpen,
      onClose: () => {
        setConfigureOpen(false)
        shelf.reload()
      },
    }),
  )
}
