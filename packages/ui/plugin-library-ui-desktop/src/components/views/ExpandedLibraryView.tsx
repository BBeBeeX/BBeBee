import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { formatAddedDate, formatPlayedDate } from '@BBeBee/toolkit'
import { CachedArtwork } from '../CachedArtwork.js'
import type { UnifiedItem } from '../UnifiedLibraryRow.js'
import {
  LIBRARY_FILTER_BUTTONS,
  LIBRARY_SORT_LABELS,
  type LibraryFilterKey,
  type LibrarySortMode,
} from '../LibraryToolbar.js'

export interface ExpandedLibraryViewProps {
  ctx: Context
  activeFolderId: string | null
  activeCollection?: Collection
  setActiveFolderId: (id: string | null) => void
  handleModeChange: (mode: 'sidebar') => void
  renderCreateButton: () => ReactElement
  renderCreateMenu: (isCollapsed: boolean) => ReactElement | null
  openCollectionMenu: (collection: Collection, anchor: MenuAnchor, isPinned: boolean) => void
  isItemPinned: (item: { id?: string; urn?: string }) => boolean

  searchQuery: string
  setSearchQuery: (query: string) => void
  sortMode: LibrarySortMode
  setSortMenuAnchor: (anchor: MenuAnchor | undefined) => void

  activeFilter: LibraryFilterKey
  setActiveFilter: (filter: LibraryFilterKey) => void
  /** The 艺人 chip only makes sense when the library actually holds artists. */
  hasArtists?: boolean

  filteredItems: readonly UnifiedItem[]
  filteredFolderItems: readonly UnifiedItem[]

  modals: ReactElement
  contextMenus: ReactElement
}

