import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
  useSearchSourceSelection,
  useSourceSearch,
  type SearchInterfaceKind,
} from '@BBeBee/plugin-sources/hooks'
import {
  Button,
  ContextMenu,
  EmptyState,
  Text,
  TextField,
  tablerIcon,
} from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { SourcePanel } from '../components/SourcePanel.js'

const p = () => palettes.dark

export function SearchScreen({
  ctx,
  query,
  sourceIds: initialSourceIds,
  typesBySource: initialTypesBySource,
  searchTimestamp,
  onOpenAlbum,
}: {
  ctx: Context
  query?: string
  sourceIds?: readonly string[]
  typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
  searchTimestamp?: number
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const scheme = p()
  const search = useSourceSearch(ctx)
  const selection = useSearchSourceSelection(ctx)
  const [text, setText] = useState(query ?? '')
  const menu = useTrackMenu(ctx)
  const lastSearchKeyRef = useRef<string | null>(null)
  const [collapsedSources, setCollapsedSources] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (query && query.trim().length > 0) {
      const trimmed = query.trim()
      setText(trimmed)
      const targetSourceIds = initialSourceIds ?? selection.selectedIds
      const targetTypesBySource = initialTypesBySource ?? selection.typesBySource
      const searchKey = `${trimmed}:${searchTimestamp ?? ''}:${targetSourceIds.join(',')}`
      if (targetSourceIds.length > 0 && lastSearchKeyRef.current !== searchKey) {
        lastSearchKeyRef.current = searchKey
        search.run(trimmed, {
          sourceIds: targetSourceIds,
          typesBySource: targetTypesBySource,
        })
      }
    }
  }, [query, searchTimestamp, initialSourceIds, initialTypesBySource, selection.selectedIds, selection.typesBySource])

  const submitted = search.status !== 'idle'
  const busy = search.status === 'loading'
  const canSearch = text.trim().length > 0 && selection.selectedIds.length > 0 && !busy
  const submit = () => {
    if (canSearch) {
      search.run(text, {
        sourceIds: selection.selectedIds,
        typesBySource: selection.typesBySource,
      })
    }
  }
  const clear = () => {
    search.reset()
    setText('')
    setCollapsedSources(new Set())
  }

  const openAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    // 'album.view' is plugin-album's view descriptor id — serialized data, a literal, not an import.
    serviceOf<UiService>(ctx, 'ui')?.navigate('album.view', { urn })
  }

  const toggleSource = (sourceId: string) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const expandAll = () => {
    setCollapsedSources(new Set())
  }

  const collapseAll = () => {
    const allIds = search.data?.bySource.map((s) => s.sourceId) ?? []
    setCollapsedSources(new Set(allIds))
  }

  const bySource = search.data?.bySource ?? []

  return h(
    Fragment,
    null,
    h(
      'section',
      {
        'aria-label': 'Search',
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          padding: tokens.space[4],
          gap: tokens.space[4],
          background: 'var(--bg-primary, ' + scheme.bg.base + ')',
        },
      },
      // Search controls card (Search input + Source toggle chips)
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[3],
            background: 'var(--surface-1, ' + scheme.bg.raised + ')',
            padding: tokens.space[3],
            borderRadius: tokens.radius.md,
            border: '1px solid var(--border-subtle, ' + scheme.border.subtle + ')',
            boxShadow: 'var(--shadow-dropdown, 0 2px 16px rgba(0, 0, 0, 0.25))',
          },
        },
        h(
          'form',
          {
            onSubmit: (e: { preventDefault: () => void }) => {
              e.preventDefault()
              submit()
            },
            style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] },
          },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(TextField, {
              value: text,
              onChange: setText,
              placeholder: '搜索歌曲、专辑、艺术家…',
              accessibilityLabel: 'Search query',
              testID: 'search-input',
            }),
          ),
          h(Button, {
            onPress: submit,
            disabled: !canSearch,
            loading: busy,
            testID: 'search-submit',
            children: '搜索',
          }),
          submitted
            ? h(Button, {
                variant: 'ghost',
                onPress: clear,
                testID: 'search-clear',
                children: '清空',
              })
            : null,
        ),
        h(
          'div',
          {
            role: 'group',
            'aria-label': 'Sources and interfaces to search',
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: tokens.space[1],
            },
          },
          ...selection.interfaces.map((iface) =>
            h(SourceChip, {
              key: iface.id,
              label: `${iface.sourceName} · ${iface.kind === 'track' ? '单曲' : '歌手'}`,
              selected: selection.isInterfaceSelected(iface.id),
              disabled: !iface.searchable,
              onPress: () => selection.toggleInterface(iface.id),
              accessibilityLabel: `${selection.isInterfaceSelected(iface.id) ? '不搜索' : '搜索'} ${iface.sourceName} ${iface.kind === 'track' ? '单曲' : '歌手'}`,
              testID: `search-source-${iface.sourceId}-${iface.kind}`,
            }),
          ),
          selection.interfaces.some((iface) => iface.searchable)
            ? h(SourceChip, {
                label: selection.allSelected ? '取消全选' : '全选',
                selected: false,
                onPress: selection.toggleAll,
                accessibilityLabel: selection.allSelected ? '取消全选音源' : '全选所有音源',
                testID: 'search-toggle-all',
              })
            : null,
        ),
      ),
      // Results area
      !submitted
        ? h(
            'div',
            {
              style: {
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: tokens.space[3],
                color: 'var(--text-muted, ' + scheme.text.disabled + ')',
              },
            },
            tablerIcon('search', {
              size: 48,
              color: 'var(--border-hover, ' + scheme.border.strong + ')',
            }),
            h(
              Text,
              {
                variant: 'md',
                style: { color: 'var(--text-secondary, ' + scheme.text.secondary + ')' },
              },
              '输入关键词，跨音源统一搜索',
            ),
            h(
              Text,
              {
                variant: 'sm',
                tone: 'muted',
                style: { color: 'var(--text-tertiary, #8B95B0)' },
              },
              '每个音源独立成卡片面板，可折叠展开并支持分页加载更多',
            ),
          )
        : search.status === 'error' && search.error
          ? h(EmptyState, {
              icon: 'alert',
              title: '搜索失败',
              description: search.error.message,
              action: h(Button, {
                variant: 'secondary',
                onPress: () =>
                  search.run(search.text, {
                    sourceIds: selection.selectedIds,
                    typesBySource: selection.typesBySource,
                  }),
                children: '重试',
              }),
            })
          : busy
            ? h(EmptyState, {
                title: `正在搜索 “${search.text}”…`,
                description: '等待各已选音源返回检索结果。',
              })
            : h(
                'div',
                {
                  'aria-label': 'Search results',
                  style: {
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: tokens.space[3],
                  },
                },
                // Results summary toolbar
                bySource.length > 0
                  ? h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: `0 ${tokens.space[1]}px`,
                          color: 'var(--text-secondary, ' + scheme.text.secondary + ')',
                          fontSize: tokens.font.size.xs,
                        },
                      },
                      h(
                        'span',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: tokens.space[1],
                            color: 'var(--text-tertiary, #8B95B0)',
                          },
                        },
                        tablerIcon('search', { size: 14, color: 'var(--text-tertiary, #8B95B0)' }),
                        h('span', null, `检索到 ${bySource.length} 个音源的结果`),
                      ),
                      h(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: tokens.space[2],
                          },
                        },
                        h(Button, {
                          variant: 'ghost',
                          testID: 'search-expand-all',
                          onPress: expandAll,
                          children: '全部展开',
                        }),
                        h(Button, {
                          variant: 'ghost',
                          testID: 'search-collapse-all',
                          onPress: collapseAll,
                          children: '全部收起',
                        }),
                      ),
                    )
                  : null,
                // Scrollable Panels Container
                h(
                  'div',
                  {
                    style: {
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: tokens.space[3],
                      paddingRight: tokens.space[1],
                    },
                  },
                  ...bySource.map((entry) => {
                    const sourceName =
                      selection.options.find((option) => option.id === entry.sourceId)?.name ??
                      entry.sourceId
                    return h(SourcePanel, {
                      key: entry.sourceId,
                      ctx,
                      sourceId: entry.sourceId,
                      sourceName,
                      tracks: entry.result?.tracks?.items ?? [],
                      albums: entry.result?.albums?.items ?? [],
                      artists: entry.result?.artists?.items ?? [],
                      playlists: entry.result?.playlists?.items ?? [],
                      error: entry.error,
                      pending: entry.pending,
                      tookMs: entry.tookMs,
                      searchQuery: search.text,
                      expanded: !collapsedSources.has(entry.sourceId),
                      pagination: search.pagination[entry.sourceId],
                      onToggle: () => toggleSource(entry.sourceId),
                      onLoadMore: () => void search.loadMore(entry.sourceId),
                      onOpenAlbum: openAlbum,
                      onTrackMenu: (track, anchor) => menu.open({ track }, anchor),
                    })
                  }),
                ),
              ),
      ),
      h(ContextMenu, menu.menuProps),
    )
}

