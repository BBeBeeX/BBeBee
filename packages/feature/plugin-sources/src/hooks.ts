/**
 * View hooks for `ctx.sources`.
 *
 * Written once here and consumed by both shells (docs/08 4). Catalogue reads
 * are asynchronous and paged, so these are the one place where "loading",
 * "empty" and "failed" are distinguished — a view that conflates them shows a
 * blank pane and tells the user nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'
import { SourceFormatError } from '@BBeBee/protocol'
import type {
  AggregatedSearch,
  AggregatedSearchEntry,
  Album,

  Artist,
  BrowseEntry,
  CatalogQuery,
  DebugStep,
  ImportReport,
  MediaProvider,
  Paged,
  PlayerService,
  Playlist,
  QueueSourceContext,
  ScanSpecifiedDir,
  ScannerService,
  SourceRecord,
  SourcesService,
  Track,
  TraceEvent,
} from '@BBeBee/protocol'
import { canSearchProvider } from './capabilities.js'
import { parseSourceInput } from './identity.js'
import { serviceOf, useServiceState, shallowArrayEqual, type AsyncState } from '@BBeBee/ui-core'

/**
 * A paged catalogue read, as a view needs it.
 *
 * Not a data-fetching library: no cache, no revalidation, no retries. It runs
 * the query, tracks the three states a screen must distinguish, and reloads on
 * `library/changed` — which is what makes a scan appear as it progresses
 * rather than after it finishes.
 */
