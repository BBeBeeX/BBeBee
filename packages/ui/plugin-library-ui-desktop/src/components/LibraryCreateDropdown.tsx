import { createElement as h } from 'react'
import type { ReactElement, RefObject } from 'react'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface LibraryCreateDropdownProps {
  isCreateMenuOpen: boolean
  setIsCreateMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  createMenuRef?: RefObject<HTMLDivElement | null>
  isCollapsed?: boolean
  collapsedMenuPos?: { top: number; left: number } | null
  onOpenCreatePlaylist: () => void
  onOpenCreateCollection: () => void
}

export function LibraryCreateButton({
  isCreateMenuOpen,
  onClick,
}: {
  isCreateMenuOpen: boolean
  onClick: () => void
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      'data-testid': 'create-dropdown-trigger',
      'aria-label': '创建',
      title: '创建',
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
    h('span', { style: { fontSize: 13, fontWeight: 600 } }, '创建'),
  )
}

export function LibraryCreateMenu({
  isCreateMenuOpen,
  setIsCreateMenuOpen,
  createMenuRef,
  isCollapsed = false,
  collapsedMenuPos,
  onOpenCreatePlaylist,
  onOpenCreateCollection,
}: LibraryCreateDropdownProps): ReactElement | null {
  if (!isCreateMenuOpen) return null

  return h(
    'div',
    {
      ref: createMenuRef,
      style: {
        position: isCollapsed ? 'fixed' : 'absolute',
        top: isCollapsed ? (collapsedMenuPos?.top ?? 54) : 38,
        left: isCollapsed ? (collapsedMenuPos?.left ?? 80) : undefined,
        right: isCollapsed ? undefined : 0,
        width: 240,
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
        h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600, fontSize: 14 } }, '歌单'),
        h('div', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, marginTop: 2 } }, '创建包含歌曲或单集的歌单'),
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
        h('div', { style: { color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600, fontSize: 14 } }, '文件夹'),
        h('div', { style: { color: 'var(--bb-text-secondary, #A0A0AE)', fontSize: 12, marginTop: 2 } }, '管理歌单'),
      ),
    ),
  )
}
