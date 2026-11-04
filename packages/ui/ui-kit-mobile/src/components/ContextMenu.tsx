import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import type { ContextMenuProps, MenuItemSpec } from '@BBeBee/ui-core'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { c, common, nativePrimitives } from '../primitives.js'
import { hasSvgIcons, tablerIcon } from '../icons/tabler.js'
import { Text } from './Text.js'
import { TextField } from './TextField.js'
import { Button } from './Button.js'
import { GlassSurface, type LiquidGlassOptions } from './GlassSurface.js'

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
  shuffle: '🔀',
  'list-check': '☑',
  checkbox: '☑',
  list: '☰',
  'layout-list': '☰',
}

function menuIconGlyph(icon: ReactNode): ReactNode {
  // Non-string icons are already rendered elements — pass them through.
  if (typeof icon !== 'string') return icon
  // The shared menus hand over Tabler icon names; with SVG primitives wired
  // the real Tabler geometry renders, exactly as the desktop kit does. The
  // glyph map stays as the fallback for shells and tests without SVG.
  if (hasSvgIcons()) {
    const color = icon === 'heart-filled' ? '#E53935' : undefined
    const drawn = tablerIcon(icon, { size: 20, color })
    if (drawn) return drawn
  }
  if (icon === 'heart-filled') return '❤️'
  const mapped = MENU_ICON_GLYPHS[icon]
  if (mapped) return mapped
  return /^[a-z0-9-]+$/i.test(icon) ? null : icon
}

