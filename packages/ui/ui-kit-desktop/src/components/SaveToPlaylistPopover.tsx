import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ArtworkRef } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'
import { Artwork } from './Artwork.js'
import { tablerIcon } from '../icons/index.js'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const POPOVER_WIDTH = 280
const SUBMENU_WIDTH = 260
// Spotify's add-to-playlist menu stays tall even with two playlists in it —
// a popover that collapses to three rows reads as broken, and the extra room
// is where the search and the folder flyout live comfortably.
const POPOVER_MIN_HEIGHT = 480
const SUBMENU_MIN_HEIGHT = 320

export interface PlaylistSaveOption {
  urn: string
  name: string
  trackCount?: number
  pinned?: boolean
  artwork?: ArtworkRef
  isSmart?: boolean
  containsTrack?: boolean
}

export interface CollectionSaveOption {
  id: string
  name: string
  playlistCount?: number
  playlists: readonly PlaylistSaveOption[]
}

export interface SaveToPlaylistPopoverProps {
  open: boolean
  onClose: () => void
  x: number
  y: number
  title?: string
  liked?: boolean
  likedCount?: number
  onToggleLiked?: () => void | Promise<void>
  playlists: readonly PlaylistSaveOption[]
  collections?: readonly CollectionSaveOption[]
  onCreatePlaylist?: (name: string, folderId?: string) => void | Promise<void>
  onTogglePlaylist?: (playlistUrn: string, currentlyContains: boolean) => void | Promise<void>
  testID?: string
  accessibilityLabel?: string
  /**
   * Mounts the fixed popover through a portal on `document.body`, escaping
   * ancestors whose `transform`/`overflow` would clip it (the fullscreen
   * play page's hover bottom bar).
   */
  portal?: boolean
}

