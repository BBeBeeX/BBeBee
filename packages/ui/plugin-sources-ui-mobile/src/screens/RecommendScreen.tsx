/**
 * The recommend page — the mobile twin of the desktop `RecommendScreen`, and
 * the shell's first tab ("首页").
 *
 * Same sections in the same order (recent albums, favorite albums, one shelf
 * per recommend-capable source), same hooks — all of them live in
 * `@bbebee/plugin-sources/hooks`, which is the whole point: nothing here
 * would need to be written twice, so nothing is.
 *
 * **Cold start**: like the desktop, the first run with no sources opens the
 * onboarding guide — the mobile transcription renders only the sources step
 * (see `OnboardingModal`); the desktop's plugins step is deliberately not
 * ported.
 */

import { createElement as h, Fragment, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, MediaProvider, StoreService, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import {
  useFavoriteAlbums,
  usePlayAlbum,
  useRecentPlayedAlbums,
  useRecommendShelf,
  useRecommendSources,
  useSources,
} from '@bbebee/plugin-sources/hooks'
import { BOTTOM_CHROME_HEIGHT, EmptyState, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendShelfRow } from '../components/RecommendShelfRow.js'
import { SourceConfigureModal } from '../SourceConfigureModal.js'
import { OnboardingModal } from '../components/OnboardingModal.js'

export interface RecommendScreenProps {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
  /** Opened from the settings About page's guide row — same param as desktop. */
  showGuide?: boolean
}

/** One vertical-list section: either a resolved album shelf or a source shelf. */
type Section =
  | { kind: 'static'; key: string; title: string; entries: readonly BrowseEntry[] }
  | { kind: 'source'; key: string; provider: MediaProvider }

export function RecommendScreen({ ctx, onOpenAlbum, showGuide }: RecommendScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const allSources = useSources(ctx)
  const recommendSources = useRecommendSources(ctx)
  const { albums: recentAlbums } = useRecentPlayedAlbums(ctx)
  const { albums: favoriteAlbums } = useFavoriteAlbums(ctx)
  const playCard = usePlayAlbum(ctx)
  const [guideModalOpen, setGuideModalOpen] = useState(false)

  useEffect(() => {
    if (showGuide) {
      setGuideModalOpen(true)
    }
  }, [showGuide])

  // First run with no sources: open the guide, same trigger as the desktop.
  useEffect(() => {
    let cancelled = false
    const store = serviceOf<StoreService>(ctx, 'store')
    if (store && allSources.length === 0) {
      store
        .get<boolean>('onboarding.completed')
        .then((completed) => {
          if (!cancelled && !completed) {
            setGuideModalOpen(true)
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [ctx, allSources.length])

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
    Fragment,
    null,
    h(
      native.View as never,
      {
        accessibilityLabel: t('sources:recommend.recommendations'),
        testID: 'recommend-screen',
        style: { flex: 1, padding: tokens.space[4] },
      },
      isColdStart
        ? h(EmptyState, {
            icon: 'music',
            title: t('sources:recommend.coldStartTitle'),
            description: t('sources:recommend.coldStartDescription'),
          })
        : !hasAnyContent
          ? h(EmptyState, {
              icon: 'music',
              title: t('sources:recommend.noRecommendations'),
              description: t('sources:recommend.onceAMusicSourceImplementing'),
            })

          : h(
              (native.ScrollView ?? native.View) as never,
              {
                contentContainerStyle: { gap: tokens.space[5], paddingBottom: BOTTOM_CHROME_HEIGHT },
                showsVerticalScrollIndicator: false,
              },
              ...sections.map((item) =>
                item.kind === 'static'
                  ? h(RecommendShelfRow, {
                      key: item.key,
                      ctx,
                      title: item.title,
                      testID: `recommend-shelf-${item.key}`,
                      entries: item.entries,
                      onOpenCard: openCard,
                      onPlayCard: playCard,
                    })
                  : h(SourceShelf, {
                      key: item.key,
                      ctx,
                      provider: item.provider,
                      onOpenCard: openCard,
                      onPlayCard: playCard,
                    }),
              ),
            ),
    ),
    h(OnboardingModal, {
      ctx,
      open: guideModalOpen,
      onClose: () => setGuideModalOpen(false),
    }),
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
