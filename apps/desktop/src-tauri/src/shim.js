/**
 * Tauri Preload Shim for BBeBee Desktop.
 *
 * Exposes frozen objects `window.BBeBee` and `window.BBeBeeBridge` in 100% 1:1
 * API compatibility with apps/desktop/preload/index.ts.
 * Injected into all Webview windows via Tauri initialization_script.
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.BBeBee && window.BBeBeeBridge) return;

  function invoke(cmd, args) {
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.resolve();
  }

  function addListener(eventName, callback) {
    var disposed = false;
    var unlistenFn = null;

    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      window.__TAURI__.event.listen(eventName, function (event) {
        if (!disposed) callback(event.payload);
      }).then(function (unlisten) {
        if (disposed) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      }).catch(function () {});
    } else {
      var domHandler = function (e) {
        if (!disposed) callback(e.detail);
      };
      window.addEventListener(eventName, domHandler);
      unlistenFn = function () {
        window.removeEventListener(eventName, domHandler);
      };
    }

    return function () {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }

  function deserializeBridgeError(data) {
    var err = new Error((data && data.message) || 'Bridge call failed');
    if (data) {
      if (data.name) err.name = data.name;
      if (data.code) err.code = data.code;
      if (data.errno !== undefined) err.errno = data.errno;
      if (data.syscall) err.syscall = data.syscall;
      if (data.path) err.path = data.path;
      if (data.stack) err.stack = data.stack;
    }
    return err;
  }

  function unwrapBridgeResult(response) {
    if (response && typeof response === 'object' && '__bbebee_bridge__' in response) {
      if (!response.ok) {
        throw deserializeBridgeError(response.error || { message: 'Bridge call failed' });
      }
      return response.result;
    }
    return response;
  }

  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var val = obj[keys[i]];
      if (val !== null && (typeof val === 'object' || typeof val === 'function') && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
    return obj;
  }

  var isDebugMode = (function () {
    if (typeof process !== 'undefined' && process.env) {
      var val = process.env['DEBUG'] || process.env['BBEBEE_DEBUG'];
      if (val === '0' || val === 'false') return false;
      if (val) return true;
      if (process.argv && process.argv.indexOf('--debug') !== -1) return true;
      if (process.env['ELECTRON_RENDERER_URL']) return true;
    }
    if (window.__BBEBEE_DEBUG__) return true;
    return false;
  })();

  var detectedPlatform = (function () {
    if (typeof process !== 'undefined' && process.platform) return process.platform;
    if (typeof navigator !== 'undefined') {
      var ua = navigator.userAgent.toLowerCase();
      if (ua.indexOf('win') !== -1) return 'win32';
      if (ua.indexOf('mac') !== -1) return 'darwin';
      return 'linux';
    }
    return 'linux';
  })();

  var api = {
    paths: {
      get: function (kind) {
        return invoke('desktop_paths_get', { kind: kind }).then(function (res) {
          return res === null ? undefined : res;
        });
      },
    },
    getAppVersion: function () {
      return invoke('desktop_app_version').then(function (res) {
        return typeof res === 'string' ? res : '0.0.0';
      });
    },
    secrets: {
      available: function () {
        return invoke('desktop_secrets_available').then(function (res) {
          return typeof res === 'boolean' ? res : true;
        });
      },
      encrypt: function (plain) {
        return invoke('desktop_secrets_encrypt', { plain: plain });
      },
      decrypt: function (cipher) {
        return invoke('desktop_secrets_decrypt', { cipher: cipher });
      },
    },
    shell: {
      openExternal: function (url) {
        return invoke('desktop_shell_open_external', { url: url });
      },
      openPath: function (path) {
        return invoke('desktop_shell_open_path', { path: path }).then(function (res) {
          return typeof res === 'string' ? res : '';
        });
      },
    },
    dialog: {
      pickDirectory: function () {
        return invoke('desktop_dialog_pick_directory').then(function (res) {
          return res || undefined;
        });
      },
      pickFiles: function (options) {
        return invoke('desktop_dialog_pick_files', { options: options }).then(function (res) {
          return Array.isArray(res) ? res : [];
        });
      },
    },
    files: {
      getPath: function (file) {
        try {
          var p = (file && file.path) || (window.webUtils && typeof window.webUtils.getPathForFile === 'function' ? window.webUtils.getPathForFile(file) : '');
          if (p) {
            invoke('desktop_files_authorize', { path: p }).catch(function () {});
          }
          return p || '';
        } catch (_) {
          return '';
        }
      },
      authorizePath: function (path) {
        return invoke('desktop_files_authorize', { path: path }).then(function (res) {
          return typeof res === 'boolean' ? res : true;
        });
      },
    },
    devtools: {
      open: function () {
        return invoke('desktop_devtools_open');
      },
    },
    plugins: {
      listInstalled: function () {
        return invoke('desktop_plugins_list_installed').then(function (res) {
          return Array.isArray(res) ? res : [];
        });
      },
      getLock: function () {
        return invoke('desktop_plugins_get_lock');
      },
      install: function (pluginId, files) {
        return invoke('desktop_plugins_install', { pluginId: pluginId, files: files });
      },
      uninstall: function (pluginId) {
        return invoke('desktop_plugins_uninstall', { pluginId: pluginId });
      },
    },
    window: {
      minimize: function () {
        return invoke('desktop_window_minimize');
      },
      maximize: function () {
        return invoke('desktop_window_maximize');
      },
      close: function () {
        return invoke('desktop_window_close');
      },
      isMaximized: function () {
        return invoke('desktop_window_is_maximized').then(function (res) {
          return Boolean(res);
        });
      },
      setCloseToTray: function (enabled) {
        return invoke('desktop_window_set_close_to_tray', { enabled: Boolean(enabled) });
      },
      toggle: function () {
        return invoke('desktop_window_toggle');
      },
    },
    proxy: {
      test: function (config) {
        return invoke('desktop_proxy_test', { config: config });
      },
      set: function (config) {
        return invoke('desktop_proxy_set', { config: config });
      },
    },
    stream: {
      setHeaders: function (entry) {
        return invoke('desktop_stream_set_headers', { entry: entry });
      },
    },
    audio: {
      cancelTranscode: function (jobId) {
        return invoke('desktop_audio_transcode_cancel', { jobId: jobId }).then(function (res) {
          return typeof res === 'boolean' ? res : true;
        });
      },
      transcode: function (options, onProgressCallback) {
        if (options && options.signal && options.signal.aborted) {
          return Promise.resolve({ ok: false, error: 'Cancelled' });
        }

        var jobId = options.jobId || ('tc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

        var payload = {
          jobId: jobId,
          inputUri: String(options.inputUri),
          outputUri: String(options.outputUri),
          targetFormat: String(options.targetFormat),
          bitrate: options.bitrate ? String(options.bitrate) : undefined,
          sampleRate: typeof options.sampleRate === 'number' ? options.sampleRate : undefined,
          channels: typeof options.channels === 'number' ? options.channels : undefined,
          bitDepth: typeof options.bitDepth === 'number' ? options.bitDepth : undefined,
          vbr: typeof options.vbr === 'boolean' ? options.vbr : undefined,
          quality: typeof options.quality === 'number' ? options.quality : undefined,
          vbrQuality: typeof options.vbrQuality === 'number' ? options.vbrQuality : undefined,
          volumeGainDb: typeof options.volumeGainDb === 'number' ? options.volumeGainDb : undefined,
          fadeInSeconds: typeof options.fadeInSeconds === 'number' ? options.fadeInSeconds : undefined,
          fadeOutSeconds: typeof options.fadeOutSeconds === 'number' ? options.fadeOutSeconds : undefined,
          startTimeSeconds: typeof options.startTimeSeconds === 'number' ? options.startTimeSeconds : undefined,
          endTimeSeconds: typeof options.endTimeSeconds === 'number' ? options.endTimeSeconds : undefined,
        };

        var progressCb =
          typeof onProgressCallback === 'function'
            ? onProgressCallback
            : typeof options.onProgress === 'function'
              ? options.onProgress
              : undefined;

        var cleanupProgress = undefined;
        if (typeof progressCb === 'function') {
          cleanupProgress = addListener('audio:transcode-progress', function (data) {
            if (data && data.jobId === jobId) {
              try {
                progressCb(data.progress, data.currentTimeSeconds);
              } catch (_) {}
            }
          });
        }

        var cleanupAbort = undefined;
        if (options.signal && typeof options.signal.addEventListener === 'function') {
          var abortHandler = function () {
            invoke('desktop_audio_transcode_cancel', { jobId: jobId }).catch(function () {});
          };
          options.signal.addEventListener('abort', abortHandler, { once: true });
          cleanupAbort = function () {
            try {
              options.signal.removeEventListener('abort', abortHandler);
            } catch (_) {}
          };
        }

        return invoke('desktop_audio_transcode', { options: payload })
          .then(function (res) {
            return res || { ok: true };
          })
          .finally(function () {
            if (cleanupProgress) cleanupProgress();
            if (cleanupAbort) cleanupAbort();
          });
      },
    },
    desktopLyrics: {
      setVisible: function (visible, pos) {
        return invoke('desktop_lyrics_set_visible', { visible: Boolean(visible), position: pos });
      },
      setPosition: function (pos) {
        return invoke('desktop_lyrics_set_position', { position: pos });
      },
      getPosition: function () {
        return invoke('desktop_lyrics_get_position').then(function (res) {
          return res || undefined;
        });
      },
      commitPosition: function (pos) {
        return invoke('desktop_lyrics_commit_position', { position: pos });
      },
      getData: function () {
        return invoke('desktop_lyrics_get_data');
      },
      onMoved: function (callback) {
        return addListener('desktop-lyrics:moved', callback);
      },
      setLocked: function (locked) {
        return invoke('desktop_lyrics_set_locked', { locked: Boolean(locked) });
      },
      setIgnoreMouse: function (ignore) {
        return invoke('desktop_lyrics_set_ignore_mouse', { ignore: Boolean(ignore) });
      },
      onCursor: function (callback) {
        return addListener('desktop-lyrics:cursor', callback);
      },
      updateData: function (data) {
        return invoke('desktop_lyrics_update_data', { data: data });
      },
      sendAction: function (action) {
        return invoke('desktop_lyrics_send_action', { action: action });
      },
      onData: function (callback) {
        return addListener('desktop-lyrics:data', callback);
      },
      onAction: function (callback) {
        return addListener('desktop-lyrics:action', callback);
      },
    },
    taskbar: {
      update: function (state) {
        return invoke('desktop_taskbar_update', { taskbar: state });
      },
      onAction: function (callback) {
        return addListener('taskbar:action', callback);
      },
    },
    miniPlayer: {
      open: function (options) {
        return invoke('desktop_mini_player_open', { options: options });
      },
      close: function () {
        return invoke('desktop_mini_player_close');
      },
      restoreMain: function () {
        return invoke('desktop_mini_player_restore_main');
      },
      setMode: function (mode) {
        return invoke('desktop_mini_player_set_mode', { mode: mode });
      },
      getState: function () {
        return invoke('desktop_mini_player_get_state');
      },
      getData: function () {
        return invoke('desktop_mini_player_get_data');
      },
      updateData: function (data) {
        return invoke('desktop_mini_player_update_data', { data: data });
      },
      sendAction: function (action) {
        return invoke('desktop_mini_player_send_action', { action: action });
      },
      onData: function (callback) {
        return addListener('mini-player:data', callback);
      },
      onState: function (callback) {
        return addListener('mini-player:state', callback);
      },
      onAction: function (callback) {
        return addListener('mini-player:action', callback);
      },
    },
    platform: detectedPlatform,
    locale: {
      getLocale: function () {
        return invoke('desktop_locale_get').then(function (res) {
          return typeof res === 'string' ? res : 'en-US';
        });
      },
      notify: function (locale) {
        return invoke('desktop_locale_notify', { locale: locale });
      },
      onLocaleChange: function (callback) {
        return addListener('locale:changed', callback);
      },
    },
    sandbox: {
      setHtml: function (id, html) {
        return invoke('desktop_sandbox_set_html', { id: id, html: html });
      },
    },
    versions: {
      tauri: '2.12.4',
      webview: '2.12.4',
      node: typeof process !== 'undefined' && process.versions && process.versions.node ? process.versions.node : '22.12.0',
      electron: typeof process !== 'undefined' && process.versions && process.versions.electron ? process.versions.electron : undefined,
    },
    isDebug: isDebugMode,
  };

  var bridge = {
    call: async function (service, method, args, token) {
      var res = await invoke('desktop_bridge_call', {
        service: service,
        method: method,
        args: args || [],
        token: token,
      });
      return unwrapBridgeResult(res);
    },
    streamOpen: function (uri, range) {
      return invoke('bridge_stream_open', { uri: uri, range: range });
    },
    streamPull: function (handle) {
      return invoke('bridge_stream_pull', { handle: handle });
    },
    streamClose: function (handle) {
      return invoke('bridge_stream_close', { handle: handle });
    },
    httpOpen: async function (request) {
      var res = await invoke('bridge_http_open', { request: request });
      return unwrapBridgeResult(res);
    },
    httpPull: async function (handle) {
      var res = await invoke('bridge_http_pull', { handle: handle });
      return unwrapBridgeResult(res);
    },
    httpClose: function (handle) {
      return invoke('bridge_http_close', { handle: handle });
    },
    txBegin: function () {
      return invoke('bridge_tx_begin');
    },
    txEnd: function (token, commit) {
      return invoke('bridge_tx_end', { token: token, commit: commit });
    },
    on: function (handler) {
      return addListener('BBeBee:event', function (payload) {
        if (Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'object' && payload[0] !== null && 'topic' in payload[0]) {
          handler(payload[0]);
        } else {
          handler(payload);
        }
      });
    },
  };

  deepFreeze(api);
  deepFreeze(bridge);

  window.BBeBee = api;
  window.BBeBeeBridge = bridge;
})();