export function SaveToPlaylistPopover(props: SaveToPlaylistPopoverProps): ReactElement | null {
  const [filter, setFilter] = useState('')
  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null)
  const [folderRect, setFolderRect] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null)
  const [creatingInFolderId, setCreatingInFolderId] = useState<string | null | undefined>(undefined)
  const [isCreatingTopLevel, setIsCreatingTopLevel] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(props.open)

  useEffect(() => {
    if (wasOpenRef.current && !props.open) {
      setFilter('')
      setHoveredFolderId(null)
      setFolderRect(null)
      setCreatingInFolderId(undefined)
      setIsCreatingTopLevel(false)
      setNewPlaylistName('')
    }
    wasOpenRef.current = props.open
  }, [props.open])

  useEffect(() => {
    if (!props.open) return
    const handleResize = () => props.onClose()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [props.open, props.onClose])

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight

  const width = POPOVER_WIDTH
  const left = Math.max(8, Math.min(props.x, viewportWidth - width - 8))
  const estimatedHeight = POPOVER_MIN_HEIGHT
  const top =
    props.y + estimatedHeight + 8 <= viewportHeight
      ? Math.max(8, props.y)
      : Math.max(8, viewportHeight - estimatedHeight - 8)
  const maxHeight = Math.max(200, viewportHeight - top - 16)
  const minHeight = Math.min(POPOVER_MIN_HEIGHT, maxHeight)

  // Submenu positioning
  let flyoutLeft = left + width + 2
  let flyoutTop = top
  if (folderRect && (folderRect.right > 0 || folderRect.left > 0)) {
    if (folderRect.right + SUBMENU_WIDTH + 8 <= viewportWidth) {
      flyoutLeft = folderRect.right + 2
    } else if (folderRect.left - SUBMENU_WIDTH - 2 >= 8) {
      flyoutLeft = folderRect.left - SUBMENU_WIDTH - 2
    } else {
      flyoutLeft = Math.max(8, viewportWidth - SUBMENU_WIDTH - 8)
    }

    const subEstHeight = Math.max(SUBMENU_MIN_HEIGHT, 240)
    if (folderRect.top + subEstHeight + 8 <= viewportHeight) {
      flyoutTop = folderRect.top
    } else if (folderRect.bottom - subEstHeight >= 8) {
      flyoutTop = folderRect.bottom - subEstHeight
    } else {
      flyoutTop = Math.max(8, viewportHeight - subEstHeight - 8)
    }
  }

  useIsomorphicLayoutEffect(() => {
    if (!props.open) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    let adjTop = props.y
    if (adjTop + rect.height + 8 > viewportHeight) {
      adjTop = Math.max(8, viewportHeight - rect.height - 8)
    }
    const maxH = Math.max(200, viewportHeight - adjTop - 16)
    el.style.top = `${adjTop}px`
    el.style.maxHeight = `${maxH}px`
    el.style.minHeight = `${Math.min(POPOVER_MIN_HEIGHT, maxH)}px`
  }, [props.open, props.playlists.length, props.collections?.length, filter])

  useIsomorphicLayoutEffect(() => {
    if (!props.open || !hoveredFolderId) return
    const el = submenuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    let adjTop = flyoutTop
    if (adjTop + rect.height + 8 > viewportHeight) {
      adjTop = Math.max(8, viewportHeight - rect.height - 8)
    }
    const subMax = Math.max(160, viewportHeight - adjTop - 16)
    el.style.top = `${adjTop}px`
    el.style.maxHeight = `${subMax}px`
    el.style.minHeight = `${Math.min(SUBMENU_MIN_HEIGHT, subMax)}px`
  }, [props.open, hoveredFolderId, folderRect])

  if (!props.open) return null

  const needle = filter.trim().toLowerCase()
  const matchingPlaylists = needle
    ? props.playlists.filter((p) => p.name.toLowerCase().includes(needle))
    : props.playlists

  const matchingCollections = needle
    ? (props.collections ?? []).filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.playlists.some((p) => p.name.toLowerCase().includes(needle)),
      )
    : props.collections ?? []

  const activeFolder = (props.collections ?? []).find((c) => c.id === hoveredFolderId)

  const handleCreateSubmit = async (folderId?: string) => {
    const trimmed = newPlaylistName.trim()
    if (!trimmed) {
      setIsCreatingTopLevel(false)
      setCreatingInFolderId(undefined)
      return
    }
    setNewPlaylistName('')
    setIsCreatingTopLevel(false)
    setCreatingInFolderId(undefined)
    await props.onCreatePlaylist?.(trimmed, folderId)
  }

  const popover = h(
    'div',
    {
      role: 'presentation',
      onClick: props.onClose,
      onContextMenu: (e: { preventDefault(): void }) => {
        e.preventDefault()
        props.onClose()
      },
      style: { position: 'fixed', inset: 0, zIndex: tokens.z.overlay },
    },
    h(
      'div',
      {
        ref: containerRef,
        role: 'dialog',
        'aria-label': props.accessibilityLabel ?? props.title ?? '添加到歌单',
        'data-testid': props.testID,
        onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Escape') props.onClose()
        },
        style: {
          position: 'fixed',
          left,
          top,
          width,
          maxHeight,
          minHeight,
          background: '#282828',
          color: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 16px 28px rgba(0, 0, 0, 0.65), 0 6px 12px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: tokens.z.overlay + 1,
          fontFamily: tokens.font.family.ui,
          userSelect: 'none',
          boxSizing: 'border-box',
          padding: '8px 0 6px 0',
        },
      },
      // Header: 添加到歌单
      h(
        'div',
        {
          style: {
            fontSize: 14,
            fontWeight: 700,
            padding: '4px 14px 10px 14px',
            color: '#ffffff',
          },
        },
        props.title ?? '添加到歌单',
      ),
      // Search Box / Create Box: 查找歌单 or 新建歌单
      isCreatingTopLevel
        ? h(
            'div',
            {
              style: {
                background: '#3e3e3e',
                borderRadius: 4,
                height: 32,
                margin: '0 12px 8px 12px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                gap: 6,
                border: '1px solid var(--color-primary, #5F87FF)',
              },
            },
            h('input', {
              autoFocus: true,
              type: 'text',
              placeholder: '歌单名称',
              value: newPlaylistName,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPlaylistName(e.target.value),
              onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') void handleCreateSubmit()
                if (e.key === 'Escape') {
                  setIsCreatingTopLevel(false)
                  setNewPlaylistName('')
                }
              },
              style: {
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#ffffff',
                fontSize: 13,
                padding: 0,
              },
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: () => void handleCreateSubmit(),
                style: {
                  background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                  border: 'none',
                  borderRadius: 4,
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 12,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  height: 24,
                },
              },
              '确定',
            ),
            h(
              'button',
              {
                type: 'button',
                'aria-label': '取消',
                onClick: () => {
                  setIsCreatingTopLevel(false)
                  setNewPlaylistName('')
                },
                style: {
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#a7a7a7',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                },
              },
              tablerIcon('x', { size: 16 }),
            ),
          )
        : h(
            'div',
            {
              style: {
                background: '#3e3e3e',
                borderRadius: 4,
                height: 32,
                margin: '0 12px 8px 12px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                gap: 6,
              },
            },
            tablerIcon('search', { size: 18, color: '#a7a7a7' }),
            h('input', {
              ref: inputRef,
              type: 'text',
              placeholder: '查找歌单',
              value: filter,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value),
              style: {
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#ffffff',
                fontSize: 13,
                padding: 0,
              },
            }),
          ),
      // Scrollable content area
      h(
        'div',
        {
          style: {
            flex: 1,
            overflowY: 'auto',
            padding: '0 6px',
            display: 'flex',
            flexDirection: 'column',
          },
        },
        // Action: ＋ 新建歌单
        h(
          RowItem,
          {
            onClick: () => {
              setIsCreatingTopLevel(true)
              setNewPlaylistName(filter.trim())
            },
            onMouseEnter: () => setHoveredFolderId(null),
          },
          h(
            'span',
            {
              style: {
                color: '#ffffff',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            tablerIcon('plus', { size: 22, color: '#ffffff' }),
          ),
          h(
            'div',
            { style: { flex: 1, fontSize: 14, fontWeight: 600, color: '#ffffff' } },
            '新建歌单',
          ),
        ),
        // Section: 保存位置
        h(
          'div',
          {
            style: {
              fontSize: 12,
              fontWeight: 700,
              color: '#a7a7a7',
              padding: '8px 8px 4px 8px',
            },
          },
          '保存位置',
        ),
        // Row: 已点赞的歌曲
        h(
          RowItem,
          {
            onClick: () => props.onToggleLiked?.(),
            onMouseEnter: () => setHoveredFolderId(null),
          },
          // Purple gradient square with white heart
          h(
            'div',
            {
              style: {
                width: 36,
                height: 36,
                borderRadius: 4,
                background: 'linear-gradient(135deg, #450af5 0%, #8e8ee5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                flexShrink: 0,
              },
            },
            tablerIcon('heart-filled', { size: 20, color: '#ffffff' }),
          ),
          // Title + Subtitle
          h(
            'div',
            { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
            h(
              'div',
              {
                style: {
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              '已点赞的歌曲',
            ),
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: '#a7a7a7',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                },
              },
              tablerIcon('pin', { size: 16, color: '#a7a7a7' }),
              `${(props.likedCount ?? 0).toLocaleString()} 首歌曲`,
            ),
          ),
          // Checkmark
          h(CheckmarkCircle, { checked: props.liked ?? false }),
        ),
        // Section: 最近更新
        h(
          'div',
          {
            style: {
              fontSize: 12,
              fontWeight: 700,
              color: '#a7a7a7',
              padding: '10px 8px 4px 8px',
            },
          },
          '最近更新',
        ),
        // Matching regular playlists
        matchingPlaylists.map((playlist) =>
          h(
            RowItem,
            {
              key: playlist.urn,
              onClick: () => props.onTogglePlaylist?.(playlist.urn, playlist.containsTrack ?? false),
              onMouseEnter: () => setHoveredFolderId(null),
            },
            // Playlist artwork or placeholder
            playlist.artwork
              ? h(Artwork, {
                  artwork: playlist.artwork,
                  size: 36,
                  radius: 4,
                  seed: playlist.urn,
                })
              : h(
                  'div',
                  {
                    style: {
                      width: 36,
                      height: 36,
                      borderRadius: 4,
                      background: '#333333',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#b3b3b3',
                      fontSize: 16,
                      flexShrink: 0,
                    },
                  },
                  '♫',
                ),
            // Title + Subtitle
            h(
              'div',
              { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
              h(
                'div',
                {
                  style: {
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                playlist.name,
              ),
              h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: '#a7a7a7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  },
                },
                playlist.pinned ? tablerIcon('pin', { size: 16, color: 'var(--color-primary, #5F87FF)' }) : null,
                `${playlist.trackCount ?? 0} 首歌曲`,
              ),
            ),
            h(CheckmarkCircle, { checked: playlist.containsTrack ?? false }),
          ),
        ),
        // Matching collections (Folders)
        matchingCollections.map((collection) => {
          const isHovered = hoveredFolderId === collection.id
          return h(
            RowItem,
            {
              key: collection.id,
              active: isHovered,
              onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setFolderRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
                setHoveredFolderId(collection.id)
              },
              onClick: (e: React.MouseEvent<HTMLDivElement>) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setFolderRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
                setHoveredFolderId((prev) => (prev === collection.id ? null : collection.id))
              },
            },
            // Folder icon
            h(
              'div',
              {
                style: {
                  width: 36,
                  height: 36,
                  borderRadius: 4,
                  background: '#333333',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#b3b3b3',
                  flexShrink: 0,
                },
              },
              tablerIcon('folder', { size: 22, color: '#b3b3b3' }),
            ),
            // Title + Subtitle
            h(
              'div',
              { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
              h(
                'div',
                {
                  style: {
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                collection.name,
              ),
              h(
                'div',
                { style: { fontSize: 12, color: '#a7a7a7' } },
                `${collection.playlistCount ?? collection.playlists.length} 个歌单`,
              ),
            ),
            tablerIcon('chevron-right', { size: 18, color: '#a7a7a7' }),
          )
        }),
      ),
      // Footer: 取消
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 12px 2px 12px',
          },
        },
        h(
          'button',
          {
            type: 'button',
            onClick: props.onClose,
            style: {
              background: 'none',
              border: 'none',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
            },
          },
          '取消',
        ),
      ),
    ),
    // Flyout Submenu for the hovered Folder
    activeFolder
      ? h(
          'div',
          {
            ref: submenuRef,
            role: 'dialog',
            'aria-label': activeFolder.name,
            onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
            onMouseLeave: () => setHoveredFolderId(null),
            style: {
              position: 'fixed',
              left: flyoutLeft,
              top: flyoutTop,
              width: SUBMENU_WIDTH,
              background: '#282828',
              color: '#ffffff',
              borderRadius: 8,
              boxShadow: '0 16px 28px rgba(0, 0, 0, 0.65), 0 6px 12px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: tokens.z.overlay + 2,
              fontFamily: tokens.font.family.ui,
              userSelect: 'none',
              padding: '6px 0',
              overflowY: 'auto',
            },
          },
          // Submenu Header: folder name
          h(
            'div',
            {
              style: {
                fontSize: 13,
                fontWeight: 600,
                color: '#ffffff',
                padding: '4px 14px 8px 14px',
              },
            },
            activeFolder.name,
          ),
          // Submenu Action: ＋ 新建歌单
          creatingInFolderId === activeFolder.id
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 8px',
                    gap: 6,
                  },
                },
                h('input', {
                  type: 'text',
                  autoFocus: true,
                  placeholder: '歌单名称',
                  value: newPlaylistName,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPlaylistName(e.target.value),
                  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') void handleCreateSubmit(activeFolder.id)
                    if (e.key === 'Escape') setCreatingInFolderId(undefined)
                  },
                  style: {
                    flex: 1,
                    background: 'var(--surface-2, #3e3e3e)',
                    border: '1px solid var(--input-focus-border, var(--color-primary, #5F87FF))',
                    borderRadius: 4,
                    color: 'var(--text-primary, #ffffff)',
                    fontSize: 13,
                    padding: '4px 8px',
                    outline: 'none',
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => void handleCreateSubmit(activeFolder.id),
                    style: {
                      background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: 12,
                      padding: '4px 8px',
                      cursor: 'pointer',
                    },
                  },
                  '确定',
                ),
              )
            : h(
                RowItem,
                {
                  onClick: () => setCreatingInFolderId(activeFolder.id),
                },
                h(
                  'span',
                  {
                    style: {
                      color: '#ffffff',
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                  },
                  tablerIcon('plus', { size: 20, color: '#ffffff' }),
                ),
                h(
                  'div',
                  { style: { flex: 1, fontSize: 13, fontWeight: 600, color: '#ffffff' } },
                  '新建歌单',
                ),
              ),
          h('div', {
            style: { height: 1, background: '#383838', margin: '4px 8px 6px 8px' },
          }),
          // Submenu Section: 最近更新
          h(
            'div',
            {
              style: {
                fontSize: 12,
                fontWeight: 700,
                color: '#a7a7a7',
                padding: '4px 10px',
              },
            },
            '最近更新',
          ),
          activeFolder.playlists.map((playlist) =>
            h(
              RowItem,
              {
                key: playlist.urn,
                onClick: () => props.onTogglePlaylist?.(playlist.urn, playlist.containsTrack ?? false),
              },
              playlist.artwork
                ? h(Artwork, {
                    artwork: playlist.artwork,
                    size: 32,
                    radius: 4,
                    seed: playlist.urn,
                  })
                : h(
                    'div',
                    {
                      style: {
                        width: 32,
                        height: 32,
                        borderRadius: 4,
                        background: '#333333',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#b3b3b3',
                        fontSize: 15,
                        flexShrink: 0,
                      },
                    },
                    '♫',
                  ),
              h(
                'div',
                { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
                h(
                  'div',
                  {
                    style: {
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#ffffff',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  playlist.name,
                ),
                h(
                  'div',
                  { style: { fontSize: 11, color: '#a7a7a7' } },
                  `${playlist.trackCount ?? 0} 首歌曲`,
                ),
              ),
              h(CheckmarkCircle, { checked: playlist.containsTrack ?? false }),
            ),
          ),
        )
      : null,
  )

  return props.portal ? createPortal(popover, document.body) : popover
}

function RowItem({
  children,
  onClick,
  onMouseEnter,
  active,
}: {
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void
  active?: boolean
}): ReactElement {
  const [hovered, setHovered] = useState(false)
  return h(
    'div',
    {
      role: 'button',
      tabIndex: 0,
      onClick,
      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
        setHovered(true)
        onMouseEnter?.(e)
      },
      onMouseLeave: () => setHovered(false),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 8px',
        margin: '1px 4px',
        borderRadius: 4,
        cursor: 'pointer',
        background: active || hovered ? '#383838' : 'transparent',
        transition: 'background-color 0.1s ease',
      },
    },
    children,
  )
}

function CheckmarkCircle({ checked }: { checked: boolean }): ReactElement {
  if (checked) {
    return h(
      'div',
      {
        style: {
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--color-primary, #5F87FF)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          flexShrink: 0,
        },
      },
      tablerIcon('check', { size: 16, stroke: 2, color: '#ffffff' }),
    )
  }
  return h('div', {
    style: {
      width: 16,
      height: 16,
      borderRadius: '50%',
      border: '1.5px solid #727272',
      flexShrink: 0,
    },
  })
}
