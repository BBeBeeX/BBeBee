import { createElement as h, Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { tokens } from '@BBeBee/ui-tokens'
import type { ContextMenuProps, MenuItemSpec } from '@BBeBee/ui-core'
import { c, common, useHover } from '../theme.js'
import { tablerIcon } from '../icons/index.js'
import { Button } from './Button.js'
import { Text } from './Text.js'
import { TextField } from './TextField.js'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const MENU_WIDTH = 248

export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const [submenuState, setSubmenuState] = useState<
    { id: string; rect?: { top: number; right: number; bottom: number; left: number } } | undefined
  >(undefined)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const p = c()

  useEffect(() => {
    if (props.open) return
    setSubmenuState(undefined)
    setFilter('')
    setCreating(false)
    setDraft('')
  }, [props.open])

  useEffect(() => {
    if (!props.open) return
    const handleResize = () => props.onClose()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [props.open, props.onClose])

  useEffect(() => {
    if (creating) {
      const input = submenuRef.current?.querySelector('input[data-testid="context-menu-create-name"]') as HTMLInputElement | null
      input?.focus()
    }
  }, [creating])

  const submenu = props.items.find((item) => item.id === submenuState?.id)?.submenu
  const needle = filter.trim().toLowerCase()
  const visible = submenu
    ? submenu.items.filter((item) => item.label.toLowerCase().includes(needle))
    : []

  const close = () => props.onClose()
  const activate = (item: MenuItemSpec) => {
    if (item.disabled) return
    if (item.submenu) {
      setSubmenuState((prev) => (prev?.id === item.id ? prev : { id: item.id }))
      return
    }
    void item.onSelect?.()
    close()
  }

  const width = MENU_WIDTH
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const left = Math.max(8, Math.min(props.x, viewportWidth - width - 8))

  // Estimate primary menu height to keep it fully within viewport
  const primaryEstimatedHeight = (props.title ? 32 : 0) + props.items.length * 36 + 16
  const top =
    props.y + primaryEstimatedHeight + 8 <= viewportHeight
      ? Math.max(8, props.y)
      : Math.max(8, viewportHeight - primaryEstimatedHeight - 8)
  const primaryMaxHeight = Math.max(120, viewportHeight - top - 8)

  // Estimate submenu height to flip upwards if it overflows viewport bottom
  const submenuEstimatedHeight = submenu
    ? (submenu.title ? 32 : 0) +
      (submenu.searchPlaceholder ? 42 : 0) +
      (submenu.create ? 42 : 0) +
      Math.max(1, visible.length) * 36 +
      16
    : 160

  let flyoutLeft: number
  let flyoutTop: number

  if (submenuState?.rect && (submenuState.rect.right > 0 || submenuState.rect.left > 0)) {
    const r = submenuState.rect
    // Horizontal positioning: prefer right, flip to left, fallback clamp
    if (r.right + width + 8 <= viewportWidth) {
      flyoutLeft = r.right + 2
    } else if (r.left - width - 2 >= 8) {
      flyoutLeft = r.left - width - 2
    } else {
      flyoutLeft = Math.max(8, viewportWidth - width - 8)
    }

    // Vertical positioning: try downward from row top, or flip upward to row bottom, or pin within viewport
    if (r.top + submenuEstimatedHeight + 8 <= viewportHeight) {
      flyoutTop = r.top
    } else if (r.bottom - submenuEstimatedHeight >= 8) {
      flyoutTop = r.bottom - submenuEstimatedHeight
    } else {
      flyoutTop = Math.max(8, viewportHeight - submenuEstimatedHeight - 8)
    }
  } else {
    // Fallback when trigger rect is unavailable
    if (left + width + width + 8 <= viewportWidth) {
      flyoutLeft = left + width + 2
    } else if (left - width - 2 >= 8) {
      flyoutLeft = left - width - 2
    } else {
      flyoutLeft = Math.max(8, viewportWidth - width - 8)
    }

    if (top + submenuEstimatedHeight + 8 <= viewportHeight) {
      flyoutTop = top
    } else {
      flyoutTop = Math.max(8, viewportHeight - submenuEstimatedHeight - 8)
    }
  }

  flyoutTop = Math.max(8, flyoutTop)
  const flyoutMaxHeight = Math.max(120, viewportHeight - flyoutTop - 8)

  useIsomorphicLayoutEffect(() => {
    if (!props.open) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return
    const vpHeight = window.innerHeight
    let adjTop = props.y
    if (adjTop + rect.height + 8 > vpHeight) {
      adjTop = Math.max(8, vpHeight - rect.height - 8)
    }
    adjTop = Math.max(8, adjTop)
    const maxH = Math.max(120, vpHeight - adjTop - 8)
    el.style.top = `${adjTop}px`
    el.style.maxHeight = `${maxH}px`
  }, [props.open, props.items.length, props.y])

  useIsomorphicLayoutEffect(() => {
    if (!props.open) return
    const el = submenuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return

    const vpHeight = window.innerHeight
    const vpWidth = window.innerWidth
    const realHeight = rect.height
    const realWidth = rect.width || width

    let adjTop: number
    let adjLeft: number

    if (submenuState?.rect && (submenuState.rect.right > 0 || submenuState.rect.left > 0)) {
      const r = submenuState.rect
      if (r.right + realWidth + 8 <= vpWidth) {
        adjLeft = r.right + 2
      } else if (r.left - realWidth - 2 >= 8) {
        adjLeft = r.left - realWidth - 2
      } else {
        adjLeft = Math.max(8, vpWidth - realWidth - 8)
      }

      if (r.top + realHeight + 8 <= vpHeight) {
        adjTop = r.top
      } else if (r.bottom - realHeight >= 8) {
        adjTop = r.bottom - realHeight
      } else {
        adjTop = Math.max(8, vpHeight - realHeight - 8)
      }
    } else {
      if (left + realWidth + realWidth + 8 <= vpWidth) {
        adjLeft = left + realWidth + 2
      } else if (left - realWidth - 2 >= 8) {
        adjLeft = left - realWidth - 2
      } else {
        adjLeft = Math.max(8, vpWidth - realWidth - 8)
      }

      if (top + realHeight + 8 <= vpHeight) {
        adjTop = top
      } else {
        adjTop = Math.max(8, vpHeight - realHeight - 8)
      }
    }

    adjTop = Math.max(8, adjTop)
    const maxH = Math.max(120, vpHeight - adjTop - 8)

    el.style.top = `${adjTop}px`
    el.style.left = `${adjLeft}px`
    el.style.maxHeight = `${maxH}px`
  }, [props.open, submenuState?.id, submenuState?.rect, filter, visible.length, creating])

  if (!props.open) return null

  const menu = h(
    'div',
    {
      role: 'presentation',
      onClick: close,
      onContextMenu: (event: { preventDefault(): void }) => {
        event.preventDefault()
        close()
      },
      style: { position: 'fixed', inset: 0, zIndex: tokens.z.overlay },
    },
    h(
      'div',
      {
        ref: menuRef,
        role: 'menu',
        ...common(props),
        'aria-label': props.accessibilityLabel ?? props.title ?? 'Actions',
        onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Escape') close()
        },
        style: {
          position: 'fixed',
          left,
          top,
          width,
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: primaryMaxHeight,
          overflowY: 'auto',
          padding: 4,
          borderRadius: 8,
          border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
          background: 'var(--surface-2, #111522)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), var(--glow-xs)',
        },
      },
      props.title
        ? h(
            'div',
            { style: { padding: '6px 12px 4px 12px' } },
            h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.title }),
          )
        : null,
      props.items.map((item) =>
        h(
          Fragment,
          { key: item.id },
          h(MenuRow, {
            item,
            active: submenuState?.id === item.id,
            onActivate: activate,
            onHover: (rect) => {
              if (item.submenu) {
                if (submenuState?.id !== item.id) {
                  setSubmenuState({ id: item.id, rect })
                  setFilter('')
                  setCreating(false)
                  setDraft('')
                }
              } else {
                setSubmenuState(undefined)
                setFilter('')
                setCreating(false)
                setDraft('')
              }
            },
          }),
          item.divider
            ? h('div', {
                key: `${item.id}-divider`,
                style: {
                  height: 1,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  margin: '4px 6px',
                },
              })
            : null,
        ),
      ),
    ),
    submenu
      ? h(
          'div',
          {
            ref: submenuRef,
            role: 'menu',
            'aria-label': submenu.title ?? 'Submenu',
            onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
            style: {
              position: 'fixed',
              left: flyoutLeft,
              top: flyoutTop,
              width,
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: flyoutMaxHeight,
              overflowY: 'auto',
              padding: 4,
              borderRadius: 8,
              border: '1px solid var(--border-subtle, rgba(148,163,184,0.08))',
              background: 'var(--surface-2, #111522)',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), var(--glow-xs)',
              zIndex: tokens.z.overlay + 1,
            },
          },
          submenu.title
            ? h(
                'div',
                { style: { padding: '6px 12px 4px 12px' } },
                h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: submenu.title }),
              )
            : null,
          submenu.searchPlaceholder && creating && submenu.create
            ? h(
                'div',
                {
                  key: '__create-field-top',
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space[2],
                    padding: `0 ${tokens.space[2]}px ${tokens.space[2]}px`,
                  },
                  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      const name = draft.trim()
                      if (!name) return
                      void submenu.create?.onSelect(name)
                      close()
                    } else if (e.key === 'Escape') {
                      e.stopPropagation()
                      setCreating(false)
                      setDraft('')
                    }
                  },
                },
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  h(TextField, {
                    value: draft,
                    onChange: setDraft,
                    placeholder: submenu.create.placeholder,
                    testID: 'context-menu-create-name',
                  }),
                ),
                h(Button, {
                  onPress: () => {
                    const name = draft.trim()
                    if (!name) return
                    void submenu.create?.onSelect(name)
                    close()
                  },
                  disabled: draft.trim().length === 0,
                  testID: 'context-menu-create-confirm',
                  children: submenu.create.buttonLabel ?? '确定',
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-label': '取消',
                    onClick: () => {
                      setCreating(false)
                      setDraft('')
                    },
                    style: {
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted, #626A80)',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                    },
                  },
                  tablerIcon('x', { size: 16 }),
                ),
              )
            : submenu.searchPlaceholder
              ? h(
                  'div',
                  { style: { padding: `0 ${tokens.space[2]}px ${tokens.space[2]}px` } },
                  h(TextField, {
                    value: filter,
                    onChange: setFilter,
                    placeholder: submenu.searchPlaceholder,
                    testID: 'context-menu-filter',
                  }),
                )
              : null,
          (() => {
            const isCreateBottom = submenu.create?.placement === 'bottom'
            const hasTopSearch = Boolean(submenu.searchPlaceholder)
            const createRow = submenu.create
              ? hasTopSearch
                ? !creating
                  ? h(MenuRow, {
                      key: '__create',
                      item: { id: '__create', label: submenu.create.label, icon: 'plus' },
                      onActivate: () => {
                        setCreating(true)
                        setDraft(filter.trim())
                      },
                    })
                  : null
                : creating || submenu.create.alwaysVisible
                  ? h(
                      'div',
                      {
                        key: '__create-field',
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: tokens.space[2],
                          padding: `${tokens.space[2]}px ${tokens.space[2]}px`,
                          borderTop: isCreateBottom ? `1px solid ${p.border.subtle}` : undefined,
                          borderBottom: !isCreateBottom ? `1px solid ${p.border.subtle}` : undefined,
                          marginTop: isCreateBottom ? tokens.space[1] : 0,
                          marginBottom: !isCreateBottom ? tokens.space[1] : 0,
                        },
                        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            const name = draft.trim()
                            if (!name) return
                            void submenu.create?.onSelect(name)
                            close()
                          }
                        },
                      },
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 0 } },
                        h(TextField, {
                          value: draft,
                          onChange: setDraft,
                          placeholder: submenu.create.placeholder,
                          testID: 'context-menu-create-name',
                        }),
                      ),
                      h(Button, {
                        onPress: () => {
                          const name = draft.trim()
                          if (!name) return
                          void submenu.create?.onSelect(name)
                          close()
                        },
                        disabled: draft.trim().length === 0,
                        testID: 'context-menu-create-confirm',
                        children: submenu.create.buttonLabel ?? '确定',
                      }),
                    )
                  : h(MenuRow, {
                      key: '__create',
                      item: { id: '__create', label: submenu.create.label, icon: 'plus' },
                      onActivate: () => setCreating(true),
                    })
              : null

            const itemRows =
              visible.length === 0
                ? [
                    h(
                      'div',
                      { key: '__empty', style: { padding: tokens.space[3] } },
                      h(Text, { variant: 'sm', tone: 'muted', children: submenu.emptyLabel ?? 'No matches' }),
                    ),
                  ]
                : visible.map((item) =>
                    h(
                      Fragment,
                      { key: item.id },
                      h(MenuRow, { key: item.id, item, onActivate: activate }),
                      item.divider
                        ? h('div', {
                            key: `${item.id}-divider`,
                            style: {
                              height: 1,
                              backgroundColor: 'rgba(255, 255, 255, 0.08)',
                              margin: '4px 6px',
                            },
                          })
                        : null,
                    ),
                  )

            return h(
              Fragment,
              null,
              !isCreateBottom ? createRow : null,
              itemRows,
              isCreateBottom ? createRow : null,
            )
          })(),
        )
      : null,
  )

  // A portal escapes ancestors whose `transform`/`overflow` would clip or
  // re-anchor fixed positioning (the fullscreen play page's hover bottom bar).
  return props.portal ? createPortal(menu, document.body) : menu
}

