/**
 * React Native views for `plugin-sources`.
 *
 * Same hooks, same view ids, same three-state handling as the desktop twin —
 * only the elements differ. A tab bar of two buttons rather than a tablist,
 * a single-column list rather than a grid, because a phone has one column.
 */

import { createElement as h, Fragment, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import type { DownloadsService, ImportReport, ScanSpecifiedDir, ScannerService, TraceEvent, UiService } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  isLocalSource,
  playFromList,
  searchResultRows,
  useLocalFolders,
  useSearchSourceSelection,
  useSourceImport,
  useSourceSearch,
  useSourceTrace,
  useSources,
  type SearchResultRow,
} from '@BBeBee/plugin-sources/hooks'
import {
  Artwork,
  ContextMenu,
  Button,
  EmptyState,
  IconButton,
  JsonTree,
  List,
  Text,
  TextField,
  TrackRow,
  nativePrimitives,
} from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { SourceConfigureModal } from './SourceConfigureModal.js'

export { SourceConfigureModal } from './SourceConfigureModal.js'

const p = () => palettes.dark

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 *
 * A component rather than a bare hook call at each site because list rows
 * render from callbacks: the hook suppresses the remote URL while the cache
 * fetches, so the fallback paints instead of a second request.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/** `TrackRow` renders its own `Artwork`; this is the same resolution for its track. */
function CachedTrackRow({ ctx, ...props }: TrackRowProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.track.artwork)
  return h(TrackRow, {
    ...props,
    track: artwork ? { ...props.track, artwork } : props.track,
  })
}

