/**
 * React DOM views for `@BBeBee/plugin-queue`.
 *
 * Screen: the up-next list and recently played history tabs.
 * Every value comes from the shared bindings in `@BBeBee/toolkit/hooks` — the
 * queue model belongs to the player, the binding is toolkit's — and this file
 * handles layout, presentation, and event wiring only (docs/08 §1).
 */

import { createElement as h, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, QueueItem, QueueSourceContext, Track } from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import {
  queueTrackFallback,
  usePlayHistory,
  useQueue,
  useTracksByUrn,
  useTransport,
  useUpcoming,
} from '@BBeBee/toolkit/hooks'
import { ContextMenu, EmptyState, List, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import type { UseI18nResult } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { upcomingDropToQueueIndex } from './reorder.js'
import { QueueTrackRow } from './QueueTrackRow.js'

/** Catalogue keys for the label shown for a context that carries a kind but no label. */
const CONTEXT_KIND_LABEL_KEYS: Record<QueueSourceContext['kind'], string> = {
  album: 'queue:index.contextKindLabels.album',
  playlist: 'queue:index.contextKindLabels.playlist',
  artist: 'queue:index.contextKindLabels.artist',
  search: 'queue:index.contextKindLabels.search',
  radio: 'queue:index.contextKindLabels.radio',
  local: 'queue:index.contextKindLabels.local',
  favorites: 'queue:index.contextKindLabels.favorites',
}

function formatRelativeTime(t: UseI18nResult['t'], timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('queue:index.justNow')
  if (minutes < 60) return t('queue:index.minAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('queue:index.hrAgo', { hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('queue:index.daysAgo', { days })
  return new Date(timestamp).toLocaleDateString()
}

export interface QueueScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The up-next and recent play history screen with virtualised scrolling. */
export function QueueScreen({ ctx, onClose }: QueueScreenProps): ReactElement {
  const { t } = useI18n(ctx)
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const queue = useQueue(ctx)
  const upcoming = useUpcoming(ctx)
  const state = useTransport(ctx)
  const menu = useTrackMenu(ctx)

  // Drag-to-reorder. The refs carry everything the drop handler reads, because
  // the memoized rows keep their first handler closures: queue/upcoming are
  // mirrored every render, drag ids and drop indexes live only here.
  const queueRef = useRef(queue)
  queueRef.current = queue
  const upcomingRef = useRef(upcoming)
  upcomingRef.current = upcoming
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragIdRef = useRef<string | null>(null)
  const dropIndexRef = useRef<number | null>(null)

  // Under shuffle the visible order is a permutation, not the rows — a drop
  // position cannot be honoured, so dragging is off and the section says so.
  const shuffleOn = state.shuffle

  const resetDrag = () => {
    dragIdRef.current = null
    dropIndexRef.current = null
    setDragId(null)
    setDropIndex(null)
  }

  const hoverDrag = (e: React.DragEvent) => {
    e.preventDefault()
    const row = (e.currentTarget as HTMLElement).closest('[role="listitem"]')
    if (!row) return
    const rect = row.getBoundingClientRect()
    const before = e.clientY - rect.top < rect.height / 2
    const dataIdx = row.getAttribute('data-index')
    const itemIndex =
      dataIdx !== null
        ? parseInt(dataIdx, 10)
        : row.parentElement
          ? (Array.prototype.indexOf.call(row.parentElement.children, row) as number)
          : 0
    const at = Math.max(
      0,
      Math.min(
        upcomingRef.current.length,
        itemIndex + (before ? 0 : 1),
      ),
    )
    if (dropIndexRef.current !== at) {
      dropIndexRef.current = at
      setDropIndex(at)
    }
  }

  const commitDrag = () => {
    const id = dragIdRef.current
    const at = dropIndexRef.current
    resetDrag()
    if (!id || at === null) return
    const toIndex = upcomingDropToQueueIndex(id, at, queueRef.current, upcomingRef.current)
    ctx.player.moveItem(id, toIndex)
  }

  const keyboardMove = (id: string, direction: -1 | 1) => {
    const from = upcomingRef.current.findIndex((item) => item.id === id)
    if (from < 0) return
    // In drop-gap terms: moving up inserts before the row above; moving down
    // inserts before the row *two* ahead — "after the one below". One ahead
    // would be the gap right below the dragged row, which is where it is.
    const gap = direction === -1 ? from - 1 : from + 2
    if (gap < 0 || gap > upcomingRef.current.length) return
    const toIndex = upcomingDropToQueueIndex(id, gap, queueRef.current, upcomingRef.current)
    ctx.player.moveItem(id, toIndex)
  }

  // Queue tracks resolution
  const queueTrackUrns = queue.map((item) => item.trackUrn)
  const queueTracks = useTracksByUrn(ctx, queueTrackUrns)

  // Play history resolution (de-duplicated by trackUrn, preserving most recent occurrence, capped at 50)
  const { records: historyRecords, loading: historyLoading } = usePlayHistory(ctx, { limit: 100 })
  const { uniqueHistoryRecords, uniqueHistoryUrns } = useMemo(() => {
    const seen = new Set<string>()
    const list: PlayRecord[] = []
    const urns: string[] = []
    for (const record of historyRecords) {
      if (!seen.has(record.trackUrn)) {
        seen.add(record.trackUrn)
        list.push(record)
        urns.push(record.trackUrn)
        if (list.length >= 50) {
          break
        }
      }
    }
    return { uniqueHistoryRecords: list, uniqueHistoryUrns: urns }
  }, [historyRecords])

  const historyTracks = useTracksByUrn(ctx, uniqueHistoryUrns)

  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      ctx.ui?.navigate?.('library.home')
    }
  }

  const renderHeader = () =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexShrink: 0,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          },
        },
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('queue:index.queue'),
            onClick: () => setTab('queue'),
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
            },
          },
          h(
            'span',
            {
              style: {
                fontSize: 16,
                fontWeight: 700,
                color: tab === 'queue' ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #8E8E93)',
                transition: 'color 0.15s ease',
              },
            },
            t('queue:index.queue'),
          ),
          tab === 'queue'
            ? h('div', {
                style: {
                  height: 3,
                  width: '100%',
                  backgroundColor: 'var(--tab-active, var(--color-primary, #5F87FF))',
                  borderRadius: 2,
                  marginTop: 4,
                },
              })
            : h('div', { style: { height: 3, marginTop: 4 } }),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('queue:index.recentlyPlayed'),
            onClick: () => setTab('history'),
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
            },
          },
          h(
            'span',
            {
              style: {
                fontSize: 16,
                fontWeight: 700,
                color: tab === 'history' ? 'var(--bb-text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #8E8E93)',
                transition: 'color 0.15s ease',
              },
            },
            t('queue:index.recentlyPlayed'),
          ),
          tab === 'history'
            ? h('div', {
                style: {
                  height: 3,
                  width: '100%',
                  backgroundColor: 'var(--tab-active, var(--color-primary, #5F87FF))',
                  borderRadius: 2,
                  marginTop: 4,
                },
              })
            : h('div', { style: { height: 3, marginTop: 4 } }),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          'aria-label': t('queue:index.close'),
          title: t('queue:index.close'),
          onClick: handleClose,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: tokens.radius.pill,
            border: 'none',
            background: 'transparent',
            color: 'var(--bb-text-secondary, #8E8E93)',
            cursor: 'pointer',
            fontSize: 18,
            transition: 'all 0.15s ease',
            outline: 'none',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = 'var(--bb-text-primary, #FFFFFF)'
            e.currentTarget.style.transform = 'scale(1.1)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = 'var(--bb-text-secondary, #8E8E93)'
            e.currentTarget.style.transform = 'scale(1)'
          },
        },
        tablerIcon('x', { size: 20 }),
      ),
    )

  const renderQueueContent = () => {
    if (queue.length === 0) {
      return h(EmptyState, {
        icon: 'music',
        title: t('queue:index.nothingQueued'),
        description: t('queue:index.playSomethingFromYourLibrary'),
      })
    }

    let currentIdx = queue.findIndex(
      (item) =>
        item.id === state.currentItemId ||
        (state.trackUrn && item.trackUrn === state.trackUrn),
    )
    if (currentIdx === -1 && queue.length > 0) {
      currentIdx = 0
    }
    const currentItem = queue[currentIdx] ?? queue[0]
    if (!currentItem) {
      return h(EmptyState, {
        icon: 'music',
        title: t('queue:index.nothingQueued'),
        description: t('queue:index.playSomethingFromYourLibrary'),
      })
    }
    const currentTrack =
      queueTracks.get(currentItem.trackUrn) ??
      queueTrackFallback(currentItem, state.nowPlaying, true)

    // The real play order after the current item — under shuffle this is the
    // permutation, not the queue's row order.
    const upcomingItems = upcoming

    // The header describes the *next* song's origin, not the playing one's.
    const nextItem = upcomingItems[0]
    const nextContext = nextItem?.sourceContext
    const contextLabel = nextContext
      ? (nextContext.label ?? t(CONTEXT_KIND_LABEL_KEYS[nextContext.kind]))
      : undefined
    const nextTitle =
      nextItem && contextLabel ? t('queue:index.nextUpFrom', { contextLabel }) : t('queue:index.nextUp')

    const queueHeader = h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: 8,
        },
      },
      // Section 1: Now playing
      h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--bb-text-primary, #FFFFFF)',
              marginBottom: 8,
            },
          },
          t('queue:index.nowPlaying'),
        ),
        h(
          'div',
          { role: 'list', 'aria-label': t('queue:index.nowPlaying') },
          h(
            'div',
            { role: 'listitem', key: currentItem.id },
            h(QueueTrackRow, {
              ctx,
              track: currentTrack,
              active: true,
              itemId: currentItem.id,
              extraRight: currentTrack.durationMs
                ? formatDuration(currentTrack.durationMs)
                : undefined,
              onPress: () => void ctx.player.playFromContext(currentItem.trackUrn),
              onMore: (anchor) => menu.open({ track: currentTrack, queueItemId: currentItem.id }, anchor),
            }),
          ),
        ),
      ),
      // Section 2: Next up header
      h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--bb-text-primary, #FFFFFF)',
              marginTop: 12,
              marginBottom: 8,
            },
          },
          nextTitle,
        ),
        shuffleOn
          ? h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--bb-text-secondary, #8E8E93)',
                  marginBottom: 8,
                },
              },
              t('queue:index.shuffleOnNote'),
            )
          : null,
      ),
    )

    return h(
      'div',
      {
        style: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
        onDragOver: (e: React.DragEvent) => e.preventDefault(),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          commitDrag()
        },
      },
      h(List<QueueItem>, {
        items: upcomingItems,
        header: queueHeader,
        estimatedItemSize: 64,
        keyExtractor: (item) => item.id,
        empty: h(
          'div',
          {
            style: {
              fontSize: 13,
              color: 'var(--bb-text-secondary, #8E8E93)',
              padding: '12px 10px',
            },
          },
          t('queue:index.noMoreSongsQueued'),
        ),
        renderItem: (item, index) => {
          const track =
            queueTracks.get(item.trackUrn) ??
            queueTrackFallback(item, state.nowPlaying, item.id === state.currentItemId)
          return h(QueueTrackRow, {
            ctx,
            track,
            active: item.id === state.currentItemId,
            itemId: item.id,
            extraRight: track.durationMs ? formatDuration(track.durationMs) : undefined,
            onPress: () => void ctx.player.playFromContext(item.trackUrn),
            onMore: (anchor) => menu.open({ track, queueItemId: item.id }, anchor),
            draggable: !shuffleOn,
            dragging: dragId === item.id,
            dropBefore: dragId !== null && dropIndex === index,
            dropAfter: dragId !== null && dropIndex === upcomingItems.length && index === upcomingItems.length - 1,
            onDragStart: () => {
              dragIdRef.current = item.id
              setDragId(item.id)
            },
            onDragOver: hoverDrag,
            onDrop: (e: React.DragEvent) => {
              e.preventDefault()
              commitDrag()
            },
            onDragEnd: resetDrag,
            onKeyboardMove: (direction) => keyboardMove(item.id, direction),
          })
        },
      }),
    )
  }

  const renderHistoryContent = () => {
    if (uniqueHistoryRecords.length === 0 && !historyLoading) {
      return h(EmptyState, {
        icon: 'music',
        title: t('queue:index.noPlayRecordsYet'),
        description: t('queue:index.afterPlayingMusicFromThe'),
      })
    }

    return h(
      'div',
      {
        style: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      },
      h(List<PlayRecord>, {
        accessibilityLabel: t('queue:index.recentlyPlayed'),
        items: uniqueHistoryRecords,
        estimatedItemSize: 64,
        keyExtractor: (record) => record.id,
        renderItem: (record) => {
          const track: Track = historyTracks.get(record.trackUrn) ?? {
            urn: record.trackUrn,
            title: record.trackUrn.split(':').pop() ?? record.trackUrn,
            artists: [],
          }
          const isActive = state.trackUrn === record.trackUrn
          return h(QueueTrackRow, {
            ctx,
            track,
            active: isActive,
            extraRight: formatRelativeTime(t, record.startedAt),
            onPress: () => void ctx.player.playFromContext(record.trackUrn, uniqueHistoryUrns),
            onMore: (anchor) => menu.open({ track, historyRecordId: record.id }, anchor),
          })
        },
      }),
    )
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px 16px 8px 16px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'var(--bb-bg-base, var(--bg-primary, var(--color-bg-primary, #080A10)))',
        color: 'var(--bb-text-primary, #FFFFFF)',
      },
    },
    renderHeader(),
    h(
      'div',
      {
        style: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      },
      tab === 'queue' ? renderQueueContent() : renderHistoryContent(),
    ),
    h(ContextMenu, menu.menuProps),
  )
}
