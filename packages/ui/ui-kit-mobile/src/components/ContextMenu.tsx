import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { tokens } from '@BBeBee/ui-tokens'
import type { ContextMenuProps, MenuItemSpec } from '@BBeBee/ui-core'
import { c, common, nativePrimitives } from '../primitives.js'
import { Text } from './Text.js'
import { TextField } from './TextField.js'
import { Button } from './Button.js'

/**
 * Menu icons arrive as Tabler icon *names* from `@BBeBee/ui-menus` (the same
 * strings the desktop kit resolves through its SVG registry). A phone has no
 * Tabler set, so each name maps to a glyph; a name without a mapping is
 * hidden rather than shown as a bare English word, and anything that is
 * already a glyph (unicode the caller passed directly) passes through.
 */
const MENU_ICON_GLYPHS: Record<string, string> = {
  plus: '＋',
  minus: '－',
  'playlist-add': '♫＋',
  'create-playlist': '♫＋',
  'create-folder': '📁＋',
  folder: '📁',
  pin: '📌',
  pencil: '✎',
  trash: '🗑',
  delete: '🗑',
  play: '▶',
  download: '⬇',
  heart: '♥',
  'heart-filled': '♥',
  disc: '◎',
  clock: '⏱',
  x: '✕',
  music: '♪',
  search: '🔍',
}

function menuIconGlyph(icon: ReactNode): ReactNode {
  // Non-string icons are already rendered elements — pass them through.
  if (typeof icon !== 'string') return icon
  const mapped = MENU_ICON_GLYPHS[icon]
  if (mapped) return mapped
  return /^[a-z0-9-]+$/i.test(icon) ? null : icon
}

/** One menu row. `role` is Android's, so TalkBack announces it as a menu item. */
function MenuRow({
  item,
  onActivate,
}: {
  item: MenuItemSpec
  onActivate: (item: MenuItemSpec) => void
}): ReactElement {
  const native = nativePrimitives()
  const iconGlyph = item.icon ? menuIconGlyph(item.icon) : null
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'menuitem',
      accessibilityLabel: item.label,
      accessibilityState: { disabled: item.disabled === true },
      disabled: item.disabled,
      onPress: () => onActivate(item),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        minHeight: tokens.size.touchTarget,
        paddingHorizontal: tokens.space[2],
        opacity: item.disabled ? 0.45 : 1,
      },
    },
    iconGlyph ? h(Text, { variant: 'md' }, iconGlyph) : null,
    h(Text, {
      variant: 'md',
      tone: item.tone === 'danger' ? 'error' : 'default',
      numberOfLines: 1,
      children: item.label,
    }),
    item.submenu ? h(Text, { tone: 'muted', children: '\u203a' }) : null,
  )
}

/**
 * A long-press / overflow menu.
 *
 * A bottom sheet, not a popover: the anchor position is ignored because a
 * finger covers it. A submenu **replaces the sheet's contents** with a back
 * row, which is the pattern the platform has already taught every user.
 *
 * Kit-side, the menu is dumb: it renders `MenuItemSpec`s and reports presses.
 * Which actions exist, and what they do, is built once by `@BBeBee/ui-menus`.
 */
export function ContextMenu(props: ContextMenuProps): ReactElement | null {
  const native = nativePrimitives()
  const [submenuId, setSubmenuId] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const p = c()

  useEffect(() => {
    if (props.open) return
    setSubmenuId(undefined)
    setFilter('')
    setCreating(false)
    setDraft('')
  }, [props.open])

  if (!props.open) return null

  const submenu = props.items.find((item) => item.id === submenuId)?.submenu
  const needle = filter.trim().toLowerCase()
  const visible = submenu
    ? submenu.items.filter((item) => item.label.toLowerCase().includes(needle))
    : []

  const close = () => props.onClose()
  const activate = (item: MenuItemSpec) => {
    if (item.disabled) return
    if (item.submenu) {
      setSubmenuId(item.id)
      setFilter('')
      setCreating(false)
      setDraft('')
      return
    }
    void item.onSelect?.()
    close()
  }

  const rows = submenu
    ? [
        h(MenuRow, {
          key: '__back',
          item: { id: '__back', label: `\u2039 ${submenu.title ?? 'Back'}` },
          onActivate: () => {
            setSubmenuId(undefined)
            setFilter('')
            setCreating(false)
            setDraft('')
          },
        }),
        submenu.searchPlaceholder && creating && submenu.create
          ? h(
              native.View as never,
              {
                key: '__create-field-top',
                style: {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: tokens.space[2],
                  marginBottom: tokens.space[2],
                },
              },
              h(
                native.View as never,
                { style: { flex: 1 } },
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
          : submenu.searchPlaceholder
            ? h(TextField, {
                key: '__filter',
                value: filter,
                onChange: setFilter,
                placeholder: submenu.searchPlaceholder,
                testID: 'context-menu-filter',
              })
            : null,
        ...(() => {
          const isCreateBottom = submenu.create?.placement === 'bottom'
          const hasTopSearch = Boolean(submenu.searchPlaceholder)
          const createRow = submenu.create
            ? hasTopSearch
              ? !creating
                ? h(MenuRow, {
                    key: '__create',
                    item: { id: '__create', label: submenu.create.label, icon: '\uff0b' },
                    onActivate: () => {
                      setCreating(true)
                      setDraft(filter.trim())
                    },
                  })
                : null
              : creating || submenu.create.alwaysVisible
                ? h(
                    native.View as never,
                    {
                      key: '__create-field',
                      style: {
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: tokens.space[2],
                        borderTopWidth: isCreateBottom ? 1 : 0,
                        borderTopColor: 'rgba(255, 255, 255, 0.08)',
                        paddingTop: isCreateBottom ? tokens.space[2] : 0,
                        marginTop: isCreateBottom ? tokens.space[1] : 0,
                      },
                    },
                    h(
                      native.View as never,
                      { style: { flex: 1 } },
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
                    item: { id: '__create', label: submenu.create.label, icon: '\uff0b' },
                    onActivate: () => setCreating(true),
                  })
            : null

          const itemRows = visible.length === 0
            ? [
                h(
                  native.View as never,
                  { key: '__empty', style: { padding: tokens.space[3] } },
                  h(Text, { variant: 'sm', tone: 'muted', children: submenu.emptyLabel ?? 'No matches' }),
                ),
              ]
            : visible.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate }))

          return isCreateBottom
            ? [...itemRows, ...(createRow ? [createRow] : [])]
            : [...(createRow ? [createRow] : []), ...itemRows]
        })(),
      ]
    : props.items.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate }))

  return h(
    native.Modal as never,
    {
      visible: true,
      transparent: true,
      animationType: 'slide',
      onRequestClose: close,
    },
    h(
      native.Pressable as never,
      {
        onPress: close,
        style: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
      },
      h(
        native.Pressable as never,
        {
          // A press inside must not close it; only the backdrop does.
          onPress: () => {},
          ...common(props),
          style: {
            paddingHorizontal: tokens.space[3],
            paddingBottom: tokens.space[5],
            paddingTop: tokens.space[2],
            borderTopLeftRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.lg,
            backgroundColor: p.bg.overlay,
          },
        },
        h(
          native.View as never,
          { style: { width: 36, height: 4, borderRadius: 2, backgroundColor: p.border.strong, alignSelf: 'center', marginBottom: tokens.space[2] } },
        ),
        props.title
          ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: props.title })
          : null,
        ...rows.filter((row) => row !== null),
      ),
    ),
  )
}
