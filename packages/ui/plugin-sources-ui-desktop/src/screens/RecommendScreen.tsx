import { createElement as h, Fragment, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry, UiService } from '@BBeBee/protocol'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import { useRecommendShelf, useRecommendSources } from '@BBeBee/plugin-sources/hooks'
import { EmptyState } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendShelfRow } from '../components/RecommendShelfRow.js'
import { useRecentPlayedAlbums } from '../hooks/useRecentPlayedAlbums.js'
import { useFavoriteAlbums } from '../hooks/useFavoriteAlbums.js'

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
}: {
  ctx: Context
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const sources = useRecommendSources(ctx)
  const { albums: recentAlbums } = useRecentPlayedAlbums(ctx)
  const { albums: favoriteAlbums } = useFavoriteAlbums(ctx)

  const openCard = (entry: BrowseEntry) => {
    if (!entry.urn || entry.kind !== 'album') return
    onOpenAlbum?.(entry.urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn: entry.urn })
  }

  const hasAnyContent = recentAlbums.length > 0 || favoriteAlbums.length > 0 || sources.length > 0

  return h(
    'section',
    {
      'aria-label': 'Recommendations',
      'data-testid': 'recommend-screen',
      style: { display: 'flex', flexDirection: 'column', gap: tokens.space[5], padding: tokens.space[4] },
    },
    !hasAnyContent
      ? h(EmptyState, {
          title: '暂无推荐',
          description: '导入一个实现了推荐接口的音乐源后，这里会出现它的推荐歌单。',
        })
      : h(
          Fragment,
          null,
          // 1. Recent played tracks' albums (if any)
          recentAlbums.length > 0
            ? h(RecommendShelfRow, {
                key: 'recent-played-albums',
                ctx,
                title: '最近播放 · 专辑',
                testID: 'recommend-shelf-recent-albums',
                entries: recentAlbums,
                onOpenCard: openCard,
              })
            : null,
          // 2. Favorite songs' albums (if any)
          favoriteAlbums.length > 0
            ? h(RecommendShelfRow, {
                key: 'favorite-albums',
                ctx,
                title: '收藏随选 · 专辑',
                testID: 'recommend-shelf-favorite-albums',
                entries: favoriteAlbums,
                onOpenCard: openCard,
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
            }),
          ),
        ),
  )
}

function RecommendShelf({
  ctx,
  sourceId,
  sourceName,
  onOpenCard,
}: {
  ctx: Context
  sourceId: string
  sourceName: string
  onOpenCard: (entry: BrowseEntry) => void
}): ReactElement {
  const shelf = useRecommendShelf(ctx, sourceId)

  const showAll = () => {
    serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.recommendAll, {
      sourceId,
      name: sourceName,
    })
  }

  return h(RecommendShelfRow, {
    ctx,
    title: `${sourceName} · 推荐歌单`,
    testID: `recommend-shelf-${sourceId}`,
    action: {
      label: '显示全部',
      onPress: showAll,
      testID: 'recommend-show-all',
    },
    status: shelf.status,
    errorMessage: shelf.error?.message,
    onRetry: shelf.reload,
    entries: shelf.data ?? [],
    onOpenCard,
  })
}
