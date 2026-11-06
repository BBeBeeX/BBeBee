import { createElement as h, Fragment, useEffect, useState } from 'react'
import type { ReactElement, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import type { Context } from 'cordis'

export interface LibraryCreateDropdownProps {
  ctx: Context
  isCreateMenuOpen: boolean
  setIsCreateMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  createMenuRef?: RefObject<HTMLDivElement | null>
  isCollapsed?: boolean
  collapsedMenuPos?: { top: number; left: number } | null
  createMenuAnchor?: { top: number; left: number; right: number; bottom: number } | null
  onOpenCreatePlaylist: () => void
  onOpenCreateCollection: () => void
  onOpenImportShare?: () => void
}

export function LibraryCreateButton({
  ctx,
  isCreateMenuOpen,
  onClick,
}: {
  ctx: Context
  isCreateMenuOpen: boolean
  onClick: (e: React.MouseEvent<HTMLElement>) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    'button',
    {
      type: 'button',
      'data-testid': 'create-dropdown-trigger',
      'aria-label': t('library:libraryCreateDropdown.create'),
      title: t('library:libraryCreateDropdown.create'),
      onClick,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 14px',
        borderRadius: 16,
        backgroundColor: 'var(--bb-bg-raised, var(--surface-1, #242424))',
        border: '1px solid var(--border-subtle, transparent)',
        color: 'var(--bb-text-primary, #FFFFFF)',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.backgroundColor = 'var(--surface-hover, #2E2E2E)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.backgroundColor = 'var(--bb-bg-raised, var(--surface-1, #242424))'
      },
    },
    h(
      'span',
      {
        style: {
          transform: isCreateMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          transition: 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)',
          lineHeight: 1,
          marginRight: 2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      tablerIcon('plus', { size: 20 }),
    ),
    h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('library:libraryCreateDropdown.create')),
  )
}

export function LibraryCreateMenu({
  ctx,
  isCreateMenuOpen,
  setIsCreateMenuOpen,
  createMenuRef,
  isCollapsed = false,
  collapsedMenuPos,
  createMenuAnchor,
  onOpenCreatePlaylist,
  onOpenCreateCollection,
  onOpenImportShare,
}: LibraryCreateDropdownProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (!isCreateMenuOpen) return null

  const width = 240
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768

  let top = isCollapsed ? (collapsedMenuPos?.top ?? 54) : 54
  let left = isCollapsed ? (collapsedMenuPos?.left ?? 80) : 80

  if (isCollapsed) {
    top = collapsedMenuPos?.top ?? createMenuAnchor?.top ?? 54
    left = collapsedMenuPos?.left ?? (createMenuAnchor ? createMenuAnchor.right + 12 : 80)
  } else if (createMenuAnchor) {
    top = createMenuAnchor.bottom + 6
    if (createMenuAnchor.right - width >= 8) {
      left = createMenuAnchor.right - width
    } else {
      left = Math.max(8, createMenuAnchor.left)
    }
  }

  left = Math.max(8, Math.min(left, viewportWidth - width - 8))
  if (top + 220 > viewportHeight) {
    top = Math.max(8, viewportHeight - 220 - 8)
  }

  const menu = h(
    Fragment,
    null,
    h('div', {
      'data-testid': 'create-menu-backdrop',
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsCreateMenuOpen(false)
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsCreateMenuOpen(false)
      },
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'transparent',
      },
    }),
    h(
      'div',
      {
        ref: createMenuRef,
        style: {
          position: 'fixed',
          top,
          left,
          width,
          backgroundColor: 'var(--bb-bg-overlay, var(--surface-2, #282828))',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
          borderRadius: 8,
          padding: '6px 0',
          boxShadow: 'var(--shadow-dropdown, 0 8px 24px rgba(0, 0, 0, 0.7))',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
        },
      },
    h(
      'button',
      {
        type: 'button',
        onClick: () => {
          setIsCreateMenuOpen(false)
          onOpenCreatePlaylist()
        },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        },
      },
      h(
        'div',
        {
          style: {
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: 'var(--surface-1, var(--bb-bg-sunken, #3E3E3E))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--bb-text-primary, #FFFFFF)',
            flexShrink: 0,
          },
        },
        tablerIcon('playlist-add', { size: 22 }),
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600, fontSize: 14 } }, t('library:libraryCreateDropdown.playlist')),
        h('div', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, marginTop: 2 } }, t('library:libraryCreateDropdown.createAPlaylistWithSongs')),
      ),
    ),
    h('div', { style: { height: 1, backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))', margin: '4px 0' } }),
    h(
      'button',
      {
        type: 'button',
        onClick: () => {
          setIsCreateMenuOpen(false)
          onOpenCreateCollection()
        },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        },
      },
      h(
        'div',
        {
          style: {
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: 'var(--surface-1, var(--bb-bg-sunken, #3E3E3E))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--bb-text-primary, #FFFFFF)',
            flexShrink: 0,
          },
        },
        tablerIcon('folder', { size: 22 }),
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600, fontSize: 14 } }, t('library:libraryCreateDropdown.folder')),
        h('div', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, marginTop: 2 } }, t('library:libraryCreateDropdown.managePlaylists')),
      ),
    ),
    h('div', { style: { height: 1, backgroundColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))', margin: '4px 0' } }),
    h(
      'button',
      {
        type: 'button',
        'data-testid': 'create-menu-import-share',
        onClick: () => {
          setIsCreateMenuOpen(false)
          onOpenImportShare?.()
        },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'background-color 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.08))'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        },
      },
      h(
        'div',
        {
          style: {
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: 'var(--surface-1, var(--bb-bg-sunken, #3E3E3E))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--bb-text-primary, #FFFFFF)',
            flexShrink: 0,
          },
        },
        tablerIcon('share', { size: 20 }),
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600, fontSize: 14 } }, t('library:libraryCreateDropdown.importShare')),
        h('div', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, marginTop: 2 } }, t('library:libraryCreateDropdown.readAShareCardOr')),
      ),
    ),
  ),
  )

  if (mounted && typeof document !== 'undefined') {
    return createPortal(menu, document.body)
  }
  return menu
}