export interface PagedState<T> extends AsyncState<Paged<T>> {
  /** Everything loaded so far, across pages. */
  items: readonly T[]
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

function usePagedRead<T>(
  ctx: Context,
  read: (query: CatalogQuery) => Promise<Paged<T>>,
  query: CatalogQuery,
  key: string,
): PagedState<T> {
  const [state, setState] = useState<AsyncState<Paged<T>>>({ status: 'idle' })
  const [items, setItems] = useState<readonly T[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [generation, setGeneration] = useState(0)
  /** Which read is allowed to write. See `run`. */
  const inFlight = useRef(0)

  const run = useCallback(
    (from: string | undefined, append: boolean) => {
      let cancelled = false
      /*
       * ⚠️ A generation, not just the per-call `cancelled` flag.
       *
       * `loadMore` fires again before the previous page lands — a fast scroll,
       * or a `library/changed` reload racing a scroll — and both responses
       * appended. The list grew a duplicate page *and* the cursor went
       * backwards to whichever answer arrived last, so the next `loadMore`
       * re-fetched a page the user had already seen. Only the newest request
       * is allowed to write.
       */
      const mine = ++inFlight.current
      setState((prev) => ({ ...prev, status: 'loading' }))
      read({ ...query, page: from ? { cursor: from } : undefined })
        .then((page) => {
          if (cancelled || inFlight.current !== mine) return
          setItems((prev) => (append ? [...prev, ...page.items] : page.items))
          setCursor(page.cursor)
          setState({ status: 'ready', data: page })
        })
        .catch((error: unknown) => {
          if (cancelled || inFlight.current !== mine) return
          // Surfaced, never swallowed: a catalogue read that fails silently
          // looks identical to an empty library.
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        })
      return () => void (cancelled = true)
    },
    // `query` is an object literal at nearly every call site; `key` is how a
    // caller says its contents changed.
    [read, key],
  )

  useEffect(() => run(undefined, false), [run, generation])

  // A scan writes rows as it goes, so the library fills in rather than
  // appearing all at once when the walk finishes.
  useEffect(() => {
    const off = ctx.on('library/changed', () => setGeneration((n) => n + 1))
    return () => void off()
  }, [ctx])

  return {
    ...state,
    items,
    hasMore: state.data?.hasMore ?? false,
    loadMore: () => {
      if (cursor && state.status !== 'loading') run(cursor, true)
    },
    reload: () => setGeneration((n) => n + 1),
  }
}

export function useTracks(ctx: Context, query: CatalogQuery = {}): PagedState<Track> {
  const read = useCallback((q: CatalogQuery) => ctx.sources.listTracks(q), [ctx])
  return usePagedRead(ctx, read, query, JSON.stringify(query))
}

export function useAlbums(ctx: Context, query: CatalogQuery = {}): PagedState<Album> {
  const read = useCallback((q: CatalogQuery) => ctx.sources.listAlbums(q), [ctx])
  return usePagedRead(ctx, read, query, JSON.stringify(query))
}

/** The imported sources, for the source list (docs/08 4). */
export function useSources(ctx: Context): readonly SourceRecord[] {
  return useServiceState(
    ctx,
    ['source/imported', 'source/changed', 'source/removed', 'source/registered', 'source/unregistered'],
    () => serviceOf<SourcesService>(ctx, 'sources')?.sources ?? [],
    { isEqual: shallowArrayEqual },
  )
}

/**
 * Which sources are live right now.
 *
 * Distinct from `useSources`: a row can be imported and enabled but not yet
 * registered, and the difference is what a "starting…" state is made of.
 */
export function useLiveSourceIds(ctx: Context): readonly string[] {
  return useServiceState(
    ctx,
    ['source/registered', 'source/unregistered'],
    () => serviceOf<SourcesService>(ctx, 'sources')?.providers?.map((p) => p.sourceId) ?? [],
    { isEqual: shallowArrayEqual },
  )
}

/* ── this device's folders, where the source list shows them ─────────────── */

/** Shared so the absent-scanner snapshot is referentially stable. */
const NO_FOLDERS: readonly ScanSpecifiedDir[] = []

/**
 * Whether a source row is the scanner's local-files row.
 *
 * The row is not an imported document — the scanner writes it so the catalogue
 * has a source to key on — so the source list shows its **folders** rather than
 * import/delete controls that would not mean anything for files on disk.
 */
export function isLocalSource(record: SourceRecord): boolean {
  return record.sourceUrl.startsWith('bbebee://local/')
}

/**
 * The scanner's folders, for the local source's row.
 *
 * `ctx.scanner` is optional here: the source-list view package does not inject
 * it, and a build without the scanner still lists remote sources. `serviceOf`
 * is the read that answers `undefined` instead of throwing on a scoped
 * context, which is exactly the may-be-absent case `docs/08 §3` asks views to
 * handle.
 */
export function useLocalFolders(ctx: Context): readonly ScanSpecifiedDir[] {
  return useServiceState(
    ctx,
    ['scan/specified-dirs-changed'],
    () => serviceOf<ScannerService>(ctx, 'scanner')?.specifiedDirs ?? NO_FOLDERS,
    { isEqual: shallowArrayEqual },
  )
}

/* ── importing, editing and diagnosing (docs/06 §9, §10) ────────────────── */

/** What the import screen shows while and after a paste. */
export interface ImportState {
  text: string
  setText(next: string): void
  /** Non-blocking: what a paste *would* import, shown before committing. */
  preview: { count: number; names: string[] } | undefined
  /** Per-entry problems, from the last attempt. Every one of them, not the first. */
  issues: readonly { path: string; message: string }[]
  busy: boolean
  report: ImportReport | undefined
  submit(): void
  reset(): void
}

/**
 * Pasting a source string.
 *
 * The preview is the point. A user pasting a set from a forum has no way to
 * know what is in it, and an import that silently adds eleven sources is one
 * they cannot undo without knowing which eleven. So the string is parsed as
 * they type — cheap, local, no network — and the names are shown before
 * anything is written.
 */
export function useSourceImport(ctx: Context): ImportState {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | undefined>(undefined)
  const [issues, setIssues] = useState<readonly { path: string; message: string }[]>([])

  const preview = useMemo(() => {
    if (!text.trim()) return undefined
    try {
      const entries = parseSourceInput(text)
      return {
        count: entries.length,
        // The name off the parsed value, falling back to the URL: a document
        // with neither is one import will reject anyway, and a preview row
        // reading "undefined" helps nobody decide whether to go ahead.
        names: entries.map((entry) => nameOf(entry.value)),
      }
    } catch {
      // A half-typed paste is not an error yet. Problems are reported on
      // submit, where the user has said they are finished.
      return undefined
    }
  }, [text])

  const submit = useCallback(() => {
    if (!text.trim() || busy) return
    setBusy(true)
    setIssues([])
    void ctx.sources
      .import(text)
      .then((result) => {
        setReport(result)
        /*
         * ⚠️ A rejected entry arrives *in the report*, not as a throw: one
         * malformed document never rejects the rest of a set (docs/06 §9). So
         * a paste whose only document is bad resolves successfully with an
         * empty `added` — and a screen reading only the `catch` would show
         * nothing at all and look like the button did not work.
         */
        setIssues(
          result.rejected.flatMap((entry) =>
            entry.error.issues.length > 0
              ? entry.error.issues
              : [{ path: entry.sourceName ?? `entry ${entry.index}`, message: entry.error.message }],
          ),
        )
        // Cleared only on what actually landed, so a failed paste is still
        // there to fix rather than lost to a screen that emptied itself.
        if (result.added.length > 0 || result.updated.length > 0) setText('')
      })
      .catch((error: unknown) => {
        setIssues(
          error instanceof SourceFormatError && error.issues.length > 0
            ? error.issues
            : [{ path: '', message: error instanceof Error ? error.message : String(error) }],
        )
      })
      .finally(() => setBusy(false))
  }, [ctx, text, busy])

  const reset = useCallback(() => {
    setText('')
    setIssues([])
    setReport(undefined)
  }, [])

  return { text, setText, preview, issues, busy, report, submit, reset }
}

/** A running or finished trace. */
export interface TraceState {
  events: readonly TraceEvent[]
  running: boolean
  run(step: DebugStep): void
  clear(): void
}

/**
 * The step tracer, as a screen consumes it.
 *
 * Events are appended as they arrive rather than collected: a request to a
 * server that has stopped answering shows as a line with no status and nothing
 * after it, which *is* the diagnosis. Waiting for the run to finish would show
 * nothing at all until it gave up (docs/06 §10).
 */
export function useSourceTrace(ctx: Context, sourceId: string | undefined): TraceState {
  const [events, setEvents] = useState<readonly TraceEvent[]>([])
  const [running, setRunning] = useState(false)
  // Bumped on every run, so a trace still streaming into a screen the user has
  // moved on from stops appending instead of interleaving with the new one.
  const generation = useRef(0)

  const run = useCallback(
    (step: DebugStep) => {
      if (!sourceId) return
      const mine = ++generation.current
      setEvents([])
      setRunning(true)
      void (async () => {
        try {
          for await (const event of ctx.sources.debug(sourceId, step)) {
            if (generation.current !== mine) return
            setEvents((prev) => [...prev, event])
          }
        } finally {
          if (generation.current === mine) setRunning(false)
        }
      })()
    },
    [ctx, sourceId],
  )

  const clear = useCallback(() => {
    generation.current++
    setEvents([])
    setRunning(false)
  }, [])

  useEffect(() => clear, [clear])

  return { events, running, run, clear }
}

export function useSetLoved(ctx: Context): (urn: string, loved: boolean) => Promise<void> {
  return useCallback((urn: string, loved: boolean) => ctx.sources.setLoved(urn, loved), [ctx])
}

/* ── searching across sources (docs/06 §4.1) ────────────────────────────── */

/** The searchable halves of a source. Each one gets its own toggle. */
export type SearchInterfaceKind = 'track' | 'artist'

/**
 * One interface a source offers: its song search or its artist search.
 *
 * The search screen draws one toggle per interface, so a source with both —
 * which is the common case for a backend that splits user search from content
 * search — can be asked for songs without being asked for artists, and vice
 * versa. The key is namespaced by source so two sources' `track` interfaces
 * cannot collide.
 */
export interface SearchInterfaceOption {
  /** `${sourceId}:${kind}` — unique, stable, and safe as a list key. */
  id: string
  sourceId: string
  sourceName: string
  kind: SearchInterfaceKind
  searchable: boolean
}

/**
 * One source the search screen can offer, and the interfaces it exposes.
 *
 * A row is imported and enabled long before its provider is registered — a
 * source runtime that never loaded, or one whose document failed to build,
 * leaves an enabled row with no provider. That is `searchable: false`, and it
 * is shown as a disabled toggle rather than omitted: the source is the user's,
 * and a silent absence reads as data loss.
 */
export interface SearchSourceOption {
  id: string
  name: string
  /** True when at least one interface can answer today. */
  searchable: boolean
  interfaces: readonly SearchInterfaceOption[]
}

/**
 * The sources a search could ask, expanded into their interfaces.
 *
 * Providers rather than records decide `searchable`, because capability is
 * derived from each live provider's rules — a `SourceRecord` only says the row
 * exists. A record with no live provider still yields one disabled track
 * interface, so it stays visible and says why it cannot be chosen.
 */
export function useSearchSourceOptions(ctx: Context): readonly SearchSourceOption[] {
  const records = useSources(ctx)
  const providers = useServiceState<readonly MediaProvider[]>(
    ctx,
    ['source/registered', 'source/unregistered'],
    () => serviceOf<SourcesService>(ctx, 'sources')?.providers ?? [],
    { isEqual: shallowArrayEqual },
  )
  return useMemo(
    () =>
      records.map((record) => {
        const provider = providers.find((p) => p.sourceId === record.id)
        const live = record.enabled && canSearchProvider(provider) ? provider : undefined
        const tracks = live?.capabilities.search.tracks ?? false
        const artists = live?.capabilities.search.artists ?? false

        const interfaces: SearchInterfaceOption[] = []
        if (tracks) {
          interfaces.push({
            id: `${record.id}:track`,
            sourceId: record.id,
            sourceName: record.name,
            kind: 'track',
            searchable: true,
          })
        }
        if (artists) {
          interfaces.push({
            id: `${record.id}:artist`,
            sourceId: record.id,
            sourceName: record.name,
            kind: 'artist',
            searchable: true,
          })
        }
        if (interfaces.length === 0) {
          // Imported and enabled, but not answering: one disabled row beats a
          // source that silently is not there.
          interfaces.push({
            id: `${record.id}:track`,
            sourceId: record.id,
            sourceName: record.name,
            kind: 'track',
            searchable: false,
          })
        }

        return { id: record.id, name: record.name, searchable: tracks || artists, interfaces }
      }),
    [records, providers],
  )
}

/** Which interfaces the user has chosen to search. */
export interface SearchSourceSelection {
  options: readonly SearchSourceOption[]
  /** Every interface of every source, in display order. */
  interfaces: readonly SearchInterfaceOption[]
  /** Sources with at least one interface selected. */
  selectedIds: readonly string[]
  /** The selected halves, per source — what `searchAll` gets. */
  typesBySource: Readonly<Record<string, readonly SearchInterfaceKind[]>>
  isInterfaceSelected(id: string): boolean
  toggleInterface(id: string): void
  allSelected: boolean
  toggleAll(): void
}

/**
 * The toggle row's state.
 *
 * Stored as *exclusions* rather than inclusions, so every interface the user
 * imports is searched by default and a source added later joins the selection
 * instead of silently being left out. Toggling records only what the user
 * turned off, which cannot go stale when the source list changes underneath.
 */
export const SEARCH_SOURCES_EXCLUDED_STORAGE_KEY = 'bbebee_search_sources_excluded'

function loadExcludedFromStorage(): ReadonlySet<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set()
  try {
    const raw = window.localStorage.getItem(SEARCH_SOURCES_EXCLUDED_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((item): item is string => typeof item === 'string'))
      }
    }
  } catch {
    // Ignore storage errors
  }
  return new Set()
}

