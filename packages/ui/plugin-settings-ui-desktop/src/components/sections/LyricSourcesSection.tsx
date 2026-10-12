import { Button, Sheet, Switch, TextField, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import {
  createElement as h,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import type { Context } from 'cordis'
import type {
  I18nService,
  LyricSourceDefinition,
  LyricSourcesService,
  LyricSourceTestResult,
  LyricsService,
  PlayerService,
  SourceRecord,
  SourcesService,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface LyricSourcesSectionProps {
  ctx: Context
}

/**
 * Sample templates shown in the import sheet. The human-readable
 * descriptions are localised; the scripts and identifiers are data.
 */
const buildSampleSourceJson = (t: I18nService['t']): string =>
  JSON.stringify(
    {
      id: 'sample-netease-lrc',
      name: 'Third-party lyric source sample (NetEase Cloud Music public API)',
      version: '1.0.0',
      author: 'Community',
      description: t('settings:lyricSources.searchesAndMatchesSyncedLyrics'),
    allowedHosts: ['music.163.com'],
    script: `// query: { title: string, artist: string, duration: number }
async function searchLyrics(query) {
  const { title, artist } = query;
  if (!title) return null;

  try {
    const q = (artist ? artist + ' ' : '') + title;
    const searchUrl = 'https://music.163.com/api/search/get?s=' + encodeURIComponent(q) + '&type=1&limit=1';
    const res = await httpFetch(searchUrl);
    const data = typeof res.json === 'function' ? await res.json() : JSON.parse(res.body);
    const songId = data?.result?.songs?.[0]?.id;
    if (!songId) return null;

    const lrcUrl = 'https://music.163.com/api/song/lyric?os=pc&id=' + songId + '&lv=-1&tv=-1';
    const lrcRes = await httpFetch(lrcUrl);
    const lrcData = typeof lrcRes.json === 'function' ? await lrcRes.json() : JSON.parse(lrcRes.body);
    return lrcData?.lrc?.lyric || null;
  } catch (err) {
    return null;
  }
}`,
    },
    null,
    2,
  )

const buildSampleLrclibJson = (t: I18nService['t']): string =>
  JSON.stringify(
    {
      id: 'lrclib-net',
      name: 'LRCLIB (lrclib.net)',
      version: '1.3.0',
      author: 'LRCLIB Community / BBeBee',
      description: t('settings:lyricSources.aGlobalHighQualityLyric'),
    allowedHosts: ['lrclib.net'],
    script: `// query: { title: string, artist: string, duration: number }
async function searchLyrics(query) {
  const { title, artist, duration } = query;
  if (!title || typeof title !== 'string') return null;

  const trimmedTitle = title.trim();
  const trimmedArtist = (artist || '').trim();
  const durationSec = duration && duration > 0 ? Math.round(duration / 1000) : 0;

  const headers = {
    'User-Agent': 'BBeBee-MusicPlayer/1.0.0 (https://github.com/BBeBee)',
    'Lrclib-Client': 'BBeBee-MusicPlayer/1.0.0',
  };

  function toQueryString(params) {
    return Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
  }

  function cleanTitle(t) {
    if (!t) return '';
    return t
      .replace(/\\s*[\\(\\[](?:(?:19|20)\\d\\d\\s+)?(?:remaster(?:ed)?|live|explicit|deluxe|bonus(?:\\s+track)?|anniversary|edit|mix|version|feat\\.?.*)(?:\\s+(?:19|20)\\d\\d)?[\\)\\]]\\s*$/i, '')
      .replace(/\\s*-\\s*(?:(?:19|20)\\d\\d\\s+)?(?:remaster(?:ed)?|live|deluxe|bonus(?:\\s+track)?|anniversary|edit|mix|version)(?:\\s+(?:19|20)\\d\\d)?\\s*$/i, '')
      .trim();
  }

  async function parseBody(res) {
    if (!res) return null;
    try {
      if (typeof res.json === 'function') return await res.json();
      if (typeof res.body === 'string' && res.body) return JSON.parse(res.body);
    } catch (_) {}
    return null;
  }

  let lastNetworkError = null;

  // 1. Try exact match via /api/get
  if (trimmedTitle && trimmedArtist) {
    const titlesToTry = [trimmedTitle];
    const cleaned = cleanTitle(trimmedTitle);
    if (cleaned && cleaned !== trimmedTitle) {
      titlesToTry.push(cleaned);
    }

    for (const curTitle of titlesToTry) {
      try {
        const getParams = {
          track_name: curTitle,
          artist_name: trimmedArtist,
        };
        if (durationSec > 0) {
          getParams.duration = String(durationSec);
        }

        const res = await httpFetch('https://lrclib.net/api/get?' + toQueryString(getParams), { headers });
        if (res && res.status === 200) {
          const data = await parseBody(res);
          if (data) {
            if (data.syncedLyrics && data.syncedLyrics.trim()) return data.syncedLyrics;
            if (data.plainLyrics && data.plainLyrics.trim()) return data.plainLyrics;
            if (data.instrumental) return '[00:00.00]Instrumental';
          }
        }
      } catch (err) {
        lastNetworkError = err;
      }
    }
  }

  // 2. Fallback to /api/search (fuzzy query)
  try {
    const searchTitle = cleanTitle(trimmedTitle) || trimmedTitle;
    const q = trimmedArtist ? (trimmedArtist + ' ' + searchTitle) : searchTitle;
    const searchUrl = 'https://lrclib.net/api/search?' + toQueryString({ q });

    const res = await httpFetch(searchUrl, { headers });
    if (res && res.status === 200) {
      const list = await parseBody(res);
      if (Array.isArray(list) && list.length > 0) {
        let match = null;
        if (durationSec > 0) {
          match = list.find((it) => it && it.syncedLyrics && Math.abs((it.duration || 0) - durationSec) <= 3) ||
                  list.find((it) => it && it.syncedLyrics && Math.abs((it.duration || 0) - durationSec) <= 6) ||
                  list.find((it) => it && it.plainLyrics && Math.abs((it.duration || 0) - durationSec) <= 4);
        }
        if (!match) match = list.find((it) => it && it.syncedLyrics) || list.find((it) => it && it.plainLyrics);

        if (match) {
          if (match.syncedLyrics && match.syncedLyrics.trim()) return match.syncedLyrics;
          if (match.plainLyrics && match.plainLyrics.trim()) return match.plainLyrics;
          if (match.instrumental) return '[00:00.00]Instrumental';
        }
      }
    }
  } catch (err) {
    lastNetworkError = err;
  }

  // 3. Fallback to title-only search
  if (trimmedArtist && trimmedTitle) {
    try {
      const res = await httpFetch('https://lrclib.net/api/search?' + toQueryString({ q: trimmedTitle }), { headers });
      if (res && res.status === 200) {
        const list = await parseBody(res);
        if (Array.isArray(list) && list.length > 0) {
          const match = list.find((it) => it && (it.syncedLyrics || it.plainLyrics));
          if (match) return match.syncedLyrics || match.plainLyrics || null;
        }
      }
    } catch (err) {
      lastNetworkError = err;
    }
  }

  if (lastNetworkError) {
    throw lastNetworkError;
  }

  return null;
}`,
    },
    null,
    2,
  )

export function LyricSourcesSection({ ctx }: LyricSourcesSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const sampleSourceJson = useMemo(() => buildSampleSourceJson(t), [t])
  const sampleLrclibJson = useMemo(() => buildSampleLrclibJson(t), [t])
  const [lyricSources, setLyricSources] = useState<LyricSourceDefinition[]>([])
  const [audioSources, setAudioSources] = useState<readonly SourceRecord[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; result: LyricSourceTestResult } | null>(
    null,
  )
  const [cacheCleared, setCacheCleared] = useState(false)
  const [configuringSource, setConfiguringSource] = useState<LyricSourceDefinition | null>(null)
  const [configText, setConfigText] = useState('')
  const [configError, setConfigError] = useState<string | null>(null)
  const [configSaving, setConfigSaving] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const updateLyrics = (list?: readonly LyricSourceDefinition[]) => {
      if (list) {
        setLyricSources([...list])
      } else {
        const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
        if (svc) setLyricSources([...svc.getSources()])
      }
    }
    const updateAudio = () => {
      const svc = serviceOf<SourcesService>(ctx, 'sources')
      if (svc) setAudioSources(svc.sources ?? [])
    }

    updateLyrics()
    updateAudio()

    const offLyric = ctx.on('lyric-sources/changed', (list) => updateLyrics(list))
    const offAudio = ctx.on('source/changed', () => updateAudio())

    return () => {
      offLyric()
      offAudio()
    }
  }, [ctx])

  const handleToggleLyricSource = async (id: string, enabled: boolean) => {
    const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
    if (!svc) return
    await svc.setEnabled(id, enabled)
    setLyricSources([...svc.getSources()])
  }

  const handleRemoveLyricSource = async (id: string) => {
    const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
    if (!svc) return
    await svc.removeSource(id)
    setLyricSources([...svc.getSources()])
  }

  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
    if (!svc) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= lyricSources.length) return

    const copy = [...lyricSources]
    const [moved] = copy.splice(index, 1)
    if (!moved) return
    copy.splice(targetIndex, 0, moved)

    await svc.reorder(copy.map((s) => s.id))
    setLyricSources([...copy])
  }

  const handleTest = async (id: string) => {
    const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
    if (!svc) return
    setTestingId(id)
    setTestResult(null)
    try {
      const player = serviceOf<PlayerService>(ctx, 'player')
      const nowPlaying = player?.state?.nowPlaying
      const testQuery = nowPlaying?.title
        ? {
            title: nowPlaying.title,
            artist: nowPlaying.artist ?? '',
            duration: player?.state?.durationMs ?? 0,
          }
        : {
            title: t('settings:lyricSources.demoSong'),
            artist: 'Demo Artist',
            duration: 269000,
          }
      const res = await svc.testSource(id, testQuery)
      setTestResult({ id, result: res })
    } finally {
      setTestingId(null)
    }
  }

  const handleToggleNeedsLyricSource = async (sourceId: string, needed: boolean) => {
    const svc = serviceOf<SourcesService>(ctx, 'sources')
    if (!svc) return
    await svc.setNeedsLyricSource(sourceId, needed)
    setAudioSources(svc.sources ?? [])
  }

  const handleImportSubmit = async () => {
    const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
    if (!svc) return
    setImportError(null)

    if (!importText.trim()) {
      setImportError(t('settings:lyricSources.importEmptyError'))
      return
    }

    try {
      const parsed = JSON.parse(importText) as Partial<LyricSourceDefinition>
      if (!parsed.id || !parsed.name || !parsed.script) {
        setImportError(t('settings:lyricSources.importInvalidError'))
        return
      }

      await svc.registerSource({
        id: String(parsed.id),
        name: String(parsed.name),
        description: parsed.description ? String(parsed.description) : undefined,
        version: parsed.version ? String(parsed.version) : '1.0.0',
        author: parsed.author ? String(parsed.author) : 'User',
        enabled: parsed.enabled !== false,
        sortOrder: typeof parsed.sortOrder === 'number' ? parsed.sortOrder : lyricSources.length,
        script: String(parsed.script),
        config: parsed.config,
        allowedHosts: Array.isArray(parsed.allowedHosts) ? parsed.allowedHosts : undefined,
      })

      setShowImportModal(false)
      setImportText('')
      setLyricSources([...svc.getSources()])
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'JSON parse error')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result
      if (typeof content === 'string') {
        setImportText(content)
        setImportError(null)
      }
    }
    reader.readAsText(file)
  }

  return h(
    'div',
    { id: 'section-lyric-sources', style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // 1. Lyric Sources Management Section
    h(
      SettingsSection,
      {
        title: t('settings:lyricSources.lyricSourceManagementLyricSources'),
        description: t('settings:lyricSources.manageDesc'),
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.06)',
          },
        },
        h(
          'div',
          null,
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('settings:lyricSources.lyricSourceLibrary')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', marginTop: 2 } },
            t('settings:lyricSources.lyricSourcesLoadedLyricsAre', { length: lyricSources.length }),
          ),
        ),
        h(Button, {
          children: t('settings:lyricSources.importLyricSource'),
          onPress: () => {
            setImportError(null)
            setShowImportModal(true)
          },
        }),
      ),

      // List of lyric sources
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        lyricSources.map((source, idx) => {
          const isBuiltin = source.id === 'builtin-lrclib'
          const isTesting = testingId === source.id
          const hasTestResult = testResult?.id === source.id

          return h(
            'div',
            {
              key: source.id,
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 16px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.07)',
                background: source.enabled
                  ? 'rgba(255, 255, 255, 0.02)'
                  : 'rgba(255, 255, 255, 0.008)',
                opacity: source.enabled ? 1 : 0.65,
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                },
              },
              // Title & Badges
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 } },
                h(
                  'span',
                  {
                    style: {
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--text-primary, #fff)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  source.name,
                ),
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: isBuiltin
                        ? 'rgba(95, 135, 255, 0.15)'
                        : 'rgba(52, 199, 89, 0.15)',
                      color: isBuiltin ? 'var(--color-primary, #5F87FF)' : '#34C759',
                    },
                  },
                  isBuiltin ? t('settings:lyricSources.builtIn') : t('settings:lyricSources.sandboxed'),
                ),
                source.version &&
                  h(
                    'span',
                    { style: { fontSize: 11, color: 'var(--text-secondary, #8E8E93)' } },
                    `v${source.version}`,
                  ),
              ),

              // Actions
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                // Move Up
                h(Button, {
                  variant: 'ghost',
                  disabled: idx === 0,
                  onPress: () => void handleMoveOrder(idx, 'up'),
                  children: '↑',
                  accessibilityLabel: t('settings:lyricSources.moveUp'),
                }),
                // Move Down
                h(Button, {
                  variant: 'ghost',
                  disabled: idx === lyricSources.length - 1,
                  onPress: () => void handleMoveOrder(idx, 'down'),
                  children: '↓',
                  accessibilityLabel: t('settings:lyricSources.moveDown'),
                }),
                // Test Button
                h(Button, {
                  variant: 'secondary',
                  disabled: isTesting,
                  onPress: () => void handleTest(source.id),
                  children: isTesting ? t('settings:lyricSources.testing') : t('settings:lyricSources.test'),
                }),
                // Configure Button
                h(Button, {
                  variant: 'secondary',
                  onPress: () => {
                    setConfiguringSource(source)
                    setConfigText(JSON.stringify(source.config ?? {}, null, 2))
                    setConfigError(null)
                  },
                  accessibilityLabel: t('settings:lyricSources.configureLyricSource', { name: source.name }),
                  testID: `lyric-source-configure-${source.id}`,
                  children: t('settings:lyricSources.configure'),
                }),
                // Delete button
                !isBuiltin &&
                  h(Button, {
                    variant: 'danger',
                    onPress: () => void handleRemoveLyricSource(source.id),
                    children: t('app:common.delete'),
                  }),
                // Enable/disable switch
                h(Switch, {
                  checked: source.enabled,
                  accessibilityLabel: t('settings:lyricSources.enableLyricSource', { name: source.name }),
                  onChange: (checked) => void handleToggleLyricSource(source.id, checked),
                }),
              ),
            ),

            // Description / Details
            h(
              'div',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--text-secondary, #8E8E93)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                },
              },
              source.description && h('span', null, source.description),
              source.allowedHosts &&
                source.allowedHosts.length > 0 &&
                h(
                  'span',
                  { style: { color: 'var(--text-secondary, #8E8E93)' } },
                  t('settings:lyricSources.allowedHosts', { hosts: source.allowedHosts.join(', ') }),
                ),
            ),

            // Inline Test Result
            hasTestResult &&
              h(
                'div',
                {
                  style: {
                    marginTop: 6,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: testResult.result.ok
                      ? 'rgba(52, 199, 89, 0.1)'
                      : 'rgba(255, 59, 48, 0.1)',
                    border: `1px solid ${
                      testResult.result.ok ? 'rgba(52, 199, 89, 0.3)' : 'rgba(255, 59, 48, 0.3)'
                    }`,
                    fontSize: 12,
                    color: testResult.result.ok ? '#34C759' : '#FF453A',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'space-between' } },
                  h(
                    'strong',
                    null,
                    testResult.result.ok
                      ? t('settings:lyricSources.testPassed', { durationMs: testResult.result.durationMs ?? 0 })
                      : t('settings:lyricSources.testFailed', { durationMs: testResult.result.durationMs ?? 0 }),
                  ),
                  testResult.result.lyrics &&
                    h('span', null, t('settings:lyricSources.format', { format: testResult.result.lyrics.format })),
                ),
                testResult.result.error && h('div', null, testResult.result.error),
                testResult.result.lyrics?.content &&
                  h(
                    'pre',
                    {
                      style: {
                        margin: 0,
                        padding: 6,
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 4,
                        fontSize: 11,
                        maxHeight: 60,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        color: 'rgba(255, 255, 255, 0.8)',
                      },
                    },
                    testResult.result.lyrics.content.slice(0, 200) + '...',
                  ),
              ),
          )
        }),
      ),
    ),

    // 2. Audio Sources Policy Section
    h(
      SettingsSection,
      {
        title: t('settings:lyricSources.audioSourceLyricPolicyAudio'),
        description: t('settings:lyricSources.audioPolicyDesc'),
      },
      audioSources.length === 0
        ? h(
            'div',
            { style: { fontSize: 13, color: 'var(--text-secondary, #8E8E93)', padding: '8px 0' } },
            t('settings:lyricSources.noEnabledAudioSources'),
          )
        : audioSources.map((source, index) =>
            h(SettingsRow, {
              ctx,
              key: source.id,
              title: source.name,
              description: source.group
                ? t('settings:lyricSources.idWithGroup', {
                    id: source.id,
                    group: source.group,
                    preference: source.needsLyricSource
                      ? t('settings:lyricSources.prefersExternal')
                      : t('settings:lyricSources.prefersBuiltIn'),
                  })
                : t('settings:lyricSources.idWithoutGroup', {
                    id: source.id,
                    preference: source.needsLyricSource
                      ? t('settings:lyricSources.prefersExternal')
                      : t('settings:lyricSources.prefersBuiltIn'),
                  }),
              borderBottom: index < audioSources.length - 1,
              action: h(Switch, {
                checked: Boolean(source.needsLyricSource),
                accessibilityLabel: t('settings:lyricSources.audioSourceForcedToUse', { name: source.name }),
                onChange: (checked) => void handleToggleNeedsLyricSource(source.id, checked),
              }),
            }),
          ),
    ),

    // 3. Lyric Cache Section
    h(
      SettingsSection,
      {
        title: t('settings:lyricSources.localLyricCacheLyricCache'),
        description: t('settings:lyricSources.cacheDesc'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:lyricSources.persistentLocalLyricCache'),
        description: t('settings:lyricSources.clearsAllCachedLyricDocuments'),
        action: h(Button, {
          variant: 'secondary',
          onPress: async () => {
            const lyricsSvc = serviceOf<LyricsService>(ctx, 'lyrics')
            await lyricsSvc?.clearCache?.()
            setCacheCleared(true)
            setTimeout(() => setCacheCleared(false), 2000)
          },
          children: cacheCleared ? t('settings:lyricSources.cacheCleared') : t('settings:lyricSources.clearLyricCache'),
        }),
      }),
    ),

    // 4. Import Sheet Modal
    h(
      Sheet,
      {
        open: showImportModal,
        onClose: () => {
          setShowImportModal(false)
          setImportError(null)
        },
        title: t('settings:lyricSources.importThirdPartyLyricSource'),
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingTop: 6,
          },
        },
        // Security sandbox note
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(52, 199, 89, 0.08)',
              border: '1px solid rgba(52, 199, 89, 0.2)',
              fontSize: 12,
              lineHeight: 1.5,
              color: '#B6E8C3',
            },
          },
          h(
            'div',
            { style: { flexShrink: 0, marginTop: 1, color: '#34C759' } },
            tablerIcon('shield-check', { size: 18 }),
          ),
          h(
            'div',
            null,
            h('strong', { style: { color: '#34C759' } }, t('settings:lyricSources.strictSandboxIsolation')),
            t('settings:lyricSources.sandboxNote'),
          ),
        ),

        // Toolbar
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            },
          },
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
            t('settings:lyricSources.pastePrompt'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(Button, {
              variant: 'secondary',
              onPress: () => {
                setImportText(sampleLrclibJson)
                setImportError(null)
              },
              children: t('settings:lyricSources.loadLrclibTemplate'),
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => {
                setImportText(sampleSourceJson)
                setImportError(null)
              },
              children: t('settings:lyricSources.loadSampleTemplate'),
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => fileInputRef.current?.click(),
              children: t('settings:lyricSources.chooseLocalFile'),
            }),
          ),
        ),

        // Hidden file input
        h('input', {
          ref: fileInputRef,
          type: 'file',
          accept: '.json,.js',
          style: { display: 'none' },
          onChange: handleFileSelect,
        }),

        // Textarea
        h('textarea', {
          value: importText,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setImportText(e.target.value)
            setImportError(null)
          },
          placeholder: t('settings:lyricSources.pasteLyricSourceJSONConfiguration'),
          rows: 14,
          style: {
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'JetBrains Mono, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.45,
            padding: '12px 14px',
            borderRadius: 8,
            border: importError
              ? '1px solid #FF453A'
              : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
            background: 'rgba(0, 0, 0, 0.4)',
            color: '#ECEFF4',
            resize: 'vertical',
            outline: 'none',
          },
        }),

        // Error message
        importError &&
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#FF453A',
                background: 'rgba(255, 69, 58, 0.1)',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255, 69, 58, 0.25)',
              },
            },
            tablerIcon('alert-circle', { size: 16 }),
            h('span', null, importError),
          ),

        // Modal Action buttons
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 6,
            },
          },
          h(Button, {
            variant: 'ghost',
            onPress: () => {
              setShowImportModal(false)
              setImportError(null)
            },
            children: t('app:common.cancel'),
          }),
          h(Button, {
            variant: 'primary',
            onPress: () => void handleImportSubmit(),
            children: t('settings:lyricSources.importButton'),
          }),
        ),
      ),
    ),

    // 4. Lyric source configure modal
    h(
      Sheet,
      {
        open: configuringSource !== null,
        onClose: () => {
          setConfiguringSource(null)
          setConfigError(null)
        },
        title: t('settings:lyricSources.configureTitle', { name: configuringSource?.name ?? '' }),
        testID: 'lyric-source-configure-modal',
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingTop: 6,
          },
        },
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          t('settings:lyricSources.configureDesc'),
        ),
        h(TextField, {
          multiline: true,
          rows: 8,
          value: configText,
          onChange: setConfigText,
          placeholder: t('settings:lyricSources.configJsonExample'),
          accessibilityLabel: t('settings:lyricSources.configJsonLabel'),
          testID: 'lyric-source-configure-json',
        }),
        configError &&
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#FF453A',
                background: 'rgba(255, 69, 58, 0.1)',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255, 69, 58, 0.25)',
              },
            },
            tablerIcon('alert-circle', { size: 16 }),
            h('span', null, configError),
          ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 6,
            },
          },
          h(Button, {
            variant: 'ghost',
            onPress: () => {
              setConfiguringSource(null)
              setConfigError(null)
            },
            testID: 'lyric-source-configure-cancel-btn',
            children: t('app:common.cancel'),
          }),
          h(Button, {
            variant: 'primary',
            loading: configSaving,
            onPress: async () => {
              if (!configuringSource) return
              try {
                const parsed = JSON.parse(configText.trim() || '{}')
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                  setConfigError(t('settings:lyricSources.configMustBeObject'))
                  return
                }
                setConfigSaving(true)
                const svc = serviceOf<LyricSourcesService>(ctx, 'lyricSources')
                await svc?.updateSourceConfig(configuringSource.id, parsed)
                setConfigSaving(false)
                setConfiguringSource(null)
                setConfigError(null)
                if (svc) setLyricSources([...svc.getSources()])
              } catch (err: unknown) {
                setConfigSaving(false)
                setConfigError(err instanceof Error ? err.message : t('settings:lyricSources.jSONParseError'))
              }
            },
            testID: 'lyric-source-configure-save-btn',
            children: t('settings:lyricSources.saveConfig'),
          }),
        ),
      ),
    ),
  )
}