function SourceChip({
  label,
  selected,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  accessibilityLabel: string
  testID: string
}): ReactElement {
  const scheme = p()
  const [hovered, setHovered] = useState(false)
  const interactive = hovered && !disabled
  return h(
    'button',
    {
      type: 'button',
      disabled,
      onClick: disabled ? undefined : onPress,
      'aria-pressed': selected,
      'aria-label': accessibilityLabel,
      'data-testid': testID,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        minHeight: 26,
        padding: `0 ${tokens.space[3]}px`,
        borderRadius: tokens.radius.pill,
        border: `1px solid ${
          selected
            ? 'transparent'
            : interactive
              ? 'var(--border-hover, ' + scheme.border.strong + ')'
              : 'var(--border-subtle, ' + scheme.border.subtle + ')'
        }`,
        background: selected
          ? interactive
            ? 'var(--primary-hover, ' + scheme.accent.hover + ')'
            : 'var(--primary, ' + scheme.accent.base + ')'
          : interactive
            ? 'var(--surface-hover, ' + scheme.bg.overlay + ')'
            : 'transparent',
        color: selected
          ? 'var(--bb-accent-on, ' + scheme.accent.on + ')'
          : interactive
            ? 'var(--text-primary, ' + scheme.text.primary + ')'
            : 'var(--text-secondary, ' + scheme.text.secondary + ')',
        fontFamily: tokens.font.family.ui,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.bold,
        letterSpacing: 0.3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background-color ${tokens.duration.fast}ms, color ${tokens.duration.fast}ms, border-color ${tokens.duration.fast}ms`,
      },
    },
    label,
  )
}