function saveExcludedToStorage(excluded: ReadonlySet<string>): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(SEARCH_SOURCES_EXCLUDED_STORAGE_KEY, JSON.stringify([...excluded]))
  } catch {
    // Ignore storage errors
  }
}

let memoryExcluded: ReadonlySet<string> = loadExcludedFromStorage()
const excludedListeners = new Set<() => void>()

function updateExcluded(next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)): void {
  const resolved = typeof next === 'function' ? next(memoryExcluded) : next
  memoryExcluded = resolved
  saveExcludedToStorage(resolved)
  for (const listener of excludedListeners) {
    listener()
  }
}

function subscribeExcluded(listener: () => void): () => void {
  excludedListeners.add(listener)
  return () => {
    excludedListeners.delete(listener)
  }
}

function getExcludedSnapshot(): ReadonlySet<string> {
  return memoryExcluded
}

/** Reset helper for testing or storage clearing. */
export function resetSearchSourceSelection(next?: ReadonlySet<string>): void {
  updateExcluded(next ?? loadExcludedFromStorage())
}

export function useSearchSourceSelection(ctx: Context): SearchSourceSelection {
  const options = useSearchSourceOptions(ctx)
  const excluded = useSyncExternalStore(subscribeExcluded, getExcludedSnapshot, getExcludedSnapshot)

  const interfaces = useMemo(() => options.flatMap((option) => option.interfaces), [options])
  const searchable = useMemo(() => interfaces.filter((iface) => iface.searchable), [interfaces])
  const isInterfaceSelected = useCallback(
    (id: string) => !excluded.has(id) && searchable.some((iface) => iface.id === id),
    [excluded, searchable],
  )

  const selectedIds = useMemo(
    () =>
      options
        .filter((option) => option.interfaces.some((iface) => isInterfaceSelected(iface.id)))
        .map((option) => option.id),
    [options, isInterfaceSelected],
  )

  const typesBySource = useMemo(() => {
    const out: Record<string, SearchInterfaceKind[]> = {}
    for (const option of options) {
      const kinds = option.interfaces
        .filter((iface) => isInterfaceSelected(iface.id))
        .map((iface) => iface.kind)
      if (kinds.length > 0) out[option.id] = kinds
    }
    return out
  }, [options, isInterfaceSelected])

  const allSelected = searchable.length > 0 && searchable.every((iface) => !excluded.has(iface.id))

  const toggleInterface = useCallback((id: string) => {
    updateExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    updateExcluded(allSelected ? new Set(searchable.map((iface) => iface.id)) : new Set())
  }, [allSelected, searchable])

  return {
    options,
    interfaces,
    selectedIds,
    typesBySource,
    isInterfaceSelected,
    toggleInterface,
    allSelected,
    toggleAll,
  }
}

