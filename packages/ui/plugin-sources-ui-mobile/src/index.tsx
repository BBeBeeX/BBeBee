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
import type { DownloadsService, I18nService, ImportReport, TraceEvent, UiService } from '@BBeBee/protocol'
import { ALBUM_VIEWS } from '@BBeBee/plugin-album/views'
import { SOURCES_VIEWS } from '@BBeBee/plugin-sources/views'
import {
  playFromList,
  searchResultRows,
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
  JsonTree,
  List,
  Text,
  TextField,
  TrackRow,
  nativePrimitives,
  useI18n,
} from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/ui-core'
import type { ArtworkProps, TrackRowProps } from '@BBeBee/ui-core'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { useTrackMenu } from '@BBeBee/ui-menus'
import { palettes, tokens } from '@BBeBee/ui-tokens'

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
  const { t } = useI18n(ctx)
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
      accessibilityLabel: t('sources:search.search'),
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
        placeholder: t('sources:index.songsAlbumsArtists'),
        accessibilityLabel: t('sources:search.searchQuery'),
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
          children: t('sources:search.search'),
        }),
        submitted
          ? h(Button, { variant: 'ghost', onPress: clear, testID: 'search-clear', children: t('app:common.clear') })
          : null,
      ),
      h(
        native.View as never,
        {
          accessibilityRole: 'group',
          accessibilityLabel: t('sources:search.sourcesAndInterfacesToSearch'),
          style: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: tokens.space[1] },
        },
        // One toggle per *interface*, not per source: a backend whose user
        // search is a separate endpoint offers songs and artists as two
        // independently searchable things. See the desktop twin.
        ...selection.interfaces.map((iface) =>
          h(SourceChip, {
            key: iface.id,
            label: `${iface.sourceName} · ${t(iface.kind === 'track' ? 'sources:index.songs' : 'sources:index.artists')}`,
            selected: selection.isInterfaceSelected(iface.id),
            disabled: !iface.searchable,
            onPress: () => selection.toggleInterface(iface.id),
            accessibilityLabel: `${t(selection.isInterfaceSelected(iface.id) ? 'sources:index.doNotSearch' : 'sources:search.search')} ${iface.sourceName} ${t(iface.kind === 'track' ? 'sources:index.songs' : 'sources:index.artists')}`,
            testID: `search-source-${iface.sourceId}-${iface.kind}`,
          }),
        ),
        selection.interfaces.some((iface) => iface.searchable)
          ? h(SourceChip, {
              label: selection.allSelected ? t('sources:index.none') : t('sources:index.all'),
              selected: false,
              onPress: selection.toggleAll,
              accessibilityLabel: selection.allSelected ? t('sources:index.deselectEverySource') : t('sources:index.selectEverySource'),
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
            title: t('sources:search.searchFailed'),
            description: search.error.message,
            action: h(Button, {
              variant: 'secondary',
              onPress: () =>
                search.run(search.text, {
                  sourceIds: selection.selectedIds,
                  typesBySource: selection.typesBySource,
                }),
              children: t('sources:search.tryAgain'),
            }),
          })
        : busy
          ? h(EmptyState, {
              title: t('sources:index.searchingFor', { text: search.text }),
              description: t('sources:index.waitingForEverySelectedSource'),
            })
          : h(
              native.View as never,
              { style: { flex: 1, minHeight: 0 } },
              h(List<SearchResultRow>, {
                items: rows,
                accessibilityLabel: t('sources:search.searchResults'),
                estimatedItemSize: tokens.size.row,
                keyExtractor: (row) => row.key,
                empty: h(EmptyState, {
                  icon: '🔎',
                  title: t('sources:index.nothingFound'),
                  description: t('sources:index.noSelectedSourceHadA'),
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
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, t('sources:import.importASource')),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      t('sources:import.pasteInstructions'),
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 10,
      placeholder: t('sources:index.sourceUrlHttpsSourceName'),
      accessibilityLabel: t('sources:import.sourceStringLabel'),
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          native.View as never,
          {
            accessibilityLabel: t('sources:import.whatWillBeImported'),
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
            state.preview.count === 1
              ? t('sources:index.previewOne', { count: state.preview.count })
              : t('sources:index.previewOther', { count: state.preview.count }),
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
        children: t('sources:import.importButton'),
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: t('app:common.clear'),
      }),
    ),
    state.report ? h(Text, { variant: 'sm', tone: 'muted' }, summariseImport(state.report, t)) : null,
  )
}

