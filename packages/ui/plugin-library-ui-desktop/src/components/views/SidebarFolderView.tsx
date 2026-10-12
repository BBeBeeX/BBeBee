import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { EmptyState, List, TextField, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
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
  const { t } = useI18n(ctx)
  return h(
    'section',
    {
      'aria-label': activeCollection?.name ?? t('library:libraryCreateDropdown.folder'),
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
          title: t('library:collapsedLibrary.backToMusicLibrary'),
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
          activeCollection?.name ?? t('library:libraryCreateDropdown.folder'),
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
                'aria-label': t('library:expandedLibrary.moreOptions'),
                title: t('library:expandedLibrary.moreOptions'),
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
            'aria-label': t('library:collapsedLibrary.expandMusicLibrary'),
            title: t('library:collapsedLibrary.expandMusicLibrary'),
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
        t('library:library.byYou'),
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
            'aria-label': t('library:libraryToolbar.search'),
            title: t('library:libraryToolbar.search'),
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
              placeholder: t('library:sidebarFolder.searchInFolder'),
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
        h('span', null, t(LIBRARY_SORT_LABELS[sortMode])),
        h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, tablerIcon('list', { size: 20 })),
      ),
    ),
    h(
      'div',
      { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } },
      filteredFolderItems.length === 0
        ? h(EmptyState, {
            icon: 'folder',
            title: t('library:sidebarFolder.thisFolderIsEmpty'),
            description: t('library:sidebarFolder.clickCreateToAddA'),
          })
        : h(List<UnifiedItem>, {
            testID: 'folder-items-list',
            items: filteredFolderItems,
            estimatedItemSize: 64,
            keyExtractor: (item) => item.id,
            empty: h(EmptyState, { title: t('library:sidebarFolder.noItemsYet') }),
            renderItem: (item) => h(UnifiedLibraryRow, { key: item.id, ctx, item }),
          }),
    ),
    modals,
    contextMenus,
  )
}