export function SearchScreen({
  ctx,
  query,
  onOpenAlbum,
}: {
  ctx: Context
  query?: string
  onOpenAlbum?: (urn: string) => void
}): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const downloads = serviceOf<DownloadsService>(ctx, 'downloads')
  const selection = useSearchSourceSelection(ctx)
  const search = useSourceSearch(ctx)
  const [text, setText] = useState(query ?? '')
  const menu = useTrackMenu(ctx)

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
  }

  const rows = searchResultRows(
    search.data,
    (sourceId) => selection.options.find((option) => option.id === sourceId)?.name ?? sourceId,
  )

  const openAlbum = (urn: string) => {
    onOpenAlbum?.(urn)
    serviceOf<UiService>(ctx, 'ui')?.navigate(ALBUM_VIEWS.album, { urn })
  }

  return h(
    Fragment,
    null,
    h(
    native.View as never,
    {
      accessibilityLabel: 'Search',
      style: {
        flex: 1,
        backgroundColor: scheme.bg.base,
        padding: tokens.space[4],
        gap: tokens.space[4],
      },
    },
    // The search bar with its source chips directly beneath it. Both stay
    // pinned at the top in either state — the results never push the controls
    // off screen, and the chips never float away from what they configure.
    h(
      native.View as never,
      { style: { gap: tokens.space[2] } },
      h(TextField, {
        value: text,
        onChange: setText,
        placeholder: 'Songs, albums, artists…',
        accessibilityLabel: 'Search query',
        testID: 'search-input',
      }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', gap: tokens.space[2] } },
        h(Button, {
          onPress: submit,
          disabled: !canSearch,
          loading: busy,
          testID: 'search-submit',
          children: 'Search',
        }),
        submitted
          ? h(Button, { variant: 'ghost', onPress: clear, testID: 'search-clear', children: 'Clear' })
          : null,
      ),
      h(
        native.View as never,
        {
          accessibilityRole: 'group',
          accessibilityLabel: 'Sources and interfaces to search',
          style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[1] },
        },
        // One toggle per *interface*, not per source: a backend whose user
        // search is a separate endpoint offers songs and artists as two
        // independently searchable things. See the desktop twin.
        ...selection.interfaces.map((iface) =>
          h(SourceChip, {
            key: iface.id,
            label: `${iface.sourceName} · ${iface.kind === 'track' ? 'Songs' : 'Artists'}`,
            selected: selection.isInterfaceSelected(iface.id),
            disabled: !iface.searchable,
            onPress: () => selection.toggleInterface(iface.id),
            accessibilityLabel: `${selection.isInterfaceSelected(iface.id) ? 'Do not search' : 'Search'} ${iface.sourceName} ${iface.kind === 'track' ? 'songs' : 'artists'}`,
            testID: `search-source-${iface.sourceId}-${iface.kind}`,
          }),
        ),
        selection.interfaces.some((iface) => iface.searchable)
          ? h(SourceChip, {
              label: selection.allSelected ? 'None' : 'All',
              selected: false,
              onPress: selection.toggleAll,
              accessibilityLabel: selection.allSelected ? 'Deselect every source' : 'Select every source',
              testID: 'search-toggle-all',
            })
          : null,
      ),
    ),
    !submitted
      ? null
      : search.status === 'error' && search.error
        ? h(EmptyState, {
            icon: '⚠',
            title: 'Search failed',
            description: search.error.message,
            action: h(Button, {
              variant: 'secondary',
              onPress: () =>
                search.run(search.text, {
                  sourceIds: selection.selectedIds,
                  typesBySource: selection.typesBySource,
                }),
              children: 'Try again',
            }),
          })
        : busy
          ? h(EmptyState, {
              title: `Searching for “${search.text}”…`,
              description: 'Waiting for every selected source to answer.',
            })
          : h(
              native.View as never,
              { style: { flex: 1, minHeight: 0 } },
              h(List<SearchResultRow>, {
                items: rows,
                accessibilityLabel: 'Search results',
                estimatedItemSize: tokens.size.row,
                keyExtractor: (row) => row.key,
                empty: h(EmptyState, {
                  icon: '🔎',
                  title: 'Nothing found',
                  description: 'No selected source had a match. Try a different search or source set.',
                }),
                renderItem: (row) =>
                  row.kind === 'header'
                    ? h(
                        native.View as never,
                        {
                          accessibilityRole: 'header',
                          style: {
                            flexDirection: 'row',
                            alignItems: 'baseline',
                            gap: tokens.space[2],
                            paddingTop: tokens.space[3],
                            paddingBottom: tokens.space[1],
                          },
                        },
                        h(Text, { variant: 'md' }, row.name),
                        h(
                          Text,
                          { variant: 'sm', tone: row.status === 'error' ? 'error' : 'muted' },
                          row.detail,
                        ),
                      )
                    : row.kind === 'track'
                      ? h(CachedTrackRow, { ctx,
                          track: row.track,
                          showAlbum: true,
                          onPress: () =>
                            void playFromList(ctx, row.track.urn, {
                              urns: [row.track.urn],
                              context: { kind: 'search', label: search.text },
                            }),
                          onDownload: downloads ? () => void downloads.enqueue([row.track.urn]) : undefined,
                          onMore: (anchor) => menu.open({ track: row.track }, anchor),
                        })
                      : row.kind === 'album'
                        ? h(
                            native.Pressable as never,
                            {
                              accessibilityRole: 'button',
                              accessibilityLabel: row.album.title,
                              onPress: () => openAlbum(row.album.urn),
                              style: {
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: tokens.space[3],
                                padding: tokens.space[2],
                              },
                            },
                            h(CachedArtwork, { ctx,
                              artwork: row.album.artwork,
                              seed: row.album.urn,
                              size: tokens.size.artworkThumb,
                            }),
                            h(
                              native.View as never,
                              { style: { flex: 1, minWidth: 0 } },
                              h(Text, { numberOfLines: 1, children: row.album.title }),
                              h(Text, {
                                variant: 'sm',
                                tone: 'muted',
                                numberOfLines: 1,
                                children: row.album.artists?.map((a) => a.name).join(', ') ?? '',
                              }),
                            ),
                          )
                        : h(ResultLine, { ctx, row }),
              }),
            ),
    ),
    h(ContextMenu, menu.menuProps),
  )
}

