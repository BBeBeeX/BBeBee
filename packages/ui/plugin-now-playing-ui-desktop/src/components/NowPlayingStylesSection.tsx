import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, I18nService, NowPlayingService, NowPlayingStyleMeta } from '@BBeBee/protocol'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Sheet, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'

interface SettingsWriter {
  getSync(): AppSettings
  update(patch: Partial<AppSettings>): Promise<unknown>
}

export function getLocalizedStyleName(t: (key: string) => string, s: { id: string; name: string }): string {
  switch (s.id) {
    case 'classic': return t('nowPlaying:nowPlayingStyles.styleClassicName')
    case 'full-cover': return t('nowPlaying:nowPlayingStyles.styleFullCoverName')
    case 'vinyl': return t('nowPlaying:nowPlayingStyles.styleVinylName')
    case 'compact': return t('nowPlaying:nowPlayingStyles.styleCompactName')
    case 'cinematic': return t('nowPlaying:nowPlayingStyles.styleCinematicName')
    default: return s.name
  }
}

export function getLocalizedStyleDescription(t: (key: string) => string, s: { id: string; description: string }): string {
  switch (s.id) {
    case 'classic': return t('nowPlaying:nowPlayingStyles.styleClassicDesc')
    case 'full-cover': return t('nowPlaying:nowPlayingStyles.styleFullCoverDesc')
    case 'vinyl': return t('nowPlaying:nowPlayingStyles.styleVinylDesc')
    case 'compact': return t('nowPlaying:nowPlayingStyles.styleCompactDesc')
    case 'cinematic': return t('nowPlaying:nowPlayingStyles.styleCinematicDesc')
    default: return s.description
  }
}