/** Pagination state for a single source. */
export interface SourcePaginationState {
  loading: boolean
  hasMore: boolean
  cursor?: string
  error?: Error
}

/** A fan-out search: the answer, or the reason there is none. */
export interface SourceSearchState extends AsyncState<AggregatedSearch> {
  /** The text the visible answer belongs to. */
  text: string
  /** Per-source pagination states: { [sourceId]: { loading, hasMore, cursor, error } } */
  pagination: Readonly<Record<string, SourcePaginationState>>
  run(
    text: string,
    opts?: {
      sourceIds?: readonly string[]
      typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
    },
  ): void
  loadMore(sourceId: string): Promise<void>
  reset(): void
}

function mergePaged<T>(oldPaged?: Paged<T>, newPaged?: Paged<T>): Paged<T> | undefined {
  if (!oldPaged && !newPaged) return undefined
  return {
    items: [...(oldPaged?.items ?? []), ...(newPaged?.items ?? [])],
    hasMore: newPaged?.hasMore ?? false,
    cursor: newPaged?.cursor,
    total: newPaged?.total ?? oldPaged?.total,
  }
}

/**
 * `searchAll`, as a screen consumes it.
 *
 * Per-source results and per-source errors, never a merged list: the section
 * for a source that timed out says so. A generation guards the write so a
 * second search started while the first is still out cannot have its results
 * overwritten by the first one finishing late.
 */