/** One menu row. `role` is Android's, so TalkBack announces it as a menu item. */
function MenuRow({
  item,
  onActivate,
  isDropdown,
}: {
  item: MenuItemSpec
  onActivate: (item: MenuItemSpec) => void
  isDropdown?: boolean
}): ReactElement {
  const native = nativePrimitives()
  const iconGlyph = item.icon ? menuIconGlyph(item.icon) : null
  return h(
    native.Pressable as never,
    {
      testID: item.testID ?? item.id,
      accessibilityRole: 'menuitem',
      accessibilityLabel: item.label,
      accessibilityState: { disabled: item.disabled === true },
      disabled: item.disabled,
      onPress: () => onActivate(item),
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: isDropdown ? tokens.space[2] + 2 : tokens.space[3],
        minHeight: isDropdown ? 38 : tokens.size.touchTarget,
        paddingHorizontal: isDropdown ? tokens.space[3] : tokens.space[2],
        paddingVertical: isDropdown ? 6 : 0,
        borderRadius: isDropdown ? 8 : 0,
        opacity: item.disabled ? 0.45 : 1,
      },
    },
    iconGlyph
      ? h(
          native.View as never,
          { style: { width: isDropdown ? 20 : 24, alignItems: 'center', justifyContent: 'center' } },
          typeof iconGlyph === 'string'
            ? h(Text, { variant: isDropdown ? 'sm' : 'md' }, iconGlyph)
            : iconGlyph,
        )
      : isDropdown
        ? h(native.View as never, { style: { width: 4 } })
        : null,
    h(
      native.View as never,
      { style: { flex: 1 } },
      h(Text, {
        variant: isDropdown ? 'sm' : 'md',
        tone: item.tone === 'danger' ? 'error' : 'default',
        numberOfLines: 1,
        children: item.label,
      }),
    ),
    item.submenu ? h(Text, { tone: 'muted', style: { marginLeft: 'auto' }, children: '\u203a' }) : null,
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
export function ContextMenu(
  props: ContextMenuProps & {
    /**
     * Optional Cordis context. When provided, the kit-owned chrome copy (the
     * back row, the create-row buttons, the empty-filter line) is translated
     * via `useI18n`; without it the built-in English copy renders. Item
     * labels stay the caller's responsibility.
     */
    ctx?: Context
    /**
     * Opt-in glass surface, threaded by the caller like `Sheet`'s: the
     * menu's sheet surface goes glass and the inner pressable goes
     * transparent. The create-row TextField inside keeps its solid fill —
     * fields inside a glass surface stay solid.
     */
    liquid?: LiquidGlassOptions
  },
): ReactElement | null {
  const native = nativePrimitives()
  // Deliberately hook-free: the kit's tree() tests invoke components as plain
  // functions. Locale changes reach this component because its
  // useI18n-subscribed ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
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

  const isDropdown = props.placement === 'top-right' || props.placement === 'dropdown'

  const rows = submenu
    ? [
        h(MenuRow, {
          key: '__back',
          item: { id: '__back', label: `\u2039 ${submenu.title ?? t('app:common.back', 'Back')}` },
          isDropdown,
          onActivate: () => {
            setSubmenuId(undefined)
            setFilter('')
            setCreating(false)
            setDraft('')
          },
        }),
        isDropdown
          ? h(native.View as never, {
              key: '__back_div',
              style: { height: 1, backgroundColor: p.border.subtle, marginVertical: tokens.space[1] },
            })
          : null,
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
                children: submenu.create.buttonLabel ?? t('app:common.confirm', 'OK'),
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
                    item: { id: '__create', label: submenu.create.label, icon: 'plus' },
                    isDropdown,
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
                      children: submenu.create.buttonLabel ?? t('app:common.confirm', 'OK'),
                    }),
                  )
                : h(MenuRow, {
                    key: '__create',
                    item: { id: '__create', label: submenu.create.label, icon: 'plus' },
                    isDropdown,
                    onActivate: () => setCreating(true),
                  })
            : null

          const itemRows = visible.length === 0
            ? [
                h(
                  native.View as never,
                  { key: '__empty', style: { padding: tokens.space[3] } },
                  h(Text, { variant: 'sm', tone: 'muted', children: submenu.emptyLabel ?? t('app:common.contextMenu.noMatches', 'No matches') }),
                ),
              ]
            : visible.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate, isDropdown }))

          return isCreateBottom
            ? [...itemRows, ...(createRow ? [createRow] : [])]
            : [...(createRow ? [createRow] : []), ...itemRows]
        })(),
      ]
    : props.items.map((item) => h(MenuRow, { key: item.id, item, onActivate: activate, isDropdown }))

  if (isDropdown) {
    const dropdownInner = h(
      native.View as never,
      {
        ...common(props),
        style: {
          paddingHorizontal: tokens.space[2],
          paddingVertical: tokens.space[2],
          backgroundColor: props.liquid ? 'transparent' : p.bg.overlay,
        },
      },
      props.title && !submenu
        ? h(
            Text,
            {
              variant: 'xs',
              tone: 'muted',
              numberOfLines: 1,
              style: {
                fontWeight: '600',
                paddingHorizontal: tokens.space[3],
                paddingVertical: tokens.space[1],
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                opacity: 0.8,
              },
              children: props.title,
            },
          )
        : null,
      ...rows.filter((row) => row !== null),
    )

    const cardContent = props.liquid
      ? h(
          GlassSurface,
          {
            liquid: props.liquid,
            intensity: 90,
            borderRadius: 14,
            style: {
              borderRadius: 14,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.15)',
              minWidth: 200,
              maxWidth: 260,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
              elevation: 12,
            },
          },
          dropdownInner,
        )
      : h(
          native.View as never,
          {
            style: {
              backgroundColor: p.bg.overlay,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: p.border.subtle,
              overflow: 'hidden',
              minWidth: 200,
              maxWidth: 260,
              shadowColor: '#000000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
              elevation: 12,
            },
          },
          dropdownInner,
        )

    return h(
      native.Modal as never,
      {
        visible: true,
        transparent: true,
        animationType: 'fade',
        onRequestClose: close,
      },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(native.Pressable as never, {
          onPress: close,
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.25)',
          },
        }),
        h(
          native.View as never,
          {
            style: {
              position: 'absolute',
              top: props.placement === 'dropdown' && props.y ? Math.max(16, props.y) : 76,
              right: 16,
            },
          },
          cardContent,
        ),
      ),
    )
  }

  // Opt-in glass surface, same shape as `Sheet`'s: the glass pipeline is
  // the sheet's surface and the inner view goes transparent so it
  // cannot paint over it. Without `liquid` the solid overlay stays.
  const inner = h(
    native.View as never,
    {
      ...common(props),
      style: {
        paddingHorizontal: tokens.space[3],
        paddingBottom: tokens.space[5],
        paddingTop: tokens.space[2],
        borderTopLeftRadius: tokens.radius.lg,
        borderTopRightRadius: tokens.radius.lg,
        backgroundColor: props.liquid ? 'transparent' : p.bg.overlay,
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
  )

  return h(
    native.Modal as never,
    {
      visible: true,
      transparent: true,
      animationType: 'slide',
      onRequestClose: close,
    },
    h(
      native.View as never,
      { style: { flex: 1, justifyContent: 'flex-end' } },
      h(native.Pressable as never, {
        onPress: close,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
        },
      }),
      props.liquid
        ? h(
            GlassSurface,
            {
              liquid: props.liquid,
              intensity: 85,
              borderRadius: tokens.radius.lg,
              style: {
                borderTopLeftRadius: tokens.radius.lg,
                borderTopRightRadius: tokens.radius.lg,
              },
            },
            inner,
          )
        : inner,
    ),
  )
}
