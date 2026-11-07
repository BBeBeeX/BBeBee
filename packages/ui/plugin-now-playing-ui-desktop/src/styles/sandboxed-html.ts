/**
 * Builds the sandboxed HTML document string with injected window.BBeBeePlayer SDK.
 */
export function buildSandboxedHtml(htmlBody: string): string {
  const sdkScript = `  <script>
    (function() {
      var stateListeners = [];
      var currentState = null;

      window.BBeBeePlayer = {
        getState: function() { return currentState; },
        onSnapshot: function(fn) {
          if (typeof fn === 'function') {
            stateListeners.push(fn);
            if (currentState) {
              try { fn(currentState); } catch(e) { console.error('[BBeBeePlayer] Listener error:', e); }
            }
            return function() {
              var idx = stateListeners.indexOf(fn);
              if (idx !== -1) stateListeners.splice(idx, 1);
            };
          }
        },
        onStateChange: function(fn) {
          return window.BBeBeePlayer.onSnapshot(fn);
        },
        play: function() { window.parent.postMessage({ type: 'action:play' }, '*'); },
        pause: function() { window.parent.postMessage({ type: 'action:pause' }, '*'); },
        togglePlay: function() { window.parent.postMessage({ type: 'action:togglePlay' }, '*'); },
        previous: function() { window.parent.postMessage({ type: 'action:previous' }, '*'); },
        next: function() { window.parent.postMessage({ type: 'action:next' }, '*'); },
        seek: function(ms) {
          if (typeof ms === 'number') {
            window.parent.postMessage({ type: 'action:seek', positionMs: ms }, '*');
          }
        },
        toggleFavorite: function() { window.parent.postMessage({ type: 'action:toggleFavorite' }, '*'); }
      };

      window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'NOW_PLAYING_SNAPSHOT') {
          currentState = data.payload;
          for (var i = 0; i < stateListeners.length; i++) {
            try { stateListeners[i](currentState); } catch(e) { console.error(e); }
          }
        } else if (data.type === 'NOW_PLAYING_TICK') {
          // The host ships volatile fields (position/active line/play state)
          // separately at a throttled cadence; the heavy snapshot is re-sent
          // only when the track or lyrics document actually changes. Merge the
          // tick into the current snapshot so skins keep reading one stable
          // shape from getState()/onSnapshot().
          if (!currentState || !data.payload || typeof data.payload !== 'object') return;
          var tick = data.payload;
          currentState = Object.assign({}, currentState, {
            positionMs: typeof tick.positionMs === 'number' ? tick.positionMs : currentState.positionMs,
            isPlaying: typeof tick.isPlaying === 'boolean' ? tick.isPlaying : currentState.isPlaying,
            lyrics: Object.assign({}, currentState.lyrics, {
              activeIndex: typeof tick.activeIndex === 'number' ? tick.activeIndex : currentState.lyrics.activeIndex
            })
          });
          for (var j = 0; j < stateListeners.length; j++) {
            try { stateListeners[j](currentState); } catch(e) { console.error(e); }
          }
        }
      });

      // Announce readiness to host window
      window.parent.postMessage({ type: 'BBEBEE_SANDBOX_READY' }, '*');
    })();
  </script>`

  const defaultStyles = `  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  </style>`

  const metaReferrer = '  <meta name="referrer" content="no-referrer">'
  const trimmed = htmlBody.trim()
  const isFullDocument = /<html[\s>]/i.test(trimmed) || /<!DOCTYPE/i.test(trimmed)

  if (isFullDocument) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head(\s[^>]*)?>/i, `$&\n${metaReferrer}\n${defaultStyles}\n${sdkScript}`)
    }
    if (/<html[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<html(\s[^>]*)?>/i, `$&\n<head>\n${metaReferrer}\n${defaultStyles}\n${sdkScript}\n</head>`)
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
${metaReferrer}
${defaultStyles}
${sdkScript}
</head>
<body>
${htmlBody}
</body>
</html>`
}