export function useSourceSearch(ctx: Context): SourceSearchState {
  const [state, setState] = useState<AsyncState<AggregatedSearch>>({ status: 'idle' })
  const [text, setText] = useState('')
  const [pagination, setPagination] = useState<Readonly<Record<string, SourcePaginationState>>>({})
  const generation = useRef(0)
  const lastOptsRef = useRef<{
    sourceIds?: readonly string[]
    typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
  }>({})

  const run = useCallback(
    (
      next: string,
      opts: {
        sourceIds?: readonly string[]
        typesBySource?: Readonly<Record<string, readonly SearchInterfaceKind[]>>
      } = {},
    ) => {
      const query = next.trim()
      if (!query) return
      const mine = ++generation.current
      lastOptsRef.current = opts
      setText(query)
      setState({ status: 'loading' })
      setPagination({})
      const typesBySource = opts.typesBySource
        ? Object.fromEntries(
            Object.entries(opts.typesBySource).map(([id, kinds]) => [id, [...kinds]]),
          )
        : undefined
      void ctx.sources
        .searchAll(
          { text: query },
          {
            ...(opts.sourceIds ? { sourceIds: [...opts.sourceIds] } : {}),
            ...(typesBySource ? { typesBySource } : {}),
          },
        )
        .then((result) => {
          if (generation.current !== mine) return
          const pagMap: Record<string, SourcePaginationState> = {}
          for (const entry of result.bySource) {
            const tHasMore = entry.result?.tracks?.hasMore ?? false
            const aHasMore = entry.result?.albums?.hasMore ?? false
            const arHasMore = entry.result?.artists?.hasMore ?? false
            const pHasMore = entry.result?.playlists?.hasMore ?? false
            const hasMore = tHasMore || aHasMore || arHasMore || pHasMore
            const cursor =
              entry.result?.tracks?.cursor ??
              entry.result?.albums?.cursor ??
              entry.result?.artists?.cursor ??
              entry.result?.playlists?.cursor
            pagMap[entry.sourceId] = { loading: false, hasMore, cursor }
          }
          setPagination(pagMap)
          setState({ status: 'ready', data: result })
        })
        .catch((error: unknown) => {
          if (generation.current !== mine) return
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        })
    },
    [ctx],
  )

  const loadMore = useCallback(
    async (sourceId: string) => {
      const currentPag = pagination[sourceId]
      if (!text.trim() || !currentPag || currentPag.loading || !currentPag.hasMore) return
      const mine = generation.current

      setPagination((prev) => ({
        ...prev,
        [sourceId]: { ...prev[sourceId], loading: true, error: undefined },
      }))

      const types = lastOptsRef.current?.typesBySource?.[sourceId]
      try {
        const entry = await ctx.sources.searchSource(
          sourceId,
          { text },
          currentPag.cursor ? { cursor: currentPag.cursor } : undefined,
          types ? { types: [...types] } : undefined,
        )
        if (generation.current !== mine) return

        if (entry.error) {
          setPagination((prev) => ({
            ...prev,
            [sourceId]: { ...prev[sourceId], loading: false, error: entry.error },
          }))
          return
        }

        if (entry.result) {
          const nextResult = entry.result
          const tHasMore = nextResult.tracks?.hasMore ?? false
          const aHasMore = nextResult.albums?.hasMore ?? false
          const arHasMore = nextResult.artists?.hasMore ?? false
          const pHasMore = nextResult.playlists?.hasMore ?? false
          const newHasMore = tHasMore || aHasMore || arHasMore || pHasMore
          const newCursor =
            nextResult.tracks?.cursor ??
            nextResult.albums?.cursor ??
            nextResult.artists?.cursor ??
            nextResult.playlists?.cursor

          setPagination((prev) => ({
            ...prev,
            [sourceId]: {
              loading: false,
              hasMore: newHasMore,
              cursor: newCursor,
            },
          }))

          setState((prev) => {
            if (!prev.data) return prev
            const bySource = prev.data.bySource.map((oldEntry) => {
              if (oldEntry.sourceId !== sourceId) return oldEntry
              const oldResult = oldEntry.result
              return {
                ...oldEntry,
                tookMs: oldEntry.tookMs + entry.tookMs,
                result: {
                  ...oldResult,
                  tracks: mergePaged(oldResult?.tracks, nextResult.tracks),
                  albums: mergePaged(oldResult?.albums, nextResult.albums),
                  artists: mergePaged(oldResult?.artists, nextResult.artists),
                  playlists: mergePaged(oldResult?.playlists, nextResult.playlists),
                  payloads: { ...(oldResult?.payloads ?? {}), ...(nextResult.payloads ?? {}) },
                },
              }
            })
            return { ...prev, data: { bySource } }
          })
        } else {
          setPagination((prev) => ({
            ...prev,
            [sourceId]: { ...prev[sourceId], loading: false, hasMore: false },
          }))
        }
      } catch (err: unknown) {
        if (generation.current !== mine) return
        const error = err instanceof Error ? err : new Error(String(err))
        setPagination((prev) => ({
          ...prev,
          [sourceId]: { ...prev[sourceId], loading: false, error },
        }))
      }
    },
    [ctx, text, pagination],
  )

  const reset = useCallback(() => {
    generation.current++
    setText('')
    setPagination({})
    setState({ status: 'idle' })
  }, [])

  return { ...state, text, pagination, run, loadMore, reset }
}

