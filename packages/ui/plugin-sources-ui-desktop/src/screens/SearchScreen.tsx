import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { UiService } from '@BBeBee/protocol'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
  useSearchSourceSelection,
  useSourceSearch,
  type SearchInterfaceKind,
} from '@bbebee/plugin-sources/hooks'
import {
  Button,
  ContextMenu,
  EmptyState,
  Text,
  TextField,
  tablerIcon,
  useI18n,
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
  const { t } = useI18n(ctx)
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
        'aria-label': t('sources:search.search'),
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
              placeholder: t('sources:search.searchSongsAlbumsArtists'),
              accessibilityLabel: t('sources:search.searchQuery'),
              testID: 'search-input',
            }),
          ),
          h(Button, {
            onPress: submit,
            disabled: !canSearch,
            loading: busy,
            testID: 'search-submit',
            children: t('sources:search.search'),
          }),
          submitted
            ? h(Button, {
                variant: 'ghost',
                onPress: clear,
                testID: 'search-clear',
                children: t('app:common.clear'),
              })
            : null,
        ),
        h(
          'div',
          {
            role: 'group',
            'aria-label': t('sources:search.sourcesAndInterfacesToSearch'),
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
              label: `${iface.sourceName} · ${t(iface.kind === 'track' ? 'sources:search.track' : 'sources:search.artist')}`,
              selected: selection.isInterfaceSelected(iface.id),
              disabled: !iface.searchable,
              onPress: () => selection.toggleInterface(iface.id),
              accessibilityLabel: `${t(selection.isInterfaceSelected(iface.id) ? 'sources:search.excludeFromSearch' : 'sources:search.search')} ${iface.sourceName} ${t(iface.kind === 'track' ? 'sources:search.track' : 'sources:search.artist')}`,
              testID: `search-source-${iface.sourceId}-${iface.kind}`,
            }),
          ),
          selection.interfaces.some((iface) => iface.searchable)
            ? h(SourceChip, {
                label: selection.allSelected ? t('sources:search.deselectAll') : t('sources:search.selectAll'),
                selected: false,
                onPress: selection.toggleAll,
                accessibilityLabel: selection.allSelected ? t('sources:search.deselectAllSources') : t('sources:search.selectAllSources'),
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
              t('sources:search.typeAKeyword'),
            ),
            h(
              Text,
              {
                variant: 'sm',
                tone: 'muted',
                style: { color: 'var(--text-tertiary, #8B95B0)' },
              },
              t('sources:search.eachSourceRenders'),
            ),
          )
        : search.status === 'error' && search.error
          ? h(EmptyState, {
              icon: 'alert',
              title: t('sources:search.searchFailed'),
              description: search.error.message,
              action: h(Button, {
                variant: 'secondary',
                onPress: () =>
                  search.run(search.text, {
                    sourceIds: selection.selectedIds,
                    typesBySource: selection.typesBySource,
                  }),
                children: t('app:common.retry'),
              }),
            })
          : busy
            ? h(EmptyState, {
                title: t('sources:search.searching', { text: search.text }),
                description: t('sources:search.waitingForTheSelectedSources'),
              })
            : h(
                'div',
                {
                  'aria-label': t('sources:search.searchResults'),
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
                        h('span', null, t('sources:search.resultsFromSources', { length: bySource.length })),
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
                          children: t('sources:search.expandAll'),
                        }),
                        h(Button, {
                          variant: 'ghost',
                          testID: 'search-collapse-all',
                          onPress: collapseAll,
                          children: t('sources:search.collapseAll'),
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