function renderMenuIcon(icon: React.ReactNode | string | undefined): React.ReactNode {
  if (!icon) {
    return h('span', { 'aria-hidden': true, style: { width: 18, height: 18, display: 'inline-block' } })
  }

  const rendered = tablerIcon(icon, { size: 20 })

  return h(
    'span',
    {
      'aria-hidden': true,
      style: {
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'inherit',
      },
    },
    rendered,
  )
}

function MenuRow({
  item,
  active,
  onActivate,
  onHover,
}: {
  item: MenuItemSpec
  active?: boolean
  onActivate: (item: MenuItemSpec) => void
  onHover?: (rect: { top: number; right: number; bottom: number; left: number }) => void
}): ReactElement {
  const [hovered, hoverProps] = useHover()
  const danger = item.tone === 'danger'
  // A heading is a section label, not an action: flush left, no icon slot,
  // no hover — the row exists to name the group beneath it.
  const heading = item.heading === true
  return h(
    'button',
    {
      type: 'button',
      role: heading ? 'presentation' : 'menuitem',
      disabled: item.disabled,
      'aria-haspopup': item.submenu ? 'menu' : undefined,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onHover?.({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
        onActivate(item)
      },
      onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => {
        hoverProps.onMouseEnter?.()
        const rect = event.currentTarget.getBoundingClientRect()
        onHover?.({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
      },
      onMouseLeave: () => {
        hoverProps.onMouseLeave?.()
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: heading ? 24 : 36,
        padding: heading ? '2px 12px' : '0 12px',
        margin: '1px 0',
        border: 'none',
        borderRadius: 6,
        textAlign: 'left',
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled && !heading ? 0.45 : 1,
        background: (hovered || active) && !item.disabled ? 'var(--surface-hover, #191E30)' : 'transparent',
        color: danger
          ? 'var(--error, #EF4444)'
          : heading
            ? 'var(--text-muted, #626A80)'
            : (hovered || active)
              ? 'var(--text-primary, #F5F7FF)'
              : 'var(--text-secondary, #C5CAD8)',
        font: 'inherit',
        fontSize: heading ? '12px' : '13.5px',
        fontWeight: heading ? 600 : undefined,
        letterSpacing: heading ? 0.5 : undefined,
        outline: 'none',
        transition: 'background-color 100ms ease, color 100ms ease',
      },
    },
    heading ? null : renderMenuIcon(item.icon),
    h(
      'span',
      {
        style: {
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      },
      item.label,
    ),
    item.submenu
      ? h(
          'span',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 10,
              height: 10,
              marginLeft: 'auto',
              color: 'rgba(255, 255, 255, 0.7)',
            },
          },
          tablerIcon('chevron-right', { size: 16 }),
        )
      : null,
  )
}