/** What an import did, in a sentence. Never empty — see the desktop twin. */
function summariseImport(report: ImportReport, t: I18nService['t']): string {
  const parts: string[] = []
  if (report.added.length) parts.push(t('sources:import.summaryAdded', { count: report.added.length }))
  if (report.updated.length) parts.push(t('sources:import.summaryUpdated', { count: report.updated.length }))
  if (report.unchanged.length) parts.push(t('sources:import.summaryUnchanged', { count: report.unchanged.length }))
  if (report.rejected.length) parts.push(t('sources:import.summaryRejected', { count: report.rejected.length }))
  return parts.length > 0 ? parts.join(', ') : t('sources:import.summaryNothing')
}

/** Every step, including the ones that worked. See the desktop twin. */
function TraceList({
  events,
  running,
  t,
}: {
  events: readonly TraceEvent[]
  running: boolean
  t: I18nService['t']
}): ReactElement {
  const native = nativePrimitives()
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? t('sources:test.running') : t('sources:test.noTraceYet'),
      description: running ? undefined : t('sources:test.traceStepHintMobile'),
    })
  }
  return h(
    native.View as never,
    { accessibilityLabel: t('sources:test.trace'), style: { gap: tokens.space[1] } },
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
        event.kind === 'value' ? valueBlock(event) : h(Text, { variant: 'sm' }, traceLine(t, event)),
      ),
    ),
  )
}

