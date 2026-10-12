/**
 * Builds the sandboxed HTML document string with injected window.BBeBeePlayer SDK.
 */
export function buildSandboxedHtml(htmlBody: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
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
  </style>
  <script>
    (function() {
      var stateListeners = [];
      var currentState = null;

      window.BBeBeePlayer = {
        getState: function() { return currentState; },
        onStateChange: function(fn) {
          if (typeof fn === 'function') {
            stateListeners.push(fn);
            if (currentState) {
              try { fn(currentState); } catch(e) { console.error('[BBeBeePlayer] Listener error:', e); }
            }
          }
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
        if (event.data && event.data.type === 'NOW_PLAYING_SNAPSHOT') {
          currentState = event.data.payload;
          for (var i = 0; i < stateListeners.length; i++) {
            try { stateListeners[i](currentState); } catch(e) { console.error(e); }
          }
        }
      });

      // Announce readiness to host window
      window.parent.postMessage({ type: 'BBEBEE_SANDBOX_READY' }, '*');
    })();
  </script>
</head>
<body>
\${htmlBody}
</body>
</html>`
}
