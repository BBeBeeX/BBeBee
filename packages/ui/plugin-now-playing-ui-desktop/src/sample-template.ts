import type { I18nService } from '@BBeBee/protocol'

export const SAMPLE_NEON_PLAYER_ID = 'sample-neon-player'
export const SAMPLE_NEON_PLAYER_VERSION = '1.2.0'

export function buildSamplePluginManifest(t: I18nService['t']): string {
  return JSON.stringify(
    {
      id: SAMPLE_NEON_PLAYER_ID,
      name: 'Neon Sandbox Player',
      description: t('nowPlaying:nowPlayingStyles.externalHTMLDynamicSandboxTemplate'),
      author: 'BBeBee Community',
      version: SAMPLE_NEON_PLAYER_VERSION,
      htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="no-referrer" />
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
      <img id="cover" class="cover-img" src="" alt="" referrerpolicy="no-referrer" style="display:none;" />
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

    function renderSnapshot(data) {
      if (!data) return;
      lastSnapshot = data;
      document.getElementById('title').textContent = data.title || '${t('nowPlaying:nowPlaying.nothingPlaying')}';
      document.getElementById('artist').textContent = data.artist || '-';
      if (data.cover) {
        coverEl.referrerPolicy = 'no-referrer';
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
        } else {
          currentLine = data.lyrics.lines[0]?.text || '♪ ♫ ♪';
        }
      }
      document.getElementById('lyric').textContent = currentLine || '...';
    }

    if (window.BBeBeePlayer) {
      window.BBeBeePlayer.onSnapshot(renderSnapshot);
      document.getElementById('play').onclick = () => window.BBeBeePlayer.togglePlay();
      document.getElementById('prev').onclick = () => window.BBeBeePlayer.previous();
      document.getElementById('next').onclick = () => window.BBeBeePlayer.next();
      document.getElementById('fav').onclick = () => window.BBeBeePlayer.toggleFavorite();
      document.getElementById('progress-bg').onclick = (e) => {
        const snap = lastSnapshot || (window.BBeBeePlayer && window.BBeBeePlayer.getState());
        if (!snap || !snap.durationMs) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        window.BBeBeePlayer.seek(Math.round(ratio * snap.durationMs));
      };
      const initial = window.BBeBeePlayer.getState();
      if (initial) renderSnapshot(initial);
    }
  </script>
</body>
</html>`,
    },
    null,
    2,
  )
}
