import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { EmptyState, List, TextField, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { UnifiedLibraryRow, type UnifiedItem } from '../UnifiedLibraryRow.js'
import { LIBRARY_SORT_LABELS, type LibrarySortMode } from '../LibraryToolbar.js'

export interface SidebarFolderViewProps {
  ctx: Context
  activeCollection?: Collection
  setActiveFolderId: (id: string | null) => void
  handleModeChange: (mode: 'expanded') => void
  renderCreateButton: () => ReactElement
  renderCreateMenu: (isCollapsed: boolean) => ReactElement | null
  openCollectionMenu: (collection: Collection, anchor: MenuAnchor, isPinned: boolean) => void
  isItemPinned: (item: { id?: string; urn?: string }) => boolean

  searchOpen: boolean
  setSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  sortMode: LibrarySortMode
  setSortMenuAnchor: (anchor: MenuAnchor | undefined) => void

  filteredFolderItems: readonly UnifiedItem[]
  modals: ReactElement
  contextMenus: ReactElement
}

export function SidebarFolderView({
  ctx,
  activeCollection,
  setActiveFolderId,
  handleModeChange,
  renderCreateButton,
  renderCreateMenu,
  openCollectionMenu,
  isItemPinned,

  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  sortMode,
  setSortMenuAnchor,

  filteredFolderItems,
  modals,
  contextMenus,
}: SidebarFolderViewProps): ReactElement {
  return h(
    'section',
    {
      'aria-label': activeCollection?.name ?? 'Folder',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        padding: '12px 16px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'header',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 6,
            transition: 'background-color 0.15s ease',
            maxWidth: 150,
            overflow: 'hidden',
          },
          onClick: () => setActiveFolderId(null),
          title: '返回音乐库',
        },
        tablerIcon('chevron-left', { size: 24, color: 'currentColor' }),
        h(
          'span',
          {
            style: {
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--bb-text-primary, #FFFFFF)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          activeCollection?.name ?? '文件夹',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, position: 'relative' } },
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
            'aria-label': '展开音乐库',
            title: '展开音乐库',
            onClick: () => handleModeChange('expanded'),
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
          tablerIcon('maximize', { size: 20 }),
        ),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } },
      h(
        'span',
        {
          style: {
            padding: '5px 12px',
            borderRadius: 16,
            backgroundColor: 'var(--surface-raised, var(--bb-bg-raised, #282828))',
            color: 'var(--text-primary, var(--bb-text-primary, #FFFFFF))',
            fontSize: 13,
            fontWeight: 600,
          },
        },
        '创建者: 你',
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h(
          'button',
          {
            type: 'button',
            'aria-label': '搜索',
            title: '搜索',
            onClick: () => setSearchOpen((prev) => !prev),
            style: {
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              color: searchOpen ? 'var(--text-primary, #FFFFFF)' : 'var(--bb-text-secondary, #A0A0AE)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          },
          tablerIcon('search', { size: 20 }),
        ),
        searchOpen
          ? h(TextField, {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: '在文件夹中搜索...',
              testID: 'folder-search-input',
            })
          : null,
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
        h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, tablerIcon('list', { size: 20 })),
      ),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
      filteredFolderItems.length === 0
        ? h(EmptyState, {
            icon: 'folder',
            title: '文件夹为空',
            description: '点击创建添加歌单，或从音乐库中添加内容。',
          })
        : h(List<UnifiedItem>, {
            testID: 'folder-items-list',
            items: filteredFolderItems,
            estimatedItemSize: 64,
            keyExtractor: (item) => item.id,
            empty: h(EmptyState, { title: 'No items yet' }),
            renderItem: (item) => h(UnifiedLibraryRow, { key: item.id, ctx, item }),
          }),
    ),
    modals,
    contextMenus,
  )
}
