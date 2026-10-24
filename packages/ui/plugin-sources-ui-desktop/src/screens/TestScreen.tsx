import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { I18nService, StreamQuality, TraceEvent, UiService } from '@BBeBee/protocol'
import { useSourceTrace, useSources } from '@bbebee/plugin-sources/hooks'
import { Button, EmptyState, JsonTree, Text, TextField, useI18n } from '@BBeBee/ui-kit-desktop'
import { serviceOf } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

interface SourceOption {
  id: string
  name: string
}

function pageOf(text: string): number | undefined {
  const n = parseInt(text, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function TestScreen({ ctx, sourceId }: { ctx: Context; sourceId?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const scheme = p()
  const sources = useSources(ctx)
  const [selectedId, setSelectedId] = useState<string | undefined>(sourceId ?? sources[0]?.id)
  const trace = useSourceTrace(ctx, selectedId)

  if (selectedId === undefined && sources.length > 0) setSelectedId(sources[0]!.id)
  useEffect(() => {
    if (sourceId) setSelectedId(sourceId)
  }, [sourceId])

  const options: readonly SourceOption[] = sources.map((s) => ({ id: s.id, name: s.name }))
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
  const [quality, setQuality] = useState('normal')
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
      'section',
      { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
      h(Text, { variant: 'lg' }, t('sources:test.testASource')),
      h(EmptyState, {
        title: t('sources:sourcesList.noSourcesYet'),
        description: t('sources:test.importASourceStringFirst'),
      }),
    )
  }

  const area = (
    title: string,
    testID: string,
    fields: ReactElement[],
    onRun: () => void,
    disabled: boolean,
  ): ReactElement =>
    h(
      'div',
      {
        key: title,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[2],
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          background: scheme.bg.raised,
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

  const field = (label: string, value: string, onChange: (next: string) => void, testID: string, placeholder?: string): ReactElement =>
    h(
      'label',
      { key: label, style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
      h(Text, { variant: 'sm', tone: 'muted' }, label),
      h(TextField, { value, onChange, testID, ...(placeholder ? { placeholder } : {}) }),
    )

  const qualities = provider?.capabilities.streaming.qualities ?? ['normal']

  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: tokens.space[4],
        padding: tokens.space[4],
        height: '100%',
        minHeight: 0,
        alignItems: 'stretch',
      },
    },
    h(
      'div',
      {
        'aria-label': t('sources:test.testControls'),
        style: {
          width: 440,
          flexShrink: 0,
          overflowY: 'auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[3],
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        h(Text, { variant: 'lg' }, t('sources:test.testASource')),
        h(Button, {
          variant: 'ghost',
          children: t('sources:test.backToDebug'),
          onPress: () => serviceOf<UiService>(ctx, 'ui')?.navigate?.('debug.view'),
        }),
      ),
      h(
        'label',
        { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
        h(Text, { variant: 'sm', tone: 'muted' }, t('sources:test.sourceWord')),
        h(
          'select',
          {
            value: selectedId ?? '',
            onChange: (event: Event & { target: HTMLSelectElement }) => {
              setSelectedId(event.target.value)
              trace.clear()
            },
            'aria-label': t('sources:test.sourceToTest'),
            testID: 'test-source-select',
            style: {
              padding: tokens.space[2],
              borderRadius: tokens.radius.sm,
              background: scheme.bg.raised,
              color: scheme.text.primary,
              border: 'none',
            },
          },
          ...options.map((option) =>
            h('option', { key: option.id, value: option.id }, option.name),
          ),
        ),
      ),

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
            field(t('sources:test.fieldQuality', { qualities: qualities.join(', ') }), quality, setQuality, 'test-stream-quality'),
          ], () => trace.run({ kind: 'stream', id: streamId.trim(), ...(quality ? { quality: quality as StreamQuality } : {}) }), !streamId.trim())
        : null,

      area(t('sources:test.areaHttp'), 'test-run-http', [
        h(
          'div',
          { key: 'method', style: { display: 'flex', gap: tokens.space[2] } },
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
    ),
    h(
      'div',
      {
        'aria-label': t('sources:test.results'),
        style: { flex: 1, minWidth: 0, overflowY: 'auto', minHeight: 0 },
      },
      h(TraceList, { events: trace.events, running: trace.running, t }),
    ),
  )
}

function TraceList({
  events,
  running,
  t,
}: {
  events: readonly TraceEvent[]
  running: boolean
  t: I18nService['t']
}): ReactElement {
  const scheme = p()
  if (events.length === 0) {
    return h(EmptyState, {
      title: running ? t('sources:test.running') : t('sources:test.noTraceYet'),
      description: running ? undefined : t('sources:test.traceStepHint'),
    })
  }
  return h(
    'ol',
    {
      'aria-label': t('sources:test.trace'),
      'aria-live': 'polite',
      style: {
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        fontFamily: tokens.font.family.mono,
        fontSize: tokens.font.size.sm,
      },
    },
    ...events.map((event, i) =>
      h(
        'li',
        {
          key: i,
          style: {
            padding: tokens.space[2],
            borderRadius: tokens.radius.sm,
            background: scheme.bg.raised,
            borderLeft: `3px solid ${event.kind === 'error' ? scheme.state.error : scheme.border.subtle}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            ...(event.kind === 'value'
              ? { maxHeight: 480, overflow: 'auto', background: scheme.bg.overlay }
              : {}),
          },
        },
        event.kind === 'value' ? valueBlock(event) : traceLine(t, event),
      ),
    ),
  )
}

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
    default:
      return ''
  }
}

function valueBlock(event: Extract<TraceEvent, { kind: 'value' }>): ReactElement {
  const text = event.value
  const parseable = text.trim().startsWith('{') || text.trim().startsWith('[')
  let parsed: unknown
  if (parseable) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON after all
    }
  }
  return h(
    'div',
    null,
    h('div', { style: { color: p().text.secondary, marginBottom: tokens.space[1] } }, event.label),
    parsed !== undefined
      ? h(JsonTree, { value: parsed, accessibilityLabel: event.label, controls: true })
      : text,
  )
}