/**
 * A source toggle. See the desktop twin: a filter-sized chip rather than the
 * kit's action-sized `Button`, because the selection it edits already lives
 * in the headless hooks and this is the half a view package writes twice.
 */
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
  const native = nativePrimitives()
  const scheme = p()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel,
      accessibilityState: { selected, disabled },
      testID,
      disabled,
      onPress: disabled ? undefined : onPress,
      style: {
        // 30, not the 44 an action button takes: a chip is a filter, and the
        // row still clears the touch-target guidance with its own padding.
        minHeight: 30,
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.pill,
        borderWidth: 1,
        borderColor: selected ? 'transparent' : scheme.border.subtle,
        backgroundColor: selected ? scheme.accent.base : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      },
    },
    h(
      native.Text as never,
      {
        style: {
          color: selected ? scheme.accent.on : scheme.text.secondary,
          fontSize: tokens.font.size.xs,
          fontWeight: tokens.font.weight.bold,
        },
      },
      label,
    ),
  )
}

/**
 * A non-playable hit — an artist or a playlist. See the desktop twin: no
 * artist screen exists yet, so the row does not pretend to be pressable.
 */
function ResultLine({
  ctx,
  row,
}: {
  ctx: Context
  row: Extract<SearchResultRow, { kind: 'artist' | 'playlist' }>
}): ReactElement {
  const native = nativePrimitives()
  const subtitle = row.kind === 'playlist' ? row.playlist.owner : undefined
  return h(
    native.View as never,
    {
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space[3],
        padding: tokens.space[2],
      },
    },
    h(CachedArtwork, { ctx,
      artwork: row.kind === 'playlist' ? row.playlist.artwork : row.artist.artwork,
      seed: row.kind === 'playlist' ? row.playlist.urn : row.artist.urn,
      size: tokens.size.artworkThumb,
    }),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, {
        numberOfLines: 1,
        children: row.kind === 'playlist' ? row.playlist.name : row.artist.name,
      }),
      subtitle
        ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: subtitle })
        : null,
    ),
  )
}

/* ── importing ──────────────────────────────────────────────────────────── */

/**
 * Paste a source string.
 *
 * Same screen as desktop, same hook, different primitives — which is the whole
 * arrangement in docs/08 §1. The preview exists for the same reason too: a set
 * pasted from a forum is opaque, and an import that silently adds eleven
 * sources is one the user cannot undo without knowing which eleven.
 */
