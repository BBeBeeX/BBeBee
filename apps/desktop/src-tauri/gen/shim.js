/**
 * BBeBee desktop preload shim — GENERATED, do not edit by hand.
 *
 * Source: apps/desktop/renderer/preload-shim.ts
 * Regenerate: pnpm --filter @BBeBee/desktop build:shim
 *
 * Injected into every Tauri webview window via initialization_script,
 * before any page script runs.
 */
"use strict";
var __BBeBeePreloadShim = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // desktop/renderer/preload-shim.ts
  var preload_shim_exports = {};
  __export(preload_shim_exports, {
    createBridgeApi: () => createBridgeApi,
    createPreloadApi: () => createPreloadApi,
    deepFreeze: () => deepFreeze,
    defaultInvoker: () => defaultInvoker,
    defaultListener: () => defaultListener,
    deserializeBridgeError: () => deserializeBridgeError,
    forwardConsoleToRust: () => forwardConsoleToRust,
    installPreloadShim: () => installPreloadShim,
    normalizeBridgeBytes: () => normalizeBridgeBytes,
    unwrapBridgeResult: () => unwrapBridgeResult
  });
  function deserializeBridgeError(data) {
    const err = new Error(data?.message || "Bridge call failed");
    if (data) {
      if (data.name) err.name = data.name;
      if (data.code) err.code = data.code;
      if (data.errno !== void 0) err.errno = data.errno;
      if (data.syscall) err.syscall = data.syscall;
      if (data.path) err.path = data.path;
      if (data.stack) err.stack = data.stack;
    }
    return err;
  }
  function unwrapBridgeResult(response) {
    if (response && typeof response === "object" && "__bbebee_bridge__" in response) {
      const env = response;
      if (!env.ok) {
        throw deserializeBridgeError(env.error ?? { message: "Bridge call failed" });
      }
      return env.result;
    }
    return response;
  }
  function normalizeBridgeBytes(val) {
    if (val === null || val === void 0) return null;
    if (val instanceof Uint8Array) return val;
    if (ArrayBuffer.isView(val)) {
      return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    }
    if (val instanceof ArrayBuffer) {
      return new Uint8Array(val);
    }
    if (typeof val === "string") {
      try {
        const bin = atob(val);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      } catch {
        return new TextEncoder().encode(val);
      }
    }
    if (typeof val === "object") {
      const obj = val;
      if (obj["type"] === "Buffer" && Array.isArray(obj["data"])) {
        return new Uint8Array(obj["data"]);
      }
      if (Array.isArray(val)) {
        return new Uint8Array(val);
      }
      const len = typeof obj["length"] === "number" ? obj["length"] : Object.keys(obj).length;
      if (len === 0) return new Uint8Array(0);
      if (typeof obj[0] === "number" || typeof obj["0"] === "number") {
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          arr[i] = Number(obj[i]);
        }
        return arr;
      }
    }
    return null;
  }
  function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== null && (typeof val === "object" || typeof val === "function") && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
    return obj;
  }
  function defaultInvoker(cmd, args) {
    const w = typeof window !== "undefined" ? window : void 0;
    if (w?.__TAURI_INTERNALS__?.invoke) {
      return w.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (w?.__TAURI__?.core?.invoke) {
      return w.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.resolve();
  }
  function defaultListener(eventName, callback) {
    let disposed = false;
    let unlistenFn = null;
    const w = typeof window !== "undefined" ? window : void 0;
    if (w?.__TAURI__?.event?.listen) {
      w.__TAURI__.event.listen(eventName, (event) => {
        if (!disposed) callback(event.payload);
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      }).catch(() => {
      });
    } else if (typeof window !== "undefined") {
      const domHandler = (e) => {
        if (!disposed) callback(e.detail);
      };
      window.addEventListener(eventName, domHandler);
      unlistenFn = () => {
        window.removeEventListener(eventName, domHandler);
      };
    }
    return () => {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }
  function createPreloadApi(invoke = defaultInvoker, addListener = defaultListener) {
    const isDebugMode = (() => {
      if (typeof process !== "undefined" && process.env) {
        const val = process.env["DEBUG"] ?? process.env["BBEBEE_DEBUG"];
        if (val === "0" || val === "false") return false;
        if (val) return true;
        if (process.argv?.includes?.("--debug")) return true;
        if (process.env["TAURI_ENV_DEBUG"] || process.env["VITE_DEV_SERVER_URL"]) return true;
      }
      if (typeof window !== "undefined" && window.__BBEBEE_DEBUG__) return true;
      return false;
    })();
    const detectedPlatform = (() => {
      if (typeof process !== "undefined" && process.platform) {
        const p = process.platform;
        if (p === "win32" || p === "darwin") return p;
        return "linux";
      }
      if (typeof navigator !== "undefined") {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("win")) return "win32";
        if (ua.includes("mac")) return "darwin";
        return "linux";
      }
      return "linux";
    })();
    const api = {
      app: {
        restart: () => invoke("desktop_app_restart")
      },
      paths: {
        get: (kind) => invoke("desktop_paths_get", { kind }).then((res) => res === null ? void 0 : res)
      },
      getAppVersion: () => invoke("desktop_app_version").then((res) => typeof res === "string" ? res : "0.0.0"),
      secrets: {
        available: () => invoke("desktop_secrets_available").then((res) => typeof res === "boolean" ? res : true),
        encrypt: (plain) => invoke("desktop_secrets_encrypt", { plain }),
        decrypt: (cipher) => invoke("desktop_secrets_decrypt", { cipher })
      },
      shell: {
        openExternal: (url) => invoke("desktop_shell_open_external", { url }),
        openPath: (path) => invoke("desktop_shell_open_path", { path }).then((res) => typeof res === "string" ? res : "")
      },
      dialog: {
        pickDirectory: () => invoke("desktop_dialog_pick_directory").then((res) => res || void 0),
        pickFiles: (options) => invoke("desktop_dialog_pick_files", { options }).then((res) => Array.isArray(res) ? res : [])
      },
      files: {
        getPath: (file) => {
          try {
            const p = file?.path || (typeof window?.webUtils?.getPathForFile === "function" ? window.webUtils.getPathForFile(file) : "");
            if (p) {
              void invoke("desktop_files_authorize", { path: p }).catch(() => {
              });
            }
            return p || "";
          } catch {
            return "";
          }
        },
        authorizePath: (path) => invoke("desktop_files_authorize", { path }).then((res) => typeof res === "boolean" ? res : true),
        toServableUrl: (uri) => {
          try {
            if (typeof uri !== "string" || !uri.startsWith("bbebee-file:")) return uri;
            if (detectedPlatform === "win32") {
              const rest = uri.replace(/^bbebee-file:/, "").replace(/^\/+/, "").replace(/^localhost\//, "");
              return `http://bbebee-file.localhost/${rest}`;
            }
            if (detectedPlatform === "linux") {
              if (uri.startsWith("bbebee-file:///")) {
                return "bbebee-file://localhost/" + uri.slice("bbebee-file:///".length);
              }
            }
            return uri;
          } catch {
            return uri;
          }
        }
      },
      devtools: {
        open: () => invoke("desktop_devtools_open")
      },
      plugins: {
        listInstalled: () => invoke("desktop_plugins_list_installed").then((res) => Array.isArray(res) ? res : []),
        getLock: () => invoke("desktop_plugins_get_lock"),
        install: (pluginId, files) => invoke("desktop_plugins_install", { pluginId, files }),
        uninstall: (pluginId) => invoke("desktop_plugins_uninstall", { pluginId })
      },
      window: {
        minimize: () => invoke("desktop_window_minimize"),
        maximize: () => invoke("desktop_window_maximize"),
        close: () => invoke("desktop_window_close"),
        isMaximized: () => invoke("desktop_window_is_maximized").then((res) => Boolean(res)),
        setCloseToTray: (enabled) => invoke("desktop_window_set_close_to_tray", { enabled: Boolean(enabled) }),
        toggle: () => invoke("desktop_window_toggle")
      },
      proxy: {
        test: (config) => invoke("desktop_proxy_test", { config }),
        set: (config) => invoke("desktop_proxy_set", { config })
      },
      stream: {
        setHeaders: (entry) => invoke("desktop_stream_set_headers", { entry })
      },
      audio: {
        cancelTranscode: (jobId) => invoke("desktop_audio_transcode_cancel", { jobId }).then(
          (res) => typeof res === "boolean" ? res : true
        ),
        transcode: (options, onProgressCallback) => {
          if (options.signal?.aborted) {
            return Promise.resolve({ ok: false, error: "Cancelled" });
          }
          const jobId = options.jobId || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const payload = {
            jobId,
            inputUri: String(options.inputUri),
            outputUri: String(options.outputUri),
            targetFormat: String(options.targetFormat),
            bitrate: options.bitrate ? String(options.bitrate) : void 0,
            sampleRate: typeof options.sampleRate === "number" ? options.sampleRate : void 0,
            channels: typeof options.channels === "number" ? options.channels : void 0,
            bitDepth: typeof options.bitDepth === "number" ? options.bitDepth : void 0,
            vbr: typeof options.vbr === "boolean" ? options.vbr : void 0,
            quality: typeof options.quality === "number" ? options.quality : void 0,
            vbrQuality: typeof options.vbrQuality === "number" ? options.vbrQuality : void 0,
            volumeGainDb: typeof options.volumeGainDb === "number" ? options.volumeGainDb : void 0,
            fadeInSeconds: typeof options.fadeInSeconds === "number" ? options.fadeInSeconds : void 0,
            fadeOutSeconds: typeof options.fadeOutSeconds === "number" ? options.fadeOutSeconds : void 0,
            startTimeSeconds: typeof options.startTimeSeconds === "number" ? options.startTimeSeconds : void 0,
            endTimeSeconds: typeof options.endTimeSeconds === "number" ? options.endTimeSeconds : void 0
          };
          const progressCb = typeof onProgressCallback === "function" ? onProgressCallback : typeof options.onProgress === "function" ? options.onProgress : void 0;
          let cleanupProgress;
          if (typeof progressCb === "function") {
            cleanupProgress = addListener("audio:transcode-progress", (data) => {
              if (data && data.jobId === jobId) {
                try {
                  progressCb(data.progress, data.currentTimeSeconds);
                } catch {
                }
              }
            });
          }
          let cleanupAbort;
          if (options.signal && typeof options.signal.addEventListener === "function") {
            const abortHandler = () => {
              void invoke("desktop_audio_transcode_cancel", { jobId }).catch(() => {
              });
            };
            options.signal.addEventListener("abort", abortHandler, { once: true });
            cleanupAbort = () => {
              try {
                options.signal?.removeEventListener("abort", abortHandler);
              } catch {
              }
            };
          }
          return invoke("desktop_audio_transcode", { options: payload }).then((res) => res || { ok: true }).finally(() => {
            cleanupProgress?.();
            cleanupAbort?.();
          });
        }
      },
      desktopLyrics: {
        setVisible: (visible, pos) => invoke("desktop_lyrics_set_visible", { visible: Boolean(visible), position: pos }),
        getData: () => invoke("desktop_lyrics_get_data"),
        onMoved: (callback) => addListener("desktop-lyrics:moved", callback),
        setLocked: (locked) => invoke("desktop_lyrics_set_locked", { locked: Boolean(locked) }),
        setIgnoreMouse: (ignore) => invoke("desktop_lyrics_set_ignore_mouse", { ignore: Boolean(ignore) }),
        onCursor: (callback) => addListener("desktop-lyrics:cursor", callback),
        updateData: (data) => invoke("desktop_lyrics_update_data", { data }),
        sendAction: (action) => invoke("desktop_lyrics_send_action", { action }),
        onData: (callback) => addListener("desktop-lyrics:data", callback),
        onAction: (callback) => addListener("desktop-lyrics:action", callback)
      },
      taskbar: {
        update: (state) => invoke("desktop_taskbar_update", { taskbar: state }),
        onAction: (callback) => addListener("taskbar:action", callback)
      },
      miniPlayer: {
        open: (options) => invoke("desktop_mini_player_open", { options }),
        close: () => invoke("desktop_mini_player_close"),
        restoreMain: () => invoke("desktop_mini_player_restore_main"),
        setMode: (mode) => invoke("desktop_mini_player_set_mode", { mode }),
        getState: () => invoke("desktop_mini_player_get_state"),
        getData: () => invoke("desktop_mini_player_get_data"),
        updateData: (data) => invoke("desktop_mini_player_update_data", { data }),
        sendAction: (action) => invoke("desktop_mini_player_send_action", { action }),
        onData: (callback) => addListener("mini-player:data", callback),
        onState: (callback) => addListener("mini-player:state", callback),
        onAction: (callback) => addListener("mini-player:action", callback)
      },
      platform: detectedPlatform,
      locale: {
        getLocale: () => invoke("desktop_locale_get").then((res) => typeof res === "string" ? res : "en-US"),
        notify: (locale) => invoke("desktop_locale_notify", { locale }),
        onLocaleChange: (callback) => addListener("locale:changed", callback)
      },
      sandbox: {
        setHtml: (id, html) => invoke("desktop_sandbox_set_html", { id, html })
      },
      versions: {
        tauri: "2.12.4",
        webview: "2.12.4",
        node: typeof process !== "undefined" && process.versions?.node ? process.versions.node : "22.12.0"
      },
      isDebug: isDebugMode
    };
    return deepFreeze(api);
  }
  function createBridgeApi(invoke = defaultInvoker, addListener = defaultListener) {
    const bridge = {
      call: async (service, method, args, token) => {
        const res = await invoke("desktop_bridge_call", {
          service,
          method,
          args: args || [],
          token
        });
        return unwrapBridgeResult(res);
      },
      streamOpen: (uri, range) => invoke("bridge_stream_open", { uri, range }),
      streamPull: (handle) => invoke("bridge_stream_pull", { handle }).then((res) => {
        const unwrap = unwrapBridgeResult(res);
        return normalizeBridgeBytes(unwrap);
      }),
      streamClose: (handle) => invoke("bridge_stream_close", { handle }),
      httpOpen: async (request) => {
        const res = await invoke("bridge_http_open", { request });
        return unwrapBridgeResult(res);
      },
      httpPull: async (handle) => {
        const res = await invoke("bridge_http_pull", { handle });
        const unwrap = unwrapBridgeResult(res);
        return normalizeBridgeBytes(unwrap);
      },
      httpClose: (handle) => invoke("bridge_http_close", { handle }),
      txBegin: () => invoke("bridge_tx_begin"),
      txEnd: (token, commit) => invoke("bridge_tx_end", { token, commit }),
      on: (handler) => {
        return addListener("BBeBee:event", (payload) => {
          if (Array.isArray(payload) && payload.length === 1 && typeof payload[0] === "object" && payload[0] !== null && "topic" in payload[0]) {
            handler(payload[0]);
          } else {
            handler(payload);
          }
        });
      }
    };
    return deepFreeze(bridge);
  }
  function forwardConsoleToRust() {
    try {
      if (typeof window === "undefined") return;
      const w = window;
      const send = (level, args) => {
        try {
          const message = args.map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          }).join(" ").slice(0, 2e3);
          const invoke = w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.core?.invoke;
          if (typeof invoke === "function") {
            void invoke("desktop_console_forward", { level, message });
          }
        } catch {
        }
      };
      const origError = console.error.bind(console);
      const origWarn = console.warn.bind(console);
      console.error = (...args) => {
        send("error", args);
        origError(...args);
      };
      console.warn = (...args) => {
        send("warn", args);
        origWarn(...args);
      };
      window.addEventListener(
        "error",
        (e) => {
          const target = e.target;
          if (target && target !== window) {
            const el = target;
            send("error", [
              `Resource failed to load: ${target.tagName} src="${el.src || target.href || ""}"`
            ]);
          } else if (e.message) {
            const err = e.error;
            const stack = typeof err?.stack === "string" ? err.stack : "";
            send("error", [stack ? `${e.message}
${stack}` : e.message]);
          }
        },
        true
      );
    } catch {
    }
  }
  function installPreloadShim(target = typeof window !== "undefined" ? window : void 0) {
    if (!target) return void 0;
    forwardConsoleToRust();
    if (!target.BBeBee) {
      target.BBeBee = createPreloadApi();
    }
    if (!target.BBeBeeBridge) {
      target.BBeBeeBridge = createBridgeApi();
    }
    return { api: target.BBeBee, bridge: target.BBeBeeBridge };
  }
  if (typeof window !== "undefined") {
    installPreloadShim(window);
  }
  return __toCommonJS(preload_shim_exports);
})();
