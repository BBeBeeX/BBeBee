import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { LIBRARY_VIEWS } from '@BBeBee/plugin-library/views'
import { CachedArtwork } from '../CachedArtwork.js'
import type { UnifiedItem } from '../UnifiedLibraryRow.js'

export interface CollapsedLibraryViewProps {
  ctx: Context
  activeFolderId: string | null
  setActiveFolderId: (id: string | null) => void
  handleModeChange: (mode: 'sidebar') => void
  isCreateMenuOpen: boolean
  setIsCreateMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  setCollapsedMenuPos: (pos: { top: number; left: number }) => void
  renderCreateMenu: (isCollapsed: boolean) => ReactElement | null
  items: readonly UnifiedItem[]
  /** The two quick entries (喜欢 / 本地和下载) stay visible even collapsed. */
  favoriteCount: number
  localCount: number
  activeViewId?: string
  modals: ReactElement
  contextMenus: ReactElement
}

export function CollapsedLibraryView({
  ctx,
  activeFolderId,
  setActiveFolderId,
  handleModeChange,
  isCreateMenuOpen,
  setIsCreateMenuOpen,
  setCollapsedMenuPos,
  renderCreateMenu,
  items,
  favoriteCount,
  localCount,
  activeViewId,
  modals,
  contextMenus,
}: CollapsedLibraryViewProps): ReactElement {
  // Same light-dark pairing as the sidebar quick rows, so the collapsed rail
  // reads as the same menu squeezed down to icons.
  const quickTile = (icon: 'heart' | 'download', viewId: string, label: string, count: number) => {
    const selected = activeViewId === viewId
    return h(
      'button',
      {
        key: viewId,
        type: 'button',
        'aria-label': `${label}·${count}`,
        title: `${label}·${count}`,
        'aria-current': selected ? 'page' : undefined,
        onClick: () => ctx.ui.navigate(viewId),
        style: {
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          border: 'none',
          cursor: 'pointer',
          color: 'light-dark(#17171C, #F2F3F7)',
          background: selected ? 'light-dark(#E9E9EC, rgba(255, 255, 255, 0.09))' : 'transparent',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (!selected) {
            e.currentTarget.style.backgroundColor = 'light-dark(#F2F2F4, rgba(255, 255, 255, 0.05))'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = selected
            ? 'light-dark(#E9E9EC, rgba(255, 255, 255, 0.09))'
            : 'transparent'
        },
      },
      tablerIcon(icon, { size: 24 }),
    )
  }

  return h(
    'section',
    {
      'aria-label': 'Library Collapsed',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        padding: '12px 0',
        boxSizing: 'border-box',
        overflowY: 'auto',
        overflowX: 'hidden',
        userSelect: 'none',
      },
    },
    h(
      'button',
      {
        type: 'button',
        'aria-label': '展开音乐库',
        title: '展开音乐库',
        onClick: () => handleModeChange('sidebar'),
        style: {
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--bb-text-secondary, #A0A0AE)',
          cursor: 'pointer',
          borderRadius: 8,
          transition: 'all 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.color = 'var(--bb-text-secondary, #A0A0AE)'
          e.currentTarget.style.backgroundColor = 'transparent'
        },
      },
      tablerIcon('books', { size: 28 }),
    ),
    activeFolderId !== null
      ? h(
          'button',
          {
            type: 'button',
            'aria-label': '返回音乐库',
            title: '返回音乐库',
            onClick: () => setActiveFolderId(null),
            style: {
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: 'var(--surface-1, #242424)',
              border: 'none',
              color: 'var(--bb-text-primary, #FFFFFF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              margin: '4px 0 0',
              transition: 'background-color 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'var(--surface-hover, #2E2E2E)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.backgroundColor = 'var(--surface-1, #242424)'
            },
          },
          tablerIcon('chevron-left', { size: 22 }),
        )
      : null,
    h(
      'div',
      { style: { position: 'relative', margin: '10px 0 16px' } },
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'create-dropdown-trigger',
          'aria-label': '创建',
          title: '创建',
          onClick: (e: { currentTarget: HTMLElement }) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setCollapsedMenuPos({ top: rect.top, left: rect.right + 12 })
            setIsCreateMenuOpen((prev) => !prev)
          },
          style: {
            width: 36,
            height: 36,
            borderRadius: '50%',
            backgroundColor: 'var(--surface-1, #242424)',
            border: 'none',
            color: 'var(--bb-text-primary, #FFFFFF)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'var(--surface-hover, #2E2E2E)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.backgroundColor = 'var(--surface-1, #242424)'
          },
        },
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: isCreateMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
              lineHeight: 1,
            },
          },
          tablerIcon('plus', { size: 22 }),
        ),
      ),
      renderCreateMenu(true),
    ),
    // 喜欢 / 本地和下载: the two quick entries keep their place on the rail.
    h(
      'div',
      {
        'aria-label': '音乐库快捷入口',
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 12 },
      },
      quickTile('heart', LIBRARY_VIEWS.favorites, '喜欢', favoriteCount),
      quickTile('download', LIBRARY_VIEWS.local, '本地和下载', localCount),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          width: '100%',
        },
      },
      items.map((item) => {
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
            title: `${item.title} • ${item.subtitle}`,
            style: {
              position: 'relative',
              width: 48,
              height: 48,
              borderRadius: isArt ? '50%' : 4,
              overflow: 'hidden',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isFav ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
              background: isFav ? 'linear-gradient(135deg, #450af5, #8e8ee5)' : undefined,
              color: isFav ? '#FFFFFF' : undefined,
              transition: 'transform 0.15s ease',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.transform = 'scale(1.05)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.transform = 'scale(1)'
            },
          },
          isFav
            ? tablerIcon('heart-filled', { size: 26, color: 'currentColor' })
            : item.kind === 'collection'
              ? h(
                  'div',
                  {
                    style: {
                      width: 48,
                      height: 48,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'var(--surface-1, rgba(255, 255, 255, 0.08))',
                      borderRadius: 4,
                      color: 'var(--bb-text-secondary, #CCCCCC)',
                    },
                  },
                  tablerIcon('folder', { size: 28 }),
                )
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
        )
      }),
    ),
    modals,
    contextMenus,
  )
}