/** One event as text. Redacted upstream; this only lays it out. */
function traceLine(t: I18nService['t'], event: TraceEvent): string {
  switch (event.kind) {
    case 'http':
      return event.status === 0
        ? t('sources:test.httpNoResponse', { method: event.method, url: event.url, ms: event.ms })
        : t('sources:test.httpWithStatus', { method: event.method, url: event.url, status: event.status, ms: event.ms })
    case 'error':
      return event.block
        ? t('sources:test.errorWithBlock', { block: event.block, field: event.field ?? '', message: event.message })
        : t('sources:test.errorSimple', { message: event.message })
    case 'result':
      return t('sources:test.resultLine', { summary: event.summary })
    case 'log':
      return t('sources:test.logLine', { message: event.message })
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
  const { t } = useI18n(ctx)
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
          setRequestError(t('sources:test.headersMustBeObject'))
          return
        }
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      } catch (error) {
        setRequestError(t('sources:test.headersNotValidJson', { message: error instanceof Error ? error.message : String(error) }))
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
      h(Text, { variant: 'lg' }, t('sources:test.testASource')),
      h(EmptyState, {
        title: t('sources:sourcesList.noSourcesYet'),
        description: t('sources:test.importASourceStringFirst'),
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
        children: t('sources:test.run'),
      }),
    )

  return h(
    native.View as never,
    { style: { flex: 1, padding: tokens.space[4], gap: tokens.space[4] } },
    h(Text, { variant: 'lg' }, t('sources:test.testASource')),

    h(Button, {
      onPress: () => setPickerOpen(!pickerOpen),
      testID: 'test-source-select',
      children: `${selected?.name ?? t('sources:test.pickASource')} ▾`,
    }),
    pickerOpen
      ? h(
          native.View as never,
          { accessibilityLabel: t('sources:test.sourceToTest'), style: { gap: tokens.space[1] } },
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
          t('sources:test.sourceNotActive'),
        )
      : null,
    provider && provider.capabilities.search.tracks
      ? area(t('sources:search.search'), 'test-run-search', [
          field(t('sources:test.fieldKeyword'), searchText, setSearchText, 'test-search-text'),
          field(t('sources:test.fieldPage'), searchPage, setSearchPage, 'test-search-page', '1'),
        ], () => trace.run({ kind: 'search', text: searchText, ...(pageOf(searchPage) ? { page: pageOf(searchPage) } : {}) }), !searchText.trim())
      : null,
    provider && provider.capabilities.browse
      ? area(t('sources:test.areaBrowse'), 'test-run-browse', [
          field(t('sources:test.fieldBrowseNode'), browseNode, setBrowseNode, 'test-browse-node'),
          field(t('sources:test.fieldPage'), browsePage, setBrowsePage, 'test-browse-page', '1'),
        ], () => trace.run({ kind: 'browse', ...(browseNode.trim() ? { nodeId: browseNode.trim() } : {}), ...(pageOf(browsePage) ? { page: pageOf(browsePage) } : {}) }), false)
      : null,
    provider && typeof provider.getAlbum === 'function'
      ? area(t('sources:test.areaAlbum'), 'test-run-album', [
          field(t('sources:test.fieldAlbumId'), albumId, setAlbumId, 'test-album-id'),
        ], () => trace.run({ kind: 'album', id: albumId.trim() }), !albumId.trim())
      : null,
    provider && typeof provider.getArtist === 'function'
      ? area(t('sources:search.artist'), 'test-run-artist', [
          field(t('sources:test.fieldArtistId'), artistId, setArtistId, 'test-artist-id'),
        ], () => trace.run({ kind: 'artist', id: artistId.trim() }), !artistId.trim())
      : null,
    provider && typeof provider.getPlaylist === 'function'
      ? area(t('sources:test.areaPlaylist'), 'test-run-playlist', [
          field(t('sources:test.fieldPlaylistId'), playlistId, setPlaylistId, 'test-playlist-id'),
          field(t('sources:test.fieldPage'), playlistPage, setPlaylistPage, 'test-playlist-page', '1'),
        ], () => trace.run({ kind: 'playlist', id: playlistId.trim(), ...(pageOf(playlistPage) ? { page: pageOf(playlistPage) } : {}) }), !playlistId.trim())
      : null,
    provider && typeof provider.getLyrics === 'function'
      ? area(t('sources:test.areaLyrics'), 'test-run-lyrics', [
          field(t('sources:test.fieldTrackId'), lyricsId, setLyricsId, 'test-lyrics-id'),
        ], () => trace.run({ kind: 'lyrics', id: lyricsId.trim() }), !lyricsId.trim())
      : null,
    provider && provider.capabilities.library.read
      ? area(t('sources:test.areaLibraryList'), 'test-run-library', [
          field(t('sources:test.fieldLibraryKind'), libraryKind, setLibraryKind, 'test-library-kind'),
          field(t('sources:test.fieldPage'), libraryPage, setLibraryPage, 'test-library-page', '1'),
        ], () => trace.run({ kind: 'library', list: (libraryKind.trim() || 'playlist') as 'playlist', ...(pageOf(libraryPage) ? { page: pageOf(libraryPage) } : {}) }), false)
      : null,
    provider
      ? area(t('sources:test.areaStream'), 'test-run-stream', [
          field(t('sources:test.fieldTrackId'), streamId, setStreamId, 'test-stream-id'),
        ], () => trace.run({ kind: 'stream', id: streamId.trim() }), !streamId.trim())
      : null,

    area(t('sources:test.areaHttp'), 'test-run-http', [
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
      field(t('sources:test.fieldUrl'), url, setUrl, 'test-url', 'https://…'),
      field(t('sources:test.fieldHeaders'), headersJson, setHeadersJson, 'test-headers', '{ "User-Agent": "…" }'),
      ...(method === 'POST' ? [field(t('sources:test.fieldBody'), body, setBody, 'test-body')] : []),
    ], runHttp, !url.trim()),

    area(t('sources:test.areaScript'), 'test-run-js', [
      field(t('sources:test.fieldCode'), code, setCode, 'test-code', "return getBiliArtist('9469745')"),
      field(t('sources:test.fieldArgs'), argsJson, setArgsJson, 'test-args', '{ "key": "test" }'),
    ], runJs, !code.trim()),

    requestError ? h(Text, { variant: 'sm', tone: 'muted' }, requestError) : null,
    h(TraceList, { events: trace.events, running: trace.running, t }),
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
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceImport, bound(ctx, ImportScreen))
    yield ctx.ui.registerView(SOURCES_VIEWS.sourceTest, bound(ctx, TestScreen))
  }, 'sources-ui-mobile')
}

export default { name, inject, apply }