export function ExpandedLibraryView({
  ctx,
  activeFolderId,
  activeCollection,
  setActiveFolderId,
  handleModeChange,
  renderCreateButton,
  renderCreateMenu,
  openCollectionMenu,
  isItemPinned,

  searchQuery,
  setSearchQuery,
  sortMode,
  setSortMenuAnchor,

  activeFilter,
  setActiveFilter,
  hasArtists = true,

  filteredItems,
  filteredFolderItems,

  modals,
  contextMenus,
}: ExpandedLibraryViewProps): ReactElement {
  if (activeFolderId !== null) {
    return h(
      'section',
      {
        'aria-label': activeCollection?.name ?? 'Folder Expanded',
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          padding: 24,
          boxSizing: 'border-box',
          overflowY: 'auto',
          overflowX: 'hidden',
          userSelect: 'none',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h(
            'button',
            {
              type: 'button',
              onClick: () => setActiveFolderId(null),
              title: '返回音乐库',
              style: {
                background: 'transparent',
                border: 'none',
                color: 'var(--bb-text-secondary, #A0A0AE)',
                fontSize: 24,
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
              },
            },
            '音乐库',
          ),
          tablerIcon('chevron-left', { size: 22, color: 'var(--bb-text-secondary, #666666)' }),
          h(
            'h1',
            { style: { fontSize: 24, fontWeight: 700, color: 'var(--bb-text-primary, #FFFFFF)', margin: 0 } },
            activeCollection?.name ?? '文件夹',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12, position: 'relative' } },
          renderCreateButton(),
          renderCreateMenu(false),
          activeCollection
            ? h(
                'button',
                {
                  type: 'button',
                  'aria-label': '更多选项',
                  title: '更多选项',
                  onClick: (e: { clientX: number; clientY: number }) => {
                    openCollectionMenu(
                      activeCollection,
                      { x: e.clientX, y: e.clientY },
                      isItemPinned({ id: activeCollection.id }),
                    )
                  },
                  style: {
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--bb-text-secondary, #A0A0AE)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease',
                  },
                  onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
                  },
                  onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                    e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
                  },
                },
                tablerIcon('dots', { size: 20 }),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              'aria-label': '收起音乐库',
              title: '收起音乐库',
              onClick: () => handleModeChange('sidebar'),
              style: {
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                color: 'var(--bb-text-secondary, #A0A0AE)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
              },
            },
            tablerIcon('minimize', { size: 20 }),
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            gap: 16,
          },
        },
        h(
          'span',
          {
            style: {
              padding: '6px 14px',
              borderRadius: 16,
              backgroundColor: 'var(--surface-raised, var(--bb-bg-raised, #282828))',
              color: 'var(--text-primary, var(--bb-text-primary, #FFFFFF))',
              fontSize: 13,
              fontWeight: 600,
            },
          },
          '创建者: 你',
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'var(--input-bg, #242424)',
                borderRadius: 4,
                border: '1px solid var(--input-border, rgba(255, 255, 255, 0.1))',
                padding: '6px 12px',
                width: 220,
              },
            },
            h('span', { style: { color: 'var(--bb-text-secondary, #888888)', display: 'inline-flex', alignItems: 'center' } }, tablerIcon('search', { size: 18 })),
            h('input', {
              value: searchQuery,
              onChange: (e: { target: { value: string } }) => setSearchQuery(e.target.value),
              placeholder: '在歌单中搜索',
              style: {
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary, var(--bb-text-primary, #FFFFFF))',
                fontSize: 13,
                outline: 'none',
                width: '100%',
              },
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: (e: { clientX: number; clientY: number }) =>
                setSortMenuAnchor({ x: e.clientX, y: e.clientY }),
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--bb-text-secondary, #A0A0AE)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              },
            },
            h('span', null, LIBRARY_SORT_LABELS[sortMode]),
            tablerIcon('list', { size: 20 }),
          ),
        ),
      ),
      h(
        'div',
        { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
              color: 'var(--bb-text-secondary, #A0A0AE)',
              fontSize: 12,
              marginBottom: 8,
            },
          },
          h('div', { style: { flex: 2 } }, '标题'),
          h('div', { style: { flex: 1 } }, '添加日期'),
          h('div', { style: { flex: 1, textAlign: 'right' } }, '已播'),
        ),
        filteredFolderItems.map((item) => {
          const isFav = item.kind === 'favorite'
          const isArt = item.kind === 'artist'
          return h(
            'div',
            {
              key: item.id,
              onClick: () => item.onOpen(),
              onContextMenu: (e: { preventDefault(): void; clientX?: number; clientY?: number }) => {
                e.preventDefault()
                item.onMore({ x: e.clientX ?? 0, y: e.clientY ?? 0 })
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                padding: '8px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              },
              onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.06))'
              },
              onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              },
            },
            h(
              'div',
              { style: { flex: 2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 } },
              h(
                'div',
                {
                  style: {
                    width: 48,
                    height: 48,
                    borderRadius: isArt ? '50%' : 4,
                    overflow: 'hidden',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isFav ? '#FFFFFF' : undefined,
                    backgroundColor: isFav ? 'transparent' : 'var(--surface-1, rgba(255, 255, 255, 0.05))',
                    background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
                  },
                },
                isFav
                  ? tablerIcon('heart-filled', { size: 24, color: 'currentColor' })
                  : item.artwork
                    ? h(CachedArtwork, {
                        ctx,
                        artwork: item.artwork,
                        seed: item.artworkSeed,
                        size: 48,
                        radius: isArt ? 24 : 4,
                      })
                    : isArt
                      ? tablerIcon('user', { size: 28, color: 'var(--bb-text-secondary, #A0A0A0)' })
                      : item.kind === 'local'
                        ? tablerIcon('folder', { size: 28, color: 'var(--bb-text-secondary, #A0A0A0)' })
                        : item.kind === 'album'
                          ? tablerIcon('disc', { size: 28, color: 'var(--bb-text-secondary, #A0A0A0)' })
                          : tablerIcon('music', { size: 28, color: 'var(--bb-text-secondary, #A0A0A0)' }),
              ),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h(
                  'div',
                  {
                    style: {
                      color: 'var(--bb-text-primary, #FFFFFF)',
                      fontWeight: 500,
                      fontSize: 14,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  item.title,
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 } },
                  item.pinned
                    ? h('span', { title: '已置顶', style: { display: 'inline-flex', alignItems: 'center', color: 'var(--color-primary, #5F87FF)', marginRight: 2 } }, tablerIcon('pin', { size: 16, color: 'var(--color-primary, #5F87FF)' }))
                    : null,
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--bb-text-secondary, #A0A0AE)',
                        fontSize: 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    },
                    item.subtitle,
                  ),
                ),
              ),
            ),
            h(
              'div',
              { style: { flex: 1, color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 13 } },
              formatAddedDate(item.addedAt),
            ),
            h(
              'div',
              { style: { flex: 1, color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 13, textAlign: 'right' } },
              formatPlayedDate(item.lastPlayedAt),
            ),
          )
        }),
      ),
      modals,
      contextMenus,
    )
  }

  // Root expanded library
  return h(
    'section',
    {
      'aria-label': 'Library Expanded',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: 24,
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        },
      },
      h('h1', { style: { fontSize: 26, fontWeight: 700, color: 'var(--bb-text-primary, #FFFFFF)', margin: 0 } }, '音乐库'),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 12, position: 'relative' } },
        renderCreateButton(),
        renderCreateMenu(false),
        h(
          'button',
          {
            type: 'button',
            'aria-label': '收起音乐库',
            title: '收起音乐库',
            onClick: () => handleModeChange('sidebar'),
            style: {
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: 'var(--bb-text-secondary, #A0A0AE)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
            },
          },
          tablerIcon('minimize', { size: 20 }),
        ),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          gap: 16,
        },
      },
      h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        LIBRARY_FILTER_BUTTONS.filter(({ key }) => key !== 'artist' || hasArtists).map(({ key, label }) => {
          const active = activeFilter === key
          return h(
            'button',
            {
              key,
              type: 'button',
              onClick: () => setActiveFilter(active ? 'all' : key),
              style: {
                padding: '6px 14px',
                borderRadius: 16,
                border: 'none',
                backgroundColor: active ? 'var(--color-primary, #5F87FF)' : 'var(--surface-1, #242424)',
                color: active ? 'var(--bb-accent-on, #FFFFFF)' : 'var(--bb-text-secondary, #A0A0AE)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              },
            },
            label,
          )
        }),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'var(--input-bg, #242424)',
              borderRadius: 4,
              border: '1px solid var(--input-border, rgba(255, 255, 255, 0.1))',
              padding: '6px 12px',
              width: 220,
            },
          },
          tablerIcon('search', { size: 18, color: 'var(--bb-text-secondary, #888888)' }),
          h('input', {
            value: searchQuery,
            onChange: (e: { target: { value: string } }) => setSearchQuery(e.target.value),
            placeholder: '在音乐库中搜索',
            style: {
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary, var(--bb-text-primary, #FFFFFF))',
              fontSize: 13,
              outline: 'none',
              width: '100%',
            },
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: (e: { clientX: number; clientY: number }) =>
              setSortMenuAnchor({ x: e.clientX, y: e.clientY }),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--bb-text-secondary, #A0A0AE)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            },
          },
          h('span', null, LIBRARY_SORT_LABELS[sortMode]),
          tablerIcon('list', { size: 20 }),
        ),
      ),
    ),
    h(
      'div',
      { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            color: 'var(--bb-text-secondary, #A0A0AE)',
            fontSize: 12,
            marginBottom: 8,
          },
        },
        h('div', { style: { flex: 2 } }, '标题'),
        h('div', { style: { flex: 1 } }, '添加日期'),
        h('div', { style: { flex: 1, textAlign: 'right' } }, '已播'),
      ),
      filteredItems.map((item) => {
        const isFav = item.kind === 'favorite'
        const isArt = item.kind === 'artist'
        return h(
          'div',
          {
            key: item.id,
            onClick: () => item.onOpen(),
            style: {
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.06))'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            },
          },
          h(
            'div',
            { style: { flex: 2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 } },
            h(
              'div',
              {
                style: {
                  width: 48,
                  height: 48,
                  borderRadius: isArt ? '50%' : 4,
                  overflow: 'hidden',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isFav ? '#FFFFFF' : undefined,
                  backgroundColor: isFav ? 'transparent' : 'var(--surface-1, rgba(255, 255, 255, 0.05))',
                  background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
                },
              },
              isFav
                ? tablerIcon('heart-filled', { size: 26, color: 'currentColor' })
                : item.artwork
                  ? h(CachedArtwork, {
                      ctx,
                      artwork: item.artwork,
                      seed: item.artworkSeed,
                      size: 48,
                      radius: isArt ? 24 : 4,
                    })
                  : (isArt
                      ? tablerIcon('user', { size: 24, color: 'var(--bb-text-secondary, #A0A0A0)' })
                      : item.kind === 'local'
                        ? tablerIcon('folder', { size: 24, color: 'var(--bb-text-secondary, #A0A0A0)' })
                        : item.kind === 'album'
                          ? tablerIcon('disc', { size: 24, color: 'var(--bb-text-secondary, #A0A0A0)' })
                          : tablerIcon('music', { size: 24, color: 'var(--bb-text-secondary, #A0A0A0)' })),
            ),
            h(
              'div',
              { style: { minWidth: 0, flex: 1 } },
              h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 } },
                item.pinned
                  ? tablerIcon('pin', { size: 16, color: 'var(--color-primary, #5F87FF)', style: { marginRight: 2 } })
                  : null,
                h('span', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.subtitle),
              ),
            ),
          ),
          h(
            'div',
            { style: { flex: 1, color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 13 } },
            formatAddedDate(item.addedAt),
          ),
          h(
            'div',
            { style: { flex: 1, color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 13, textAlign: 'right' } },
            formatPlayedDate(item.lastPlayedAt),
          ),
        )
      }),
    ),
    modals,
    contextMenus,
  )
}