/**
 * One row of the search results screen.
 *
 * Flat, because both shells render one virtualised list: a `List` per source
 * would nest scrollers, and a section header is just another row. Built here
 * rather than in each view so the two shells cannot draw different sections
 * for the same answer.
 */
export type SearchResultRow =
  | {
      kind: 'header'
      key: string
      sourceId: string
      name: string
      status: 'ready' | 'error' | 'pending'
      /** Human-readable: a count, "no matches", or why there is nothing. */
      detail: string
    }
  | {
      kind: 'track'
      key: string
      sourceId: string
      track: Track
      /** The list a tap plays the track in — this source's hits. */
      queue: readonly string[]
    }
  | { kind: 'album'; key: string; sourceId: string; album: Album }
  | { kind: 'artist'; key: string; sourceId: string; artist: Artist }
  | { kind: 'playlist'; key: string; sourceId: string; playlist: Playlist }

/**
 * Flatten an aggregated search into list rows.
 *
 * A source that failed, timed out or answered nothing still gets a header —
 * the whole reason `searchAll` does not merge: silence and "no matches" must
 * not look the same.
 */
export function searchResultRows(
  result: AggregatedSearch | undefined,
  nameOf: (sourceId: string) => string,
): SearchResultRow[] {
  if (!result) return []
  const rows: SearchResultRow[] = []

  for (const entry of result.bySource) {
    const sourceId = entry.sourceId
    rows.push({
      kind: 'header',
      key: `header:${sourceId}`,
      sourceId,
      name: nameOf(sourceId),
      status: entry.error ? 'error' : entry.pending ? 'pending' : 'ready',
      detail: searchEntryDetail(entry),
    })
    if (!entry.result) continue

    const trackUrns = entry.result.tracks?.items.map((track) => track.urn) ?? []
    for (const track of entry.result.tracks?.items ?? []) {
      rows.push({ kind: 'track', key: `track:${track.urn}`, sourceId, track, queue: trackUrns })
    }
    for (const album of entry.result.albums?.items ?? []) {
      rows.push({ kind: 'album', key: `album:${album.urn}`, sourceId, album })
    }
    for (const artist of entry.result.artists?.items ?? []) {
      rows.push({ kind: 'artist', key: `artist:${artist.urn}`, sourceId, artist })
    }
    for (const playlist of entry.result.playlists?.items ?? []) {
      rows.push({ kind: 'playlist', key: `playlist:${playlist.urn}`, sourceId, playlist })
    }
  }
  return rows
}