const buildSamplePluginManifest = (t: I18nService['t']): string =>
  JSON.stringify(
    {
      id: 'sample-neon-player',
      name: 'Neon Sandbox Player',
      description: t('nowPlaying:nowPlayingStyles.externalHTMLDynamicSandboxTemplate'),
    author: 'BBeBee Community',
    version: '1.0.0',
    htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #080A10;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    .ambient-bg {
      position: absolute;
      inset: -50px;
      background-size: cover;
      background-position: center;
      filter: blur(80px) saturate(180%);
      opacity: 0.18;
      z-index: 0;
      transition: background-image 0.6s ease;
    }
    .container {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 40px;
      max-width: 880px;
      width: 90%;
      padding: 32px;
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.5);
    }
    .cover-wrap {
      width: 220px;
      height: 220px;
      flex-shrink: 0;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 16px 36px rgba(0,0,0,0.4);
      background: #141722;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cover-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .info-pane {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .badge {
      align-self: flex-start;
      background: rgba(52, 199, 89, 0.15);
      color: #34C759;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .title {
      font-size: 24px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #fff;
    }
    .artist {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.6);
      margin-top: 2px;
    }
    .lyrics-box {
      margin-top: 4px;
      height: 42px;
      display: flex;
      align-items: center;
      color: var(--theme-color, #5F87FF);
      font-size: 15px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      cursor: pointer;
      position: relative;
      margin-top: 8px;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--theme-color, #5F87FF);
      border-radius: 3px;
      width: 0%;
      transition: width 0.1s linear;
    }
    .time-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
      margin-top: 4px;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-top: 6px;
    }
    .btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #fff;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      transition: all 0.2s;
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
    }
    .btn-play {
      width: 48px;
      height: 48px;
      background: var(--theme-color, #5F87FF);
      border: none;
      font-size: 18px;
    }
    .btn-fav.active {
      color: #FF3B30;
    }
  </style>
</head>
<body>
  <div id="ambient" class="ambient-bg"></div>
  <div class="container">
    <div class="cover-wrap">
      <img id="cover" class="cover-img" src="" alt="" style="display:none;" />
      <span id="cover-ph" style="color:rgba(255,255,255,0.2);font-size:40px;">🎵</span>
    </div>
    <div class="info-pane">
      <div class="badge">🛡️ SANDBOX PLUGIN</div>
      <div>
        <div id="title" class="title">${t('nowPlaying:nowPlaying.nothingPlaying')}</div>
        <div id="artist" class="artist">-</div>
      </div>
      <div id="lyric" class="lyrics-box">-</div>
      <div id="progress-bg" class="progress-bar-bg">
        <div id="progress-fill" class="progress-bar-fill"></div>
      </div>
      <div class="time-row">
        <span id="pos">00:00</span>
        <span id="dur">00:00</span>
      </div>
      <div class="controls">
        <button id="prev" class="btn" title="${t('nowPlaying:nowPlayingStyles.previousTrack')}">⏮</button>
        <button id="play" class="btn btn-play" title="${t('nowPlaying:nowPlayingStyles.playPause')}">▶</button>
        <button id="next" class="btn" title="${t('nowPlaying:nowPlayingStyles.nextTrack')}">⏭</button>
        <button id="fav" class="btn btn-fav" title="${t('nowPlaying:nowPlayingStyles.addToFavorites')}">♥</button>
      </div>
    </div>
  </div>
  <script>
    function fmt(s) {
      if (!s || isNaN(s)) return '00:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }
    let lastSnapshot = null;
    const coverEl = document.getElementById('cover');
    const phEl = document.getElementById('cover-ph');
    coverEl.onerror = () => {
      coverEl.removeAttribute('src');
      coverEl.style.display = 'none';
      if (phEl) phEl.style.display = 'inline';
    };

    if (window.BBeBeePlayer) {
      window.BBeBeePlayer.onSnapshot((data) => {
        lastSnapshot = data;
        document.getElementById('title').textContent = data.title || '${t('nowPlaying:nowPlaying.nothingPlaying')}';
        document.getElementById('artist').textContent = data.artist || '-';
        if (data.cover) {
          coverEl.src = data.cover;
          coverEl.style.display = 'block';
          if (phEl) phEl.style.display = 'none';
          document.getElementById('ambient').style.backgroundImage = 'url("' + encodeURI(data.cover) + '")';
        } else {
          coverEl.removeAttribute('src');
          coverEl.style.display = 'none';
          if (phEl) phEl.style.display = 'inline';
          document.getElementById('ambient').style.backgroundImage = 'none';
        }
        if (data.coverThemeColor) {
          document.documentElement.style.setProperty('--theme-color', data.coverThemeColor);
        }
        const posSec = (data.positionMs || 0) / 1000;
        const durSec = (data.durationMs || 0) / 1000;
        document.getElementById('pos').textContent = fmt(posSec);
        document.getElementById('dur').textContent = fmt(durSec);
        const pct = durSec > 0 ? Math.min(100, (posSec / durSec) * 100) : 0;
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('play').textContent = data.isPlaying ? '⏸' : '▶';
        const favBtn = document.getElementById('fav');
        if (data.isLoved) { favBtn.classList.add('active'); } else { favBtn.classList.remove('active'); }
        let currentLine = '';
        if (data.lyrics && data.lyrics.lines && data.lyrics.lines.length > 0) {
          if (data.lyrics.activeIndex >= 0 && data.lyrics.lines[data.lyrics.activeIndex]) {
            currentLine = data.lyrics.lines[data.lyrics.activeIndex].text;
          } else if (data.lyrics.lines.every((l) => l.timeMs === undefined)) {
            currentLine = data.lyrics.lines.find((l) => l.text && l.text.trim())?.text || '';
          }
        }
        document.getElementById('lyric').textContent = currentLine || '...';
      });
      document.getElementById('play').onclick = () => window.BBeBeePlayer.togglePlay();
      document.getElementById('prev').onclick = () => window.BBeBeePlayer.previous();
      document.getElementById('next').onclick = () => window.BBeBeePlayer.next();
      document.getElementById('fav').onclick = () => window.BBeBeePlayer.toggleFavorite();
      document.getElementById('progress-bg').onclick = (e) => {
        const snap = lastSnapshot || (window.BBeBeePlayer && window.BBeBeePlayer.getState());
        if (!snap || !snap.durationMs) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        window.BBeBeePlayer.seek(ratio * snap.durationMs);
      };
    }
  </script>
</body>
</html>`,
    },
    null,
    2,
  )

export function NowPlayingStylesSection({ ctx }: { ctx: Context }): ReactElement {
  const nowPlayingService = ctx ? serviceOf<NowPlayingService>(ctx, 'nowPlaying') : undefined
  const settingsWriter = ctx
    ? serviceOf<SettingsWriter>(ctx, 'settings')
    : undefined

  const [styles, setStyles] = useState<readonly NowPlayingStyleMeta[]>(() => {
    return nowPlayingService?.getStyles?.() ?? NOW_PLAYING_STYLES
  })

  const [showImportModal, setShowImportModal] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useI18n(ctx)

  useEffect(() => {
    if (!ctx) return
    const updateList = (newStyles?: readonly NowPlayingStyleMeta[]) => {
      if (newStyles && Array.isArray(newStyles)) {
        setStyles(newStyles)
        return
      }
      const svc = serviceOf<NowPlayingService>(ctx, 'nowPlaying')
      const list = svc?.getStyles?.()
      if (list) setStyles(list)
    }

    updateList()
    const off1 = ctx.on('now-playing/registry-changed', (s) => updateList(s))
    const off2 = ctx.on('now-playing/style-changed', () => updateList())
    return () => {
      off1()
      off2()
    }
  }, [ctx])

  const [currentStyleId, setCurrentStyleId] = useState<string>(
    () =>
      settingsWriter?.getSync()?.nowPlayingStyle ??
      nowPlayingService?.getStyle?.() ??
      'classic',
  )

  useEffect(() => {
    const refresh = () => {
      setCurrentStyleId(
        serviceOf<SettingsWriter>(ctx, 'settings')?.getSync()?.nowPlayingStyle ??
          nowPlayingService?.getStyle?.() ??
          'classic',
      )
    }
    const off = ctx.on('settings/changed', refresh)
    return () => {
      off()
    }
  }, [ctx, nowPlayingService])

  const handleSelectStyle = async (id: string) => {
    await settingsWriter?.update({ nowPlayingStyle: id })
    const svc = ctx ? serviceOf<NowPlayingService>(ctx, 'nowPlaying') : undefined
    svc?.setStyle?.(id)
  }

  const handleDeleteStyle = (e: { stopPropagation(): void }, id: string) => {
    e.stopPropagation()
    const svc = ctx ? serviceOf<NowPlayingService>(ctx, 'nowPlaying') : undefined
    if (svc?.removeStyle) {
      svc.removeStyle(id)
    } else {
      setStyles((prev) => prev.filter((s) => s.id !== id))
    }
  }

  const handleFileChange = (e: { target: { files: FileList | null; value: string } }) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result
      if (typeof text === 'string') {
        setImportJson(text)
        setImportError(null)
      }
    }
    reader.onerror = () => {
      setImportError(t('nowPlaying:nowPlayingStyles.failedToReadFile'))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleLoadSample = () => {
    setImportJson(buildSamplePluginManifest(t))
    setImportError(null)
  }

  const handleImportSubmit = async () => {
    try {
      if (!importJson.trim()) {
        throw new Error(t('nowPlaying:nowPlayingStyles.enterOrSelectManifest'))
      }
      const parsed = JSON.parse(importJson) as Partial<NowPlayingStyleMeta>
      if (!parsed || typeof parsed !== 'object') throw new Error(t('nowPlaying:nowPlayingStyles.invalidJson'))
      if (!parsed.id || typeof parsed.id !== 'string') throw new Error(t('nowPlaying:nowPlayingStyles.missingPluginIdField'))
      if (!parsed.name || typeof parsed.name !== 'string') throw new Error(t('nowPlaying:nowPlayingStyles.missingPluginNameField'))
      if (!parsed.htmlContent || typeof parsed.htmlContent !== 'string') {
        throw new Error(t('nowPlaying:nowPlayingStyles.missingPluginHtmlContent'))
      }

      const cleanId = parsed.id.trim()
      const isBuiltinConflict = NOW_PLAYING_STYLES.some((b) => b.id === cleanId)
      if (isBuiltinConflict) {
        throw new Error(t('nowPlaying:nowPlayingStyles.pluginIdConflictsWithA', { cleanId }))
      }

      const newStyle: NowPlayingStyleMeta = {
        id: cleanId,
        name: parsed.name.trim(),
        description: parsed.description ? parsed.description.trim() : t('nowPlaying:nowPlayingStyles.userImportedTemplateDescription'),
        author: parsed.author ? parsed.author.trim() : 'Community',
        version: parsed.version ? parsed.version.trim() : '1.0.0',
        icon: parsed.icon ?? 'layout',
        type: 'sandboxed',
        htmlContent: parsed.htmlContent,
        entryUrl: parsed.entryUrl,
        config: parsed.config,
      }

      const svc = ctx ? serviceOf<NowPlayingService>(ctx, 'nowPlaying') : undefined
      if (svc?.registerStyle) {
        svc.registerStyle(newStyle)
      } else {
        setStyles((prev) => [...prev.filter((s) => s.id !== newStyle.id), newStyle])
      }

      await handleSelectStyle(newStyle.id)
      setShowImportModal(false)
      setImportJson('')
      setImportError(null)
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  return h(
    'section',
    { 'data-testid': 'now-playing-styles-card', style: { marginBottom: 32 } },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        t('nowPlaying:nowPlayingStyles.sectionTitle'),
      ),
      h(
        'p',
        {
          style: {
            fontSize: 12,
            color: 'var(--text-secondary, #8E8E93)',
            margin: '3px 0 0',
            lineHeight: 1.4,
          },
        },
        t('nowPlaying:nowPlayingStyles.sectionSubtitle'),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '16px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
          gap: 16,
        },
      },
      // Top row: Action bar
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            paddingBottom: 16,
            borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('nowPlaying:nowPlayingStyles.layout')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', lineHeight: 1.45 } },
            (() => {
              const activeStyle = styles.find((s) => s.id === currentStyleId)
              const activeName = activeStyle ? getLocalizedStyleName(t, activeStyle) : currentStyleId
              return t('nowPlaying:nowPlayingStyles.stylesLoadedInUse', { count: styles.length, name: activeName })
            })(),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'import-style-button',
            onClick: () => {
              setImportJson('')
              setImportError(null)
              setShowImportModal(true)
            },
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 20,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: 'var(--border-default, rgba(255, 255, 255, 0.25))',
              background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
              color: 'var(--text-secondary, #C5CAD8)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--color-primary, #5F87FF)'
              e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.25))'
              e.currentTarget.style.color = 'var(--text-secondary, #C5CAD8)'
            },
          },
          tablerIcon('plus', { size: 14 }),
          t('nowPlaying:nowPlayingStyles.importStylePlugin'),
        ),
      ),

      // Styles Card Grid
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
            width: '100%',
          },
        },
        styles.map((s) => {
          const isSelected = currentStyleId === s.id
          const isSandboxed = s.type === 'sandboxed'

          return h(
            'div',
            {
              key: s.id,
              role: 'button',
              tabIndex: 0,
              'aria-pressed': isSelected,
              'data-testid': `now-playing-style-${s.id}`,
              onClick: () => void handleSelectStyle(s.id),
              onKeyDown: (e: { key: string }) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  void handleSelectStyle(s.id)
                }
              },
              style: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '16px 18px',
                borderRadius: 12,
                border: isSelected
                  ? '2px solid var(--color-primary, #5F87FF)'
                  : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                background: isSelected
                  ? 'var(--surface-selected, rgba(95, 135, 255, 0.12))'
                  : 'var(--surface-1, rgba(255, 255, 255, 0.025))',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                boxShadow: isSelected ? '0 0 16px rgba(95, 135, 255, 0.25)' : 'none',
                position: 'relative',
              },
            },
            // Card Top Row: Icon + Badges
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: isSelected
                      ? 'rgba(95, 135, 255, 0.2)'
                      : 'var(--surface-1, rgba(255, 255, 255, 0.06))',
                    color: isSelected ? 'var(--color-primary, #5F87FF)' : 'var(--text-secondary, #C5CAD8)',
                  },
                },
                tablerIcon(s.icon || 'music', { size: 18 }),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                isSandboxed
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(52, 199, 89, 0.15)',
                          color: '#34C759',
                          letterSpacing: 0.3,
                        },
                      },
                      t('nowPlaying:nowPlayingStyles.sandboxedBadge'),
                    )
                  : h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          fontWeight: 500,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'var(--surface-1, rgba(255, 255, 255, 0.07))',
                          color: 'var(--text-secondary, #8E8E93)',
                        },
                      },
                      t('nowPlaying:nowPlayingStyles.builtinBadge'),
                    ),
                isSelected
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'var(--color-primary, #5F87FF)',
                          color: 'var(--bb-accent-on, #FFFFFF)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        },
                      },
                      tablerIcon('check', { size: 11 }),
                      t('nowPlaying:nowPlayingStyles.inUse'),
                    )
                  : null,
                isSandboxed
                  ? h(
                      'button',
                      {
                        type: 'button',
                        title: t('nowPlaying:nowPlayingStyles.deleteStyle', { name: s.name }),
                        'aria-label': t('nowPlaying:nowPlayingStyles.deleteStyle', { name: s.name }),
                        'data-testid': `delete-style-${s.id}`,
                        onClick: (e: { stopPropagation(): void }) => handleDeleteStyle(e, s.id),
                        style: {
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '3px 5px',
                          borderRadius: 4,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--text-tertiary, #8E8E93)',
                          cursor: 'pointer',
                          transition: 'color 0.15s ease',
                        },
                        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = '#FF453A'
                        },
                        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                          e.currentTarget.style.color = 'var(--text-tertiary, #8E8E93)'
                        },
                      },
                      tablerIcon('trash', { size: 14 }),
                    )
                  : null,
              ),
            ),
            // Card Middle: Name + Description
            h(
              'div',
              { style: { flex: 1 } },
              h(
                'div',
                {
                  style: {
                    fontSize: 14,
                    fontWeight: 600,
                    color: isSelected ? 'var(--text-primary, #FFFFFF)' : 'var(--text-primary, #F2F5FF)',
                    marginBottom: 4,
                  },
                },
                getLocalizedStyleName(t, s),
              ),
              h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: 'var(--text-secondary, #8E8E93)',
                    lineHeight: 1.45,
                  },
                },
                getLocalizedStyleDescription(t, s),
              ),
            ),
            // Card Footer: Author/Version metadata
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: 'var(--text-muted, #636366)',
                  marginTop: 12,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
                },
              },
              s.author
                ? s.version
                  ? t('nowPlaying:nowPlayingStyles.byAuthorVersion', { author: s.author, version: s.version })
                  : t('nowPlaying:nowPlayingStyles.byAuthor', { author: s.author })
                : t('nowPlaying:nowPlayingStyles.official'),
            ),
          )
        }),
      ),
    ),

    // Import Modal Sheet
    h(
      Sheet,
      {
        open: showImportModal,
        onClose: () => {
          setShowImportModal(false)
          setImportError(null)
        },
        title: t('nowPlaying:nowPlayingStyles.importAnExternalNowPlaying'),
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingTop: 4,
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
            h('strong', { style: { color: '#34C759' } }, `${t('nowPlaying:nowPlayingStyles.sandboxIsolation')} `),
            t('nowPlaying:nowPlayingStyles.sandboxDescription'),
          ),
        ),

        // Quick helper toolbar
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
            t('nowPlaying:nowPlayingStyles.pluginManifestFormat'),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'load-sample-template-button',
                onClick: handleLoadSample,
                style: {
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(95, 135, 255, 0.3)',
                  background: 'rgba(95, 135, 255, 0.1)',
                  color: '#7C86FF',
                  cursor: 'pointer',
                },
              },
              t('nowPlaying:nowPlayingStyles.loadSampleTemplate'),
            ),
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'select-file-button',
                onClick: () => fileInputRef.current?.click(),
                style: {
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: 'var(--text-secondary, #C5CAD8)',
                  cursor: 'pointer',
                },
              },
              t('nowPlaying:nowPlayingStyles.chooseJsonFile'),
            ),
          ),
        ),

        h('input', {
          ref: fileInputRef,
          type: 'file',
          accept: '.json,application/json',
          style: { display: 'none' },
          onChange: handleFileChange,
        }),

        h('textarea', {
          value: importJson,
          onChange: (e: { target: { value: string } }) => {
            setImportJson(e.target.value)
            setImportError(null)
          },
          placeholder: t('nowPlaying:nowPlayingStyles.pasteAPluginJSONManifest'),
          'data-testid': 'style-manifest-textarea',
          style: {
            width: '100%',
            height: 180,
            background: 'var(--input-bg, rgba(0, 0, 0, 0.35))',
            border: '1px solid var(--input-border, rgba(255, 255, 255, 0.14))',
            borderRadius: 8,
            padding: 10,
            color: 'var(--text-primary, #FFFFFF)',
            fontFamily: 'monospace',
            fontSize: 12,
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          },
        }),

        importError
          ? h(
              'div',
              {
                'data-testid': 'import-style-error',
                style: {
                  color: '#FF453A',
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'rgba(244, 63, 94, 0.1)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                },
              },
              importError,
            )
          : null,

        // Modal Action Buttons
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 } },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'cancel-import-style',
              onClick: () => {
                setShowImportModal(false)
                setImportError(null)
              },
              style: {
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                background: 'transparent',
                color: 'var(--text-secondary, #C5CAD8)',
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            t('app:common.cancel'),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'submit-import-style',
              onClick: handleImportSubmit,
              style: {
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                color: '#FFFFFF',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              },
            },
            t('nowPlaying:nowPlayingStyles.importAndApply'),
          ),
        ),
      ),
    ),
  )
}
