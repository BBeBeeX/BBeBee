/**
 * React DOM views for `@BBeBee/plugin-queue`.
 *
 * Screen: the up-next list and recently played history tabs.
 * Every value comes from the shared bindings in `@BBeBee/toolkit/hooks` — the
 * queue model belongs to the player, the binding is toolkit's — and this file
 * handles layout, presentation, and event wiring only (docs/08 §1).
 */

import { createElement as h, memo, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PlayRecord, QueueSourceContext, Track } from '@BBeBee/protocol'
import { QUEUE_VIEWS } from '@BBeBee/plugin-queue/views'
import { formatDuration } from '@BBeBee/toolkit'
import {
  queueTrackFallback,
  usePlayHistory,
  useQueue,
  useResolvedArtwork,
  useTracksByUrn,
  useTransport,
  useUpcoming,
} from '@BBeBee/toolkit/hooks'
import { Artwork, ContextMenu, EmptyState, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { tokens } from '@BBeBee/ui-tokens'
import { upcomingDropToQueueIndex } from './reorder.js'

/** Label shown for a context that carries a kind but no label. */
const CONTEXT_KIND_LABELS: Record<QueueSourceContext['kind'], string> = {
  album: '专辑',
  playlist: '歌单',
  artist: '歌手',
  search: '搜索',
  radio: '电台',
  local: '本地音乐',
  favorites: '收藏夹',
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

interface QueueTrackRowProps {
  ctx: Context
  track: Track
  active?: boolean
  itemId?: string
  extraRight?: string
  onPress?: () => void
  onMore?: (anchor: { x: number; y: number }) => void
  /** Present on upcoming rows only; shuffle and the fixed sections get none. */
  draggable?: boolean
  dragging?: boolean
  /** Accent line at the row's top edge marking where the drop would land. */
  dropBefore?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  /** Alt+↑/↓ reorder for keyboard users; wired on upcoming rows only. */
  onKeyboardMove?: (direction: -1 | 1) => void
}

const QueueTrackRow = memo(
  function QueueTrackRow({
    ctx,
    track,
    active = false,
    itemId,
    extraRight,
    onPress,
    onMore,
    draggable = false,
    dragging = false,
    dropBefore = false,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onKeyboardMove,
  }: QueueTrackRowProps): ReactElement {
  const [hovered, setHovered] = useState(false)
  const artwork = useResolvedArtwork(ctx, track.artwork)
  const artists = track.artists?.map((a) => a.name).join(', ')

  return h(
    'div',
    {
      role: 'row',
      tabIndex: 0,
      'data-track-urn': track.urn,
      'data-item-id': itemId,
      draggable,
      onDragStart: draggable && onDragStart ? onDragStart : undefined,
      onDragOver: draggable ? onDragOver : undefined,
      onDrop: draggable ? onDrop : undefined,
      onDragEnd: draggable ? onDragEnd : undefined,
      onClick: onPress,
      onContextMenu: onMore
        ? (e: { preventDefault: () => void; clientX?: number; clientY?: number }) => {
            e.preventDefault()
            onMore({ x: e.clientX ?? 0, y: e.clientY ?? 0 })
          }
        : undefined,
      onKeyDown: (e: { key: string; altKey?: boolean; preventDefault: () => void }) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPress?.()
        }
        if (onKeyboardMove && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          onKeyboardMove(e.key === 'ArrowUp' ? -1 : 1)
        }
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        borderRadius: tokens.radius.sm,
        position: 'relative',
        cursor: draggable ? 'grab' : 'pointer',
        opacity: dragging ? 0.4 : 1,
        background: hovered ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
        transition: 'background-color 0.15s ease',
        outline: 'none',
      },
    },
    dropBefore
      ? h('div', {
          'aria-hidden': true,
          style: {
            position: 'absolute',
            top: -2,
            left: 8,
            right: 8,
            height: 2,
            borderRadius: 2,
            background: 'var(--tab-active, var(--color-primary, #5F87FF))',
            pointerEvents: 'none',
          },
        })
      : null,
    h(Artwork, {
      artwork,
      seed: track.urn,
      size: 48,
      radius: tokens.radius.sm,
    }),
    h(
      'div',
      {
        style: {
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        },
      },
      h(
        'span',
        {
          'data-active': active ? 'true' : undefined,
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: active ? 'var(--color-primary, var(--primary, #5F87FF))' : '#FFFFFF',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        track.title,
      ),
      artists
        ? h(
            'span',
            {
              style: {
                fontSize: 12,
                color: '#A0A0AE',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            artists,
          )
        : null,
    ),
    extraRight
      ? h(
          'span',
          {
            style: {
              fontSize: 12,
              color: '#8E8E93',
              flexShrink: 0,
              marginLeft: 8,
            },
          },
          extraRight,
        )
      : null,
  )
},
(prev, next) =>
  prev.track.urn === next.track.urn &&
  prev.track.title === next.track.title &&
  prev.track.artwork === next.track.artwork &&
  prev.active === next.active &&
  prev.itemId === next.itemId &&
  prev.extraRight === next.extraRight &&
  prev.draggable === next.draggable &&
  prev.dragging === next.dragging &&
  prev.dropBefore === next.dropBefore,
)

export interface QueueScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The up-next and recent play history screen. */
export function QueueScreen({ ctx, onClose }: QueueScreenProps): ReactElement {
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
    const list = row?.parentElement
    if (!row || !list) return
    const rect = row.getBoundingClientRect()
    const before = e.clientY - rect.top < rect.height / 2
    const at = Math.max(
      0,
      Math.min(
        upcomingRef.current.length,
        (Array.prototype.indexOf.call(list.children, row) as number) + (before ? 0 : 1),
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

  // Play history resolution (de-duplicated by trackUrn, preserving most recent occurrence)
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
            'aria-label': '队列',
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
                color: tab === 'queue' ? '#FFFFFF' : '#8E8E93',
                transition: 'color 0.15s ease',
              },
            },
            '队列',
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
            'aria-label': '最近播放',
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
                color: tab === 'history' ? '#FFFFFF' : '#8E8E93',
                transition: 'color 0.15s ease',
              },
            },
            '最近播放',
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
          'aria-label': '关闭',
          title: '关闭',
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
            color: '#8E8E93',
            cursor: 'pointer',
            fontSize: 18,
            transition: 'all 0.15s ease',
            outline: 'none',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = '#FFFFFF'
            e.currentTarget.style.transform = 'scale(1.1)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.color = '#8E8E93'
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
        title: 'Nothing queued',
        description: 'Play something from your library and it will show up here.',
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
        title: 'Nothing queued',
        description: 'Play something from your library and it will show up here.',
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
      ? (nextContext.label ?? CONTEXT_KIND_LABELS[nextContext.kind])
      : undefined
    const nextTitle = nextItem && contextLabel ? `下一首歌来自： ${contextLabel}` : '下一首播放'

    return h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          minHeight: 0,
        },
      },
      // Section 1: 当前播放
      h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 700,
              color: '#FFFFFF',
              marginBottom: 8,
            },
          },
          '当前播放',
        ),
        h(
          'div',
          { role: 'list', 'aria-label': '当前播放' },
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
      // Section 2: 下一首播放
      h(
        'div',
        null,
        h(
          'div',
          {
            style: {
              fontSize: 15,
              fontWeight: 700,
              color: '#FFFFFF',
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
                  color: '#8E8E93',
                  marginBottom: 8,
                },
              },
              '随机播放中：顺序由随机种子决定，暂不支持拖拽排序',
            )
          : null,
        upcomingItems.length > 0
          ? h(
              'div',
              {
                role: 'list',
                'aria-label': nextTitle,
                onDragOver: (e: React.DragEvent) => e.preventDefault(),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault()
                  commitDrag()
                },
              },
              upcomingItems.map((item, index) => {
                const track =
                  queueTracks.get(item.trackUrn) ??
                  queueTrackFallback(item, state.nowPlaying, item.id === state.currentItemId)
                return h(
                  'div',
                  { role: 'listitem', key: item.id },
                  h(QueueTrackRow, {
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
                  }),
                )
              }),
              dragId !== null && dropIndex === upcomingItems.length
                ? h('div', {
                    'aria-hidden': true,
                    style: {
                      height: 2,
                      margin: '0 10px',
                      borderRadius: 2,
                      background: 'var(--tab-active, var(--color-primary, #5F87FF))',
                    },
                  })
                : null,
            )
          : h(
              'div',
              {
                style: {
                  fontSize: 13,
                  color: '#8E8E93',
                  padding: '12px 10px',
                },
              },
              '队列中暂无更多待播歌曲',
            ),
      ),
    )
  }

  const renderHistoryContent = () => {
    if (uniqueHistoryRecords.length === 0 && !historyLoading) {
      return h(EmptyState, {
        icon: 'music',
        title: '暂无播放记录',
        description: '从曲库播放音乐后，最近播放的歌曲将显示在这里。',
      })
    }

    return h(
      'div',
      {
        role: 'list',
        'aria-label': '最近播放',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minHeight: 0,
        },
      },
      uniqueHistoryRecords.map((record) => {
        const track: Track = historyTracks.get(record.trackUrn) ?? {
          urn: record.trackUrn,
          title: record.trackUrn.split(':').pop() ?? record.trackUrn,
          artists: [],
        }
        const isActive = state.trackUrn === record.trackUrn
        return h(
          'div',
          { role: 'listitem', key: record.id },
          h(QueueTrackRow, {
            ctx,
            track,
            active: isActive,
            extraRight: formatRelativeTime(record.startedAt),
            onPress: () => void ctx.player.playFromContext(record.trackUrn, uniqueHistoryUrns),
            onMore: (anchor) => menu.open({ track, historyRecordId: record.id }, anchor),
          }),
        )
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
        padding: '16px 16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        background: 'var(--bg-primary, var(--color-bg-primary, #080A10))',
      },
    },
    renderHeader(),
    tab === 'queue' ? renderQueueContent() : renderHistoryContent(),
    h(ContextMenu, menu.menuProps),
  )
}

import { QueueButton, type QueueButtonProps } from './QueueButton.js'

export { QueueButton, type QueueButtonProps }

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-queue-ui-desktop'
export const inject = ['ui', 'player', 'sources']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-queue-ui-desktop: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(QUEUE_VIEWS.queue, bound(ctx, QueueScreen))
    yield ctx.ui.registerView('queue.button', bound(ctx, QueueButton))
    yield ctx.ui.contribute({
      kind: 'slot',
      id: 'queue.button',
      slot: 'now-playing.actions',
      order: 30,
    })
  }, 'queue-ui-desktop')
}

export default { name, inject, apply }