/** What a source's section header says when there is nothing to list. */
function searchEntryDetail(entry: AggregatedSearchEntry): string {
  if (entry.error) return entry.error.message
  if (entry.pending) return 'still searching…'
  const result = entry.result
  const parts: string[] = []
  addCount(parts, result?.tracks?.items.length, 'track')
  addCount(parts, result?.albums?.items.length, 'album')
  addCount(parts, result?.artists?.items.length, 'artist')
  addCount(parts, result?.playlists?.items.length, 'playlist')
  // A count of zero says the request succeeded and the backend has no match —
  // which is not the same answer as an error line, and not a blank section.
  const summary = parts.length > 0 ? parts.join(' · ') : 'no matches'
  return `${summary} · ${entry.tookMs} ms`
}

function addCount(parts: string[], count: number | undefined, noun: string): void {
  if (count) parts.push(`${count} ${noun}${count === 1 ? '' : 's'}`)
}

/* ── playing a tapped track with its surrounding list ───────────────────── */

/**
 * Every track matching `query`, across all pages.
 *
 * A view renders one page at a time, but "play this list" means the whole list
 * it stands for — the local library, the favourites — not just the rows that
 * have scrolled in so far.
 */
export async function listAllTracks(ctx: Context, query: CatalogQuery): Promise<readonly Track[]> {
  const items: Track[] = []
  let cursor: string | undefined
  do {
    const page = await ctx.sources.listTracks(cursor ? { ...query, page: { cursor } } : query)
    items.push(...page.items)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return items
}

/** What a tapped row's list is, in whichever shape the screen has it. */
export interface PlayFromList {
  /** The list as rows already at hand — an album detail, a playlist. */
  urns?: readonly string[]
  /** The list as a catalogue query, fetched in full at play time. */
  query?: CatalogQuery
  /** Where the queue came from, for the "playing from …" line. */
  context?: QueueSourceContext
}

/**
 * Play `urn` the way a tap in a list means it.
 *
 * `ctx.player.playFromContext` decides jump-versus-replace against the live
 * queue; this is only the catalogue half, shared by both shells: resolving
 * the list the tapped row belongs to when the screen only has a query.
 *
 * A catalogue read that fails must not take playback down with it — the tap
 * still plays the track itself, which is the closest surviving intent.
 */
export async function playFromList(ctx: Context, urn: string, list: PlayFromList = {}): Promise<void> {
  let contextUrns: readonly string[] = list.urns ?? []
  if (list.urns === undefined && list.query) {
    try {
      contextUrns = (await listAllTracks(ctx, list.query)).map((track) => track.urn)
    } catch {
      contextUrns = []
    }
  }
  void serviceOf<PlayerService>(ctx, 'player')?.playFromContext(urn, contextUrns, list.context ? { context: list.context } : {})
}


/** A pasted document's display name, before anything has validated it. */
function nameOf(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unnamed source'
  const doc = value as Record<string, unknown>
  if (typeof doc.sourceName === 'string' && doc.sourceName.trim()) return doc.sourceName
  if (typeof doc.sourceUrl === 'string' && doc.sourceUrl.trim()) return doc.sourceUrl
  return 'unnamed source'
}

/* ── recommendations ────────────────────────────────────────────────────── */

/**
 * The live providers that curate a recommendation feed, registry order.
 *
 * Derived from `capabilities.recommend`, which the runtime derives from the
 * document — a source without a `ruleRecommend` block never reaches this
 * list, so the shelf page has no "supported?" question to ask.
 */
export function useRecommendSources(ctx: Context): readonly MediaProvider[] {
  return useServiceState(
    ctx,
    ['source/registered', 'source/unregistered', 'source/changed'],
    () =>
      serviceOf<SourcesService>(ctx, 'sources')?.providers?.filter((p) => p.capabilities.recommend) ?? [],
    { isEqual: shallowArrayEqual },
  )
}

/** One recommendation shelf — the feed's first page, as a screen renders it. */
export interface RecommendShelfState extends AsyncState<readonly BrowseEntry[]> {
  reload: () => void
}

/**
 * The ten cards one source's shelf shows.
 *
 * The shelf never pages: "show all" is where more lives, and a shelf that
 * silently grew would move its own tail under the user's pointer.
 */
export function useRecommendShelf(ctx: Context, sourceId: string | undefined): RecommendShelfState {
  const [state, setState] = useState<AsyncState<readonly BrowseEntry[]>>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sourceId) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    ctx.sources
      .recommend(sourceId, { cursor: '1' })
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', data: result.items })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [ctx, sourceId, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, reload }
}