export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Import a source'),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      'Paste a source string — one document or a whole set. Nothing is written until you import.',
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 10,
      placeholder: '{ "sourceUrl": "https://…", "sourceName": "…" }',
      accessibilityLabel: 'Source string',
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          native.View as never,
          {
            accessibilityLabel: 'What will be imported',
            style: {
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              backgroundColor: scheme.bg.raised,
              gap: tokens.space[1],
            },
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${state.preview.count} source${state.preview.count === 1 ? '' : 's'} in this string`,
          ),
          ...state.preview.names.map((name) => h(Text, { key: name, variant: 'sm' }, name)),
        )
      : null,
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      h(Button, {
        onPress: state.submit,
        disabled: state.busy || !state.preview,
        loading: state.busy,
        testID: 'source-import-submit',
        children: 'Import',
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: 'Clear',
      }),
    ),
    state.report ? h(Text, { variant: 'sm', tone: 'muted' }, summariseImport(state.report)) : null,
  )
}

/** What an import did, in a sentence. Never empty — see the desktop twin. */
function summariseImport(report: ImportReport): string {
  const parts: string[] = []
  if (report.added.length) parts.push(`${report.added.length} added`)
  if (report.updated.length) parts.push(`${report.updated.length} updated`)
  if (report.unchanged.length) parts.push(`${report.unchanged.length} unchanged`)
  if (report.rejected.length) parts.push(`${report.rejected.length} rejected`)
  return parts.length > 0 ? parts.join(', ') : 'nothing to import'
}

/** Every step, including the ones that worked. See the desktop twin. */
function TraceList({
  events,
  running,
}: {
  events: readonly TraceEvent[]
  running: boolean
}): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? 'Running…' : 'No trace yet',
      description: running ? undefined : 'Run a step to see what each rule receives and produces.',
    })
  }
  return h(
    native.View as never,
    { accessibilityLabel: 'Trace', style: { gap: tokens.space[1] } },
    ...events.map((event, i) =>
      h(
        native.View as never,
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            backgroundColor: event.kind === 'value' ? scheme.bg.overlay : scheme.bg.raised,
            borderLeftWidth: 3,
            borderLeftColor: event.kind === 'error' ? scheme.state.error : scheme.border.subtle,
            maxHeight: event.kind === 'value' ? 420 : undefined,
          },
        },
        event.kind === 'value' ? valueBlock(event) : h(Text, { variant: 'sm' }, traceLine(event)),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
      return `${event.method} ${event.url} → ${event.status === 0 ? 'no response' : event.status} (${event.ms}ms)`
    case 'error':
      return `✗ ${event.block ? `${event.block}.${event.field ?? ''} ` : ''}${event.message}`
    case 'result':
      return `✓ ${event.summary}`
    case 'log':
      return `· ${event.message}`
    // Value events render through `valueBlock`, never as a line; this branch
    // exists so the switch stays total if a kind is ever added.
    default:
      return ''
  }
}

/**
 * A parsed JSON value as a tree — the shape readable at a glance, expandable
 * where the reader wants to look. Unparseable text (an HTML page, a bare URL)
 * stays exactly as it arrived.
 */
function valueBlock(event: Extract<TraceEvent, { kind: 'value' }>): ReactElement {
  const native = nativePrimitives()
  const text = event.value
  const parseable = text.trim().startsWith('{') || text.trim().startsWith('[')
  let parsed: unknown
  if (parseable) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON after all — the raw text is the honest answer.
    }
  }
  return h(
    native.View as never,
    null,
    h(Text, { variant: 'sm', tone: 'muted' }, event.label),
    parsed !== undefined
      ? h(JsonTree, { value: parsed, accessibilityLabel: event.label, controls: true })
      : h(Text, { variant: 'sm' }, text),
  )
}

/* ── the source list ───────────────────────────────────────────────────── */

/**
 * The imported sources — the hub everything else hangs off. See the desktop
 * twin: use/do-not-use keeps the cached library, delete takes it too and asks
 * once, and the local-files row shows the folders it is actually made of
 * rather than controls that would not mean anything for files on disk.
 */
export function SourcesListScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const sources = useSources(ctx)
  const folders = useLocalFolders(ctx)
  const scanner = serviceOf<ScannerService>(ctx, 'scanner')
  const [confirming, setConfirming] = useState<string | undefined>(undefined)
  const [configuringSourceId, setConfiguringSourceId] = useState<string | undefined>(undefined)

  const removeSource = (id: string) => {
    setConfirming(undefined)
    // `forgetCatalogue` because this is the *delete* button, not the switch.
    void ctx.sources.remove(id, { forgetCatalogue: true })
  }

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Music sources'),
    h(Button, {
      onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceImport),
      testID: 'sources-list-import',
      children: 'Import a source',
    }),
    sources.length === 0
      ? h(EmptyState, {
          title: 'No sources yet',
          description: 'Import a source string to add a music backend.',
        })
      : h(
          native.View as never,
          { accessibilityLabel: 'Imported sources', style: { gap: tokens.space[2] } },
          ...sources.map((source) => {
            const local = isLocalSource(source)
            return h(
              native.View as never,
              {
                key: source.id,
                style: {
                  padding: tokens.space[3],
                  borderRadius: tokens.radius.sm,
                  backgroundColor: scheme.bg.raised,
                  gap: tokens.space[1],
                  opacity: source.enabled ? 1 : 0.6,
                },
              },
              h(Text, { variant: 'md' }, source.name),
              h(Text, { variant: 'sm', tone: 'muted' }, source.sourceUrl),
              !source.enabled
                ? h(Text, { variant: 'sm', tone: 'muted' }, 'disabled')
                : source.lastError
                  ? h(Text, { variant: 'sm', tone: 'muted' }, source.lastError)
                  : null,
              h(
                native.View as never,
                { style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[2] } },
                h(Button, {
                  variant: 'secondary',
                  onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate(SOURCES_VIEWS.sourceTest, { sourceId: source.id }),
                  testID: `sources-list-test-${source.id}`,
                  children: 'Test',
                }),
                !local
                  ? h(Button, {
                      variant: 'secondary',
                      onPress: () => setConfiguringSourceId(source.id),
                      testID: `sources-list-configure-${source.id}`,
                      children: 'Configure',
                    })
                  : null,
                // The local row has no enable switch of its own: its folders
                // are what can be switched off.
                !local
                  ? h(Button, {
                      variant: source.enabled ? 'ghost' : 'secondary',
                      onPress: () => void ctx.sources.setEnabled(source.id, !source.enabled),
                      accessibilityLabel: source.enabled ? `Stop using ${source.name}` : `Use ${source.name}`,
                      testID: `sources-list-toggle-${source.id}`,
                      children: source.enabled ? 'Disable' : 'Enable',
                    })
                  : null,
                !local && confirming === source.id
                  ? h(Text, { variant: 'sm', tone: 'warn' }, 'Delete source and its cached tracks?')
                  : null,
                !local && confirming === source.id
                  ? h(Button, {
                      onPress: () => removeSource(source.id),
                      accessibilityLabel: `Delete ${source.name} and its cached tracks`,
                      testID: `sources-list-delete-confirm-${source.id}`,
                      children: 'Delete',
                    })
                  : null,
                !local && confirming === source.id
                  ? h(Button, {
                      variant: 'ghost',
                      onPress: () => setConfirming(undefined),
                      children: 'Cancel',
                    })
                  : null,
                !local && confirming !== source.id
                  ? h(IconButton, {
                      icon: '🗑',
                      accessibilityLabel: `Delete ${source.name}`,
                      onPress: () => setConfirming(source.id),
                      testID: `sources-list-delete-${source.id}`,
                    })
                  : null,
              ),
              local ? h(LocalFolders, { folders, scanner }) : null,
            )
          }),
        ),
    h(SourceConfigureModal, {
      ctx,
      sourceId: configuringSourceId,
      open: configuringSourceId !== undefined,
      onClose: () => setConfiguringSourceId(undefined),
    }),
  )
}

/**
 * The folders behind the local source, said on the source's own row. See the
 * desktop twin: the same elements the Music folders screen manages, minus the
 * section entirely on a build without the scanner.
 */
function LocalFolders({
  folders,
  scanner,
}: {
  folders: readonly ScanSpecifiedDir[]
  scanner: ScannerService | undefined
}): ReactElement | null {
  const native = nativePrimitives()
  const scheme = p()
  if (!scanner) return null
  if (folders.length === 0) {
    return h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: 'No folders yet — add one under Settings → Music folders.',
    })
  }
  return h(
    native.View as never,
    {
      accessibilityLabel: 'Local music folders',
      style: {
        gap: tokens.space[1],
        borderTopWidth: 1,
        borderTopColor: scheme.border.subtle,
        paddingTop: tokens.space[2],
      },
    },
    ...folders.map((dir) =>
      h(
        native.View as never,
        {
          key: dir.id,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[2],
            opacity: dir.enabled ? 1 : 0.5,
          },
        },
        h(
          native.View as never,
          { style: { flex: 1, minWidth: 0 } },
          h(Text, { variant: 'sm', numberOfLines: 1 }, dir.uri),
          dir.lastError
            ? h(Text, { variant: 'sm', tone: 'error', numberOfLines: 1, children: dir.lastError })
            : null,
        ),
        h(Button, {
          variant: 'ghost',
          onPress: () => void scanner.setEnabled(dir.id, !dir.enabled),
          accessibilityLabel: dir.enabled ? `Disable ${dir.uri}` : `Enable ${dir.uri}`,
          testID: `source-folder-toggle-${dir.id}`,
          children: dir.enabled ? 'Disable' : 'Enable',
        }),
        // Keeps the tracks, like Music folders.
        h(IconButton, {
          icon: '🗑',
          accessibilityLabel: `Remove ${dir.uri}`,
          onPress: () => void scanner.removeSpecifiedDir(dir.id),
          testID: `source-folder-remove-${dir.id}`,
        }),
      ),
    ),
  )
}

/* ── testing a source, feature by feature ──────────────────────────────── */

/** A page number typed by the user, or undefined when the box is empty. */
function pageOf(text: string): number | undefined {
  const n = parseInt(text, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * One source, exercised feature by feature. See the desktop twin: the
 * selector picks the source under test, each implemented feature gets its own
 * test area, and every run streams HTTP lines, `src.log` lines and the whole
 * output into one trace. The dropdown is a button plus its option list —
 * React Native has no native select to borrow.
 */
export function TestScreen({ ctx, sourceId }: { ctx: Context; sourceId?: string }): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  const sources = useSources(ctx)
  const [selectedId, setSelectedId] = useState<string | undefined>(sourceId ?? sources[0]?.id)
  const trace = useSourceTrace(ctx, selectedId)
  const [pickerOpen, setPickerOpen] = useState(false)

  // A source imported after mount, or navigation carrying an initial id.
  // Neither overrides a selection the user already made.
  if (selectedId === undefined && sources.length > 0) setSelectedId(sources[0]!.id)

  const selected = sources.find((s) => s.id === selectedId)
  const provider = selectedId
    ? ctx.sources.providers.find((p) => p.sourceId === selectedId)
    : undefined

  const [searchText, setSearchText] = useState('test')
  const [searchPage, setSearchPage] = useState('')
  const [browseNode, setBrowseNode] = useState('')
  const [browsePage, setBrowsePage] = useState('')
  const [albumId, setAlbumId] = useState('')
  const [artistId, setArtistId] = useState('')
  const [playlistId, setPlaylistId] = useState('')
  const [playlistPage, setPlaylistPage] = useState('')
  const [lyricsId, setLyricsId] = useState('')
  const [libraryKind, setLibraryKind] = useState('playlist')
  const [libraryPage, setLibraryPage] = useState('')
  const [streamId, setStreamId] = useState('')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [url, setUrl] = useState('')
  const [headersJson, setHeadersJson] = useState('')
  const [body, setBody] = useState('')
  const [code, setCode] = useState('return src.time.now()')
  const [argsJson, setArgsJson] = useState('{ "key": "test", "page": 1 }')
  const [requestError, setRequestError] = useState<string | undefined>(undefined)

  const runHttp = () => {
    setRequestError(undefined)
    let headers: Record<string, string> | undefined
    if (headersJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(headersJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setRequestError('headers must be a JSON object')
          return
        }
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      } catch (error) {
        setRequestError(`headers are not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    trace.run({
      kind: 'http',
      method,
      url,
      ...(headers ? { headers } : {}),
      ...(method === 'POST' && body ? { body } : {}),
    })
  }

  const runJs = () => {
    setRequestError(undefined)
    trace.run({ kind: 'js', code, ...(argsJson.trim() ? { argsJson } : {}) })
  }

  if (sources.length === 0) {
    return h(
      native.View as never,
      { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
      h(Text, { variant: 'lg' }, 'Test a source'),
      h(EmptyState, {
        title: 'No sources yet',
        description: 'Import a source string first, then test it here.',
      }),
    )
  }

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    testID: string,
    placeholder?: string,
  ): ReactElement =>
    h(
      native.View as never,
      { key: label, style: { gap: tokens.space[1] } },
      h(Text, { variant: 'sm', tone: 'muted' }, label),
      h(TextField, { value, onChange, testID, ...(placeholder ? { placeholder } : {}) }),
    )

  const area = (
    title: string,
    testID: string,
    fields: ReactElement[],
    onRun: () => void,
    disabled: boolean,
  ): ReactElement =>
    h(
      native.View as never,
      {
        key: title,
        style: {
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          backgroundColor: scheme.bg.raised,
          gap: tokens.space[2],
        },
      },
      h(Text, { variant: 'md' }, title),
      ...fields,
      h(Button, {
        onPress: onRun,
        disabled: trace.running || disabled,
        loading: trace.running,
        testID,
        children: 'Run',
      }),
    )

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, 'Test a source'),

    h(Button, {
      onPress: () => setPickerOpen(!pickerOpen),
      testID: 'test-source-select',
      children: `${selected?.name ?? 'Pick a source'} ▾`,
    }),
    pickerOpen
      ? h(
          native.View as never,
          { accessibilityLabel: 'Source to test', style: { gap: tokens.space[1] } },
          ...sources.map((s) =>
            h(Button, {
              key: s.id,
              variant: s.id === selectedId ? 'secondary' : 'ghost',
              onPress: () => {
                setSelectedId(s.id)
                setPickerOpen(false)
                trace.clear()
              },
              testID: `test-source-option-${s.id}`,
              children: s.name,
            }),
          ),
        )
      : null,

    !provider
      ? h(
          Text,
          { variant: 'sm', tone: 'muted' },
          'This source is not active right now — enable it in the source list to exercise its features.',
        )
      : null,
    provider && provider.capabilities.search.tracks
      ? area('Search', 'test-run-search', [
          field('Keyword', searchText, setSearchText, 'test-search-text'),
          field('Page', searchPage, setSearchPage, 'test-search-page', '1'),
        ], () => trace.run({ kind: 'search', text: searchText, ...(pageOf(searchPage) ? { page: pageOf(searchPage) } : {}) }), !searchText.trim())
      : null,
    provider && provider.capabilities.browse
      ? area('Browse', 'test-run-browse', [
          field('Node id (empty for the root)', browseNode, setBrowseNode, 'test-browse-node'),
          field('Page', browsePage, setBrowsePage, 'test-browse-page', '1'),
        ], () => trace.run({ kind: 'browse', ...(browseNode.trim() ? { nodeId: browseNode.trim() } : {}), ...(pageOf(browsePage) ? { page: pageOf(browsePage) } : {}) }), false)
      : null,
    provider && typeof provider.getAlbum === 'function'
      ? area('Album', 'test-run-album', [
          field('Album id', albumId, setAlbumId, 'test-album-id'),
        ], () => trace.run({ kind: 'album', id: albumId.trim() }), !albumId.trim())
      : null,
    provider && typeof provider.getArtist === 'function'
      ? area('Artist', 'test-run-artist', [
          field('Artist id', artistId, setArtistId, 'test-artist-id'),
        ], () => trace.run({ kind: 'artist', id: artistId.trim() }), !artistId.trim())
      : null,
    provider && typeof provider.getPlaylist === 'function'
      ? area('Playlist', 'test-run-playlist', [
          field('Playlist id', playlistId, setPlaylistId, 'test-playlist-id'),
          field('Page', playlistPage, setPlaylistPage, 'test-playlist-page', '1'),
        ], () => trace.run({ kind: 'playlist', id: playlistId.trim(), ...(pageOf(playlistPage) ? { page: pageOf(playlistPage) } : {}) }), !playlistId.trim())
      : null,
    provider && typeof provider.getLyrics === 'function'
      ? area('Lyrics', 'test-run-lyrics', [
          field('Track id', lyricsId, setLyricsId, 'test-lyrics-id'),
        ], () => trace.run({ kind: 'lyrics', id: lyricsId.trim() }), !lyricsId.trim())
      : null,
    provider && provider.capabilities.library.read
      ? area('Library list', 'test-run-library', [
          field("Kind ('track', 'album', 'artist' or 'playlist')", libraryKind, setLibraryKind, 'test-library-kind'),
          field('Page', libraryPage, setLibraryPage, 'test-library-page', '1'),
        ], () => trace.run({ kind: 'library', list: (libraryKind.trim() || 'playlist') as 'playlist', ...(pageOf(libraryPage) ? { page: pageOf(libraryPage) } : {}) }), false)
      : null,
    provider
      ? area('Stream', 'test-run-stream', [
          field('Track id', streamId, setStreamId, 'test-stream-id'),
        ], () => trace.run({ kind: 'stream', id: streamId.trim() }), !streamId.trim())
      : null,

    area('HTTP request — through this source\'s own client', 'test-run-http', [
      h(
        native.View as never,
        { key: 'method', style: { flexDirection: 'row', gap: tokens.space[2] } },
        h(Button, {
          variant: method === 'GET' ? 'secondary' : 'ghost',
          onPress: () => setMethod('GET'),
          testID: 'test-method-get',
          children: 'GET',
        }),
        h(Button, {
          variant: method === 'POST' ? 'secondary' : 'ghost',
          onPress: () => setMethod('POST'),
          testID: 'test-method-post',
          children: 'POST',
        }),
      ),
      field('URL', url, setUrl, 'test-url', 'https://…'),
      field('Headers (JSON, optional)', headersJson, setHeadersJson, 'test-headers', '{ "User-Agent": "…" }'),
      ...(method === 'POST' ? [field('Body', body, setBody, 'test-body')] : []),
    ], runHttp, !url.trim()),

    area('Script — the document\'s functions are in scope', 'test-run-js', [
      field('Code', code, setCode, 'test-code', "return getBiliArtist('9469745')"),
      field('Arguments (JSON — its keys become variables)', argsJson, setArgsJson, 'test-args', '{ "key": "test" }'),
    ], runJs, !code.trim()),

    requestError ? h(Text, { variant: 'sm', tone: 'muted' }, requestError) : null,
    h(TraceList, { events: trace.events, running: trace.running }),
  )
}

export const name = 'plugin-sources-ui-mobile'

/**
 * Bind a screen to *this* plugin's context, not the shell's.
 *
 * ⚠️ The shell renders a view as `h(Component, { ctx })` with **its own**
 * context — the one it got from `app.ready(['ui'])`, which has `ui` injected
 * and nothing else. A cordis context throws for any property that was not
 * injected, so a screen reading `ctx.sources` through its hooks threw
 * `cannot get property "sources" without inject` on a device while every
 * test passed, because tests built a root context where that read answers
 * `undefined` instead.
 *
 * Registering a closure over the context this plugin was applied with is the
 * fix, and it is what every view package here does: the screen runs on a
 * context with exactly what this package's `inject` declares. The shell's
 * props are still forwarded, so a view that takes more than `ctx` keeps
 * working.
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  // `h(Screen, …)`, not `Screen(…)`: calling a component as a function splices
  // its hooks into this one's list, which works right up until someone renders
  // it conditionally. An element keeps them separate.
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export const inject = ['ui', 'sources']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-sources-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(SOURCES_VIEWS.search, bound(ctx, SearchScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceList, bound(ctx, SourcesListScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
