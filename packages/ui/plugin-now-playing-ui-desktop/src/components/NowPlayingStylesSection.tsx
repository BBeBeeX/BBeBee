import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, NowPlayingService, NowPlayingStyleMeta } from '@BBeBee/protocol'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { SettingsSection } from '../SettingsSection.js'

export interface NowPlayingStylesSectionProps {
  ctx?: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
}

const SAMPLE_PLUGIN_MANIFEST = JSON.stringify(
  {
    id: 'sample-neon-player',
    name: '霓虹沙箱播放器',
    description: '外部 HTML 动态沙箱模板，具备完整封面、歌词、进度拖拽与基础控制功能',
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
        <div id="title" class="title">等待播放</div>
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
        <button id="prev" class="btn" title="上一曲">⏮</button>
        <button id="play" class="btn btn-play" title="播放/暂停">▶</button>
        <button id="next" class="btn" title="下一曲">⏭</button>
        <button id="fav" class="btn btn-fav" title="添加至我喜欢">♥</button>
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
    if (window.BBeBeePlayer) {
      window.BBeBeePlayer.onSnapshot((data) => {
        lastSnapshot = data;
        document.getElementById('title').textContent = data.title || '未知曲目';
        document.getElementById('artist').textContent = data.artist || '未知艺人';
        const coverEl = document.getElementById('cover');
        const phEl = document.getElementById('cover-ph');
        if (data.cover) {
          coverEl.src = data.cover;
          coverEl.style.display = 'block';
          if (phEl) phEl.style.display = 'none';
          document.getElementById('ambient').style.backgroundImage = 'url(' + data.cover + ')';
        } else {
          coverEl.style.display = 'none';
          if (phEl) phEl.style.display = 'inline';
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
        const currentLine = data.lyrics && data.lyrics.lines && data.lyrics.activeIndex >= 0
          ? data.lyrics.lines[data.lyrics.activeIndex]?.text
          : '';
        document.getElementById('lyric').textContent = currentLine || '...';
      });
      document.getElementById('play').onclick = () => window.BBeBeePlayer.togglePlay();
      document.getElementById('prev').onclick = () => window.BBeBeePlayer.previous();
      document.getElementById('next').onclick = () => window.BBeBeePlayer.next();
      document.getElementById('fav').onclick = () => window.BBeBeePlayer.toggleFavorite();
      document.getElementById('progress-bg').onclick = (e) => {
        if (!lastSnapshot || !lastSnapshot.durationMs) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        window.BBeBeePlayer.seek(ratio * lastSnapshot.durationMs);
      };
    }
  </script>
</body>
</html>`,
  },
  null,
  2,
)

export function NowPlayingStylesSection({
  ctx,
  settings,
  update,
}: NowPlayingStylesSectionProps): ReactElement {
  const nowPlayingService = ctx ? serviceOf<NowPlayingService>(ctx, 'nowPlaying') : undefined

  const [styles, setStyles] = useState<readonly NowPlayingStyleMeta[]>(() => {
    return nowPlayingService?.getStyles?.() ?? NOW_PLAYING_STYLES
  })

  const [showImportModal, setShowImportModal] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const currentStyleId = settings.nowPlayingStyle ?? nowPlayingService?.getStyle?.() ?? 'classic'

  const handleSelectStyle = async (id: string) => {
    await update({ nowPlayingStyle: id })
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
      setImportError('读取文件失败')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleLoadSample = () => {
    setImportJson(SAMPLE_PLUGIN_MANIFEST)
    setImportError(null)
  }

  const handleImportSubmit = async () => {
    try {
      if (!importJson.trim()) {
        throw new Error('请输入或选择播放页模板插件 JSON 清单')
      }
      const parsed = JSON.parse(importJson) as Partial<NowPlayingStyleMeta>
      if (!parsed || typeof parsed !== 'object') throw new Error('无效的 JSON 格式')
      if (!parsed.id || typeof parsed.id !== 'string') throw new Error('缺少插件 id 字段')
      if (!parsed.name || typeof parsed.name !== 'string') throw new Error('缺少插件 name 字段')
      if (!parsed.htmlContent || typeof parsed.htmlContent !== 'string') {
        throw new Error('缺少插件 htmlContent 页面内容')
      }

      const cleanId = parsed.id.trim()
      const isBuiltinConflict = NOW_PLAYING_STYLES.some((b) => b.id === cleanId)
      if (isBuiltinConflict) {
        throw new Error(`插件 ID "${cleanId}" 与内置官方样式冲突，请更换 id`)
      }

      const newStyle: NowPlayingStyleMeta = {
        id: cleanId,
        name: parsed.name.trim(),
        description: parsed.description ? parsed.description.trim() : '用户自定义导入的沙箱播放页模板',
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
    SettingsSection,
    {
      id: 'section-now-playing-styles',
      title: '播放页样式模板 (Now Playing Layout Styles)',
      description: '选择全屏播放页呈现布局，支持原生内置样式与动态导入第三方沙箱模板插件',
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 4px',
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
          },
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: '#F5F5F7' } }, '界面布局'),
          h(
            'div',
            { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.45 } },
            `已加载 ${styles.length} 套样式模板 · 当前使用: ${styles.find((s) => s.id === currentStyleId)?.name ?? currentStyleId}`,
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
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--text-secondary, #C5CAD8)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--color-primary, #5F87FF)'
              e.currentTarget.style.color = '#FFFFFF'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.borderColor = 'var(--border-default, rgba(255, 255, 255, 0.25))'
              e.currentTarget.style.color = 'var(--text-secondary, #C5CAD8)'
            },
          },
          tablerIcon('plus', { size: 14 }),
          '导入样式插件',
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
                  : 'rgba(255, 255, 255, 0.025)',
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
                      : 'rgba(255, 255, 255, 0.06)',
                    color: isSelected ? 'var(--color-primary, #5F87FF)' : '#C5CAD8',
                  },
                },
                tablerIcon(s.icon || 'layout', { size: 18 }),
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
                      '沙箱 🛡️',
                    )
                  : h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          fontWeight: 500,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(255, 255, 255, 0.07)',
                          color: '#8E8E93',
                        },
                      },
                      '内置',
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
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        },
                      },
                      tablerIcon('check', { size: 11 }),
                      '使用中',
                    )
                  : null,
                isSandboxed
                  ? h(
                      'button',
                      {
                        type: 'button',
                        title: `删除 ${s.name}`,
                        'aria-label': `删除 ${s.name}`,
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
                    color: isSelected ? '#FFFFFF' : '#F2F5FF',
                    marginBottom: 4,
                  },
                },
                s.name,
              ),
              h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: '#8E8E93',
                    lineHeight: 1.45,
                  },
                },
                s.description,
              ),
            ),
            // Card Footer: Author/Version metadata
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: '#636366',
                  marginTop: 12,
                  paddingTop: 8,
                  borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                },
              },
              s.author ? `by ${s.author}${s.version ? ` · v${s.version}` : ''}` : '官方提供',
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
        title: '导入外部播放页样式插件',
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
            h('strong', { style: { color: '#34C759' } }, '沙箱隔离保障：'),
            '外部播放页插件在严格无同源权限的 iframe 沙箱中运行，无母应用 DOM、本地存储或任意网络访问权限。插件仅通过白名单接收当前曲目的封面、主题色、标题、歌词与进度等基础数据。',
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
            '插件清单文件格式 (JSON):',
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
              '载入示例模板',
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
              '选择 JSON 文件',
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
          placeholder: '在此粘贴包含 id, name, htmlContent 的插件 JSON 清单...',
          'data-testid': 'style-manifest-textarea',
          style: {
            width: '100%',
            height: 180,
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-default, rgba(255, 255, 255, 0.14))',
            borderRadius: 8,
            padding: 10,
            color: '#FFFFFF',
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
            '取消',
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
            '导入并启用',
          ),
        ),
      ),
    ),
  )
}