/** The show-all grid's accumulating feed. */
export interface RecommendFeedState {
  /** Everything loaded so far, across steps. */
  items: readonly BrowseEntry[]
  loading: boolean
  error?: Error
  /** False once a short page says the curated list has run out. */
  hasMore: boolean
  /** Load the next step — one grid page, however many feed pages that is. */
  loadMore: () => void
  reload: () => void
}

/**
 * One source's whole recommendation feed, a step at a time.
 *
 * The feed API hands out ten cards per call; the grid shows twenty per step,
 * so a step fetches two pages and appends whatever came back. A short page —
 * fewer cards than the feed's ten — is the only end marker a curated list
 * can give, and `hasMore` reads it, not the runtime's optimistic cursor.
 * Deduplication is by entry id, so a list edited between fetches cannot
 * produce a card twice.
 */
export function useRecommendFeed(
  ctx: Context,
  sourceId: string | undefined,
  cardsPerStep = 20,
): RecommendFeedState {
  const [items, setItems] = useState<readonly BrowseEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [exhausted, setExhausted] = useState(false)
  const nextPageRef = useRef(1)
  const inflightRef = useRef(false)
  const generationRef = useRef(0)

  const loadMore = useCallback(() => {
    if (!sourceId || inflightRef.current) return
    const generation = ++generationRef.current
    inflightRef.current = true
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const collected: BrowseEntry[] = []
        let fetched = 0
        while (fetched < cardsPerStep) {
          const result = await ctx.sources.recommend(sourceId, { cursor: String(nextPageRef.current) })
          if (generationRef.current !== generation) return
          collected.push(...result.items)
          fetched += result.items.length
          nextPageRef.current += 1
          // `hasMore` stays true on a partial page (the runtime cannot know a
          // curated list's length) — a short page is the real end marker.
          if (result.items.length < 10) break
        }
        if (generationRef.current !== generation) return
        setItems((prev) => {
          const seen = new Set(prev.map((entry) => entry.id))
          return [...prev, ...collected.filter((entry) => !seen.has(entry.id))]
        })
        if (collected.length < cardsPerStep) setExhausted(true)
      } catch (err) {
        if (generationRef.current === generation) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (generationRef.current === generation) setLoading(false)
        inflightRef.current = false
      }
    })()
  }, [ctx, sourceId, cardsPerStep])

  const reload = useCallback(() => {
    generationRef.current++
    inflightRef.current = false
    nextPageRef.current = 1
    setItems([])
    setExhausted(false)
    setError(undefined)
  }, [])

  // A different source starts the feed over; the first step loads itself.
  useEffect(() => {
    reload()
  }, [sourceId, reload])
  useEffect(() => {
    if (sourceId && items.length === 0 && !loading && !exhausted && !error) loadMore()
  }, [sourceId, items.length, loading, exhausted, error, loadMore])

  return { items, loading, error, hasMore: !exhausted, loadMore, reload }
}
