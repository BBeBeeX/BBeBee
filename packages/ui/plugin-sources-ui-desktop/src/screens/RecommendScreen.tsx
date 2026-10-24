import { createElement as h, Fragment, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, StoreService, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@bbebee/plugin-sources/views'
import { useRecommendShelf, useRecommendSources, useSources } from '@bbebee/plugin-sources/hooks'
import { EmptyState, useI18n } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendShelfRow } from '../components/RecommendShelfRow.js'
import { SourceConfigureModal } from '../components/SourceConfigureModal.js'
import { OnboardingHero } from '../components/OnboardingHero.js'
import { OnboardingModal } from '../components/OnboardingModal.js'
import { useRecentPlayedAlbums } from '../hooks/useRecentPlayedAlbums.js'
import { useFavoriteAlbums } from '../hooks/useFavoriteAlbums.js'
import { usePlayAlbum } from '../hooks/usePlayAlbum.js'

/**
 * The recommendation shelf page.
 *
 * Ordered sections:
 * 1. Recently played unique tracks' albums (if any)
 * 2. Random 20 tracks from favorites' albums (if any)
 * 3. One shelf per recommend-capable third-party source
 *
 * Each row supports hover-activated 3D curved folded half-covers and scroll arrows.
 */
export function RecommendScreen({
  ctx,
  onOpenAlbum,
  showGuide,
  forceOnboarding,
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
  showGuide?: boolean
  forceOnboarding?: boolean
}): ReactElement {
  const { t } = useI18n(ctx)
  const sources = useRecommendSources(ctx)
  const allSources = useSources(ctx)
  const { albums: recentAlbums } = useRecentPlayedAlbums(ctx)
  const { albums: favoriteAlbums } = useFavoriteAlbums(ctx)
  const [guideModalOpen, setGuideModalOpen] = useState(false)

  useEffect(() => {
    if (showGuide || forceOnboarding) {
      setGuideModalOpen(true)
    }
  }, [showGuide, forceOnboarding])

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

  // Card body opens the album; the cover's play chip plays it. The chip
  // stops propagation in RecommendCard, so these never both fire.
  const playCard = usePlayAlbum(ctx)

  const hasAnyContent = recentAlbums.length > 0 || favoriteAlbums.length > 0 || sources.length > 0
  const isColdStart = !hasAnyContent && allSources.length === 0

  return h(
    Fragment,
    null,
    h(
      'section',
      {
        'aria-label': t('sources:recommend.recommendations'),
        'data-testid': 'recommend-screen',
        style: { display: 'flex', flexDirection: 'column', gap: tokens.space[5], padding: tokens.space[4] },
      },
      isColdStart
        ? h(OnboardingHero, {
            ctx,
            onOpenGuide: () => setGuideModalOpen(true),
          })
        : !hasAnyContent
          ? h(EmptyState, {
              title: t('sources:recommend.noRecommendations'),
              description: t('sources:recommend.onceAMusicSourceImplementing'),
            })
          : h(
              Fragment,
              null,
              // 1. Recent played tracks' albums (if any)
              recentAlbums.length > 0
                ? h(RecommendShelfRow, {
                    key: 'recent-played-albums',
                    ctx,
                    title: t('sources:recommend.recentlyPlayedAlbums'),
                    testID: 'recommend-shelf-recent-albums',
                    entries: recentAlbums,
                    onOpenCard: openCard,
                    onPlayCard: playCard,
                  })
                : null,
              // 2. Favorite songs' albums (if any)
              favoriteAlbums.length > 0
                ? h(RecommendShelfRow, {
                    key: 'favorite-albums',
                    ctx,
                    title: t('sources:recommend.favoritesPicksAlbums'),
                    testID: 'recommend-shelf-favorite-albums',
                    entries: favoriteAlbums,
                    onOpenCard: openCard,
                    onPlayCard: playCard,
                  })
                : null,
              // 3. Third-party music sources
              ...sources.map((source) =>
                h(RecommendShelf, {
                  key: source.sourceId,
                  ctx,
                  sourceId: source.sourceId,
                  sourceName: source.displayName,
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

function RecommendShelf({
  ctx,
  sourceId,
  sourceName,
  onOpenCard,
  onPlayCard,
}: {
  ctx: Context
  sourceId: string
  sourceName: string
  onOpenCard: (entry: BrowseEntry) => void
  onPlayCard: (entry: BrowseEntry) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const shelf = useRecommendShelf(ctx, sourceId)
  const [configureOpen, setConfigureOpen] = useState(false)

  const showAll = () => {
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.recommendAll, {
      sourceId,
      name: sourceName,
    })
  }

  return h(
    Fragment,
    null,
    h(RecommendShelfRow, {
      ctx,
      title: t('sources:recommend.recommendedPlaylists', { sourceName }),
      testID: `recommend-shelf-${sourceId}`,
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
      sourceId,
      open: configureOpen,
      onClose: () => {
        setConfigureOpen(false)
        shelf.reload()
      },
    }),
  )
}
