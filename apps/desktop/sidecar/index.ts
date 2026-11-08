/**
 * BBeBee Node.js Headless Sidecar
 *
 * Hosts Core Services (@bbebee/core-desktop-bridge/main, core-fs-desktop, core-db-desktop,
 * core-paths-desktop), Audio Engine Supervisor, FFmpeg Transcoding, and Custom Protocol Handlers.
 *
 * Transport: Standard Input / Standard Output framed NDJSON (stdio JSON-RPC 2.0).
 * All diagnostics and application logs are isolated strictly to stderr.
 */

import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import readline from 'node:readline'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { fetch as undiciFetch } from 'undici'
import type { RequestInit as UndiciRequestInit } from 'undici'
import {
  createHost,
  type Host,
  type IpcHost,
  type HttpFetchResponse,
  type BridgeLogger,
  type SystemHost,
} from '@bbebee/core-desktop-bridge/main'
import { CH } from '@bbebee/core-desktop-bridge/protocol'
import { httpProxyUrl } from '@BBeBee/protocol'
import { createAudioHost, type AudioHostApi } from './audio/index.js'
import { listInstalledPlugins, removePluginFiles, writePluginFilesAtomic } from './installed-plugins.js'
import { ProtocolManager } from './protocols.js'
import { ProxyRegistry, describeProxy } from './proxy.js'
import { StreamRelay } from './relay.js'
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './types.js'

// Strictly isolate standard output for NDJSON JSON-RPC messages only.
console.log = (...args: unknown[]) => {
  process.stderr.write(`[sidecar:log] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`)
}
console.info = (...args: unknown[]) => {
  process.stderr.write(`[sidecar:info] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`)
}

import { resolveSystemPath } from '@BBeBee/core-paths-desktop'

export interface SidecarContext {
  host: Host
  ipc: IpcHost
  audioHost: AudioHostApi
  protocolManager: ProtocolManager
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
  shutdown: () => Promise<void>
  writeRaw: (msg: JsonRpcResponse | JsonRpcNotification) => void
}

export async function createSidecar(): Promise<SidecarContext> {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

  function writeRaw(msg: JsonRpcResponse | JsonRpcNotification): void {
    process.stdout.write(JSON.stringify(msg) + '\n')
  }

  function broadcast(channel: string, payload: unknown): void {
    writeRaw({
      jsonrpc: '2.0',
      method: channel,
      params: [payload],
    })
  }

  const ipc: IpcHost = {
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    },
    broadcast,
  }

  const isDebug = Boolean(
    process.env['DEBUG'] ||
      process.env['BBEBEE_DEBUG'] ||
      process.argv.includes('--debug'),
  )

  const logger: BridgeLogger = {
    info: (msg, ...args) =>
      process.stderr.write(`[sidecar:bridge:INFO] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    warn: (msg, ...args) =>
      process.stderr.write(`[sidecar:bridge:WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    error: (msg, ...args) =>
      process.stderr.write(`[sidecar:bridge:ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    debug: (msg, ...args) => {
      if (isDebug) {
        process.stderr.write(`[sidecar:bridge:DEBUG] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
      }
    },
  }

  const audioLogger = {
    info: (msg: string, ...args: unknown[]) =>
      process.stderr.write(`[sidecar:audio:INFO] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    warn: (msg: string, ...args: unknown[]) =>
      process.stderr.write(`[sidecar:audio:WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    error: (msg: string, ...args: unknown[]) =>
      process.stderr.write(`[sidecar:audio:ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`),
    debug: (msg: string, ...args: unknown[]) => {
      if (isDebug) {
        process.stderr.write(`[sidecar:audio:DEBUG] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`)
      }
    },
  }

  // Holds the proxy config the shell pushed (from the settings store plus the
  // secrets-held password — never from the renderer) and turns it into the
  // undici dispatcher marked requests and relayed streams are routed through.
  const proxyRegistry = new ProxyRegistry()
  // The loopback relay that gives audio-engine builds without per-load proxy
  // support a proxy-routed stream: the engine plays
  // `http://127.0.0.1:<port>/s/<token>`, this side fetches the real upstream
  // (through the proxy when the entry says so). Retires once the pinned
  // engine floor honours `proxyUrl` (see docs/audio/engine.md §proxy).
  const relay = new StreamRelay(() => proxyRegistry.dispatcher, logger)
  const audioHost = createAudioHost(audioLogger, {
    async resolve({ url, headers }) {
      const config = proxyRegistry.config
      // No dialable config: the wish goes direct, headers on the request.
      if (!config) return { url, headers }
      // socks5 stays on the relay — mpv/ffmpeg's http-proxy socks support is
      // not something we rely on — and so do engine builds that never
      // advertised per-load proxy support (they would silently ignore the
      // option and play direct, which is the one failure a blocked host
      // cannot recover from).
      if (config.protocol === 'socks5' || !audioHost.supervisor.isProxySupported()) {
        const relayed = await relay.register({ url, headers, useProxy: true })
        return { url: relayed, headers: undefined }
      }
      return { url, headers, proxyUrl: httpProxyUrl(config) }
    },
  })
  const userDataDir = resolveSystemPath('userData')
  const protocolManager = new ProtocolManager()

  const wakeLocks = new Map<number, string>()
  const registeredHotkeys = new Set<string>()
  let isMediaKeysWatching = false
  let currentNowPlayingData: unknown = undefined
  let currentPlaybackState = 'stopped'
  let currentPositionMs = 0
  let currentSupportedCommands: string[] = ['play', 'pause', 'next', 'previous']

  const system: Required<SystemHost> = {
    acquireWakeLock: (id, reason) => {
      wakeLocks.set(id, reason)
      ipc.broadcast?.('system:acquireWakeLock', { id, reason })
    },
    releaseWakeLock: (id) => {
      wakeLocks.delete(id)
      ipc.broadcast?.('system:releaseWakeLock', { id })
    },
    watchMediaKeys: (on) => {
      isMediaKeysWatching = Boolean(on)
      ipc.broadcast?.('system:watchMediaKeys', { on: isMediaKeysWatching })
    },
    registerHotkey: (accelerator) => {
      registeredHotkeys.add(accelerator)
      ipc.broadcast?.('system:registerHotkey', { accelerator })
    },
    unregisterHotkey: (accelerator) => {
      registeredHotkeys.delete(accelerator)
      ipc.broadcast?.('system:unregisterHotkey', { accelerator })
    },
    publishNowPlaying: (nowPlaying) => {
      currentNowPlayingData = nowPlaying
      ipc.broadcast?.('system:publishNowPlaying', nowPlaying)
    },
    publishPlaybackState: (state) => {
      currentPlaybackState = state
      ipc.broadcast?.('system:publishPlaybackState', { state })
    },
    setSupportedCommands: (commands) => {
      currentSupportedCommands = [...commands]
      ipc.broadcast?.('system:setSupportedCommands', { commands })
    },
    clearNowPlaying: () => {
      currentNowPlayingData = undefined
      currentPlaybackState = 'stopped'
      ipc.broadcast?.('system:clearNowPlaying', {})
    },
  }

  const host = await createHost(ipc, {
    appName: 'BBeBee',
    resolvePath: (kind) => resolveSystemPath(kind),
    databaseFileName: process.env['BBEBEE_DB_NAME'] ?? 'BBeBee.db',
    httpFetch: async (input, init) => {
      /*
       * Two transports: a request marked `proxy` (the non-standard init field
       * `ctx.http` sets for requests the settings routed to a proxy) goes
       * through the configured proxy via undici's dispatcher; everything else
       * is Node's own fetch. The config the marker resolves against is *this*
       * side's — pushed through `proxy:set` — so a marked request with no
       * stored config simply goes direct.
       */
      const dispatcher = proxyRegistry.dispatcher
      if ((init as { proxy?: boolean })['proxy'] === true && dispatcher) {
        const res = await undiciFetch(String(input), {
          ...(init as RequestInit),
          dispatcher,
        } as unknown as UndiciRequestInit)
        return res as unknown as HttpFetchResponse
      }
      const res = await globalThis.fetch(input, init as RequestInit)
      return res as unknown as HttpFetchResponse
    },
    system,
    audio: audioHost,
    logger,
  })

  // Wrap CH.call to provide 100% backend support and method alias translation for bridged 'system' service
  const baseBridgeCall = handlers.get(CH.call)!
  handlers.set(CH.call, async (caller, ...callParams) => {
    const [service, initialMethod, initialArgs, token] = callParams as [
      string,
      string,
      unknown[],
      string | undefined,
    ]
    let method = initialMethod
    let callArgs = initialArgs
    if (service === 'system') {
      const argsArray = Array.isArray(callArgs) ? callArgs : []
      if (method === 'registerMediaKey') {
        method = 'watchMediaKeys'
        callArgs = [true]
      } else if (method === 'unregisterAllHotkeys') {
        method = 'watchMediaKeys'
        callArgs = [false]
        registeredHotkeys.clear()
        ipc.broadcast?.('system:unregisterAllHotkeys', {})
      } else if (method === 'mediaSessionUpdate') {
        method = 'publishNowPlaying'
      } else if (method === 'mediaSessionSetPlaybackState') {
        method = 'publishPlaybackState'
      } else if (method === 'mediaSessionSetPosition') {
        currentPositionMs = Number(argsArray[0]) || 0
        ipc.broadcast?.('system:mediaSessionSetPosition', { positionMs: currentPositionMs })
        return { __bbebee_bridge__: true, ok: true, result: undefined }
      } else if (method === 'powerSaveBlocker') {
        method = 'acquireWakeLock'
        const reason = (argsArray[0] as string) || 'prevent-app-suspension'
        callArgs = [1, reason]
      }
    }
    return baseBridgeCall(caller, service, method, callArgs, token)
  })

  // Wire extra sidecar channels
  ipc.handle('paths:get', async (_event, kind: string) => {
    return resolveSystemPath(kind)
  })

  // Secrets management (Handled natively by Tauri Rust Shell via keyring + AES-256-GCM)
  ipc.handle('secrets:available', async () => false)
  ipc.handle('secrets:encrypt', async () => {
    throw new Error('secrets: sidecar does not handle secrets (delegated natively to Tauri shell)')
  })
  ipc.handle('secrets:decrypt', async () => {
    throw new Error('secrets: sidecar does not handle secrets (delegated natively to Tauri shell)')
  })


  // Dropped file path authorization (adds to extraRoots)
  ipc.handle('files:authorize', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return false
    try {
      host.addExtraRoot?.(filePath)
      const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
      if (lastSlash > 0) {
        host.addExtraRoot?.(filePath.slice(0, lastSlash))
      }
      return true
    } catch {
      return false
    }
  })

  // Installed plugins disk operations
  ipc.handle('plugins:get-lock', async () => {
    try {
      const lockPath = join(userDataDir, 'registry.lock.json')
      if (existsSync(lockPath)) {
        return JSON.parse(readFileSync(lockPath, 'utf8'))
      }
    } catch {
      // ignore
    }
    return undefined
  })

  ipc.handle('plugins:list-installed', async () => {
    try {
      const root = join(userDataDir, 'installed-plugins')
      return listInstalledPlugins(root)
    } catch {
      return []
    }
  })

  ipc.handle('plugins:install', async (_event, pluginId: string, files: Record<string, string>) => {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('pluginId is required')
    }
    const root = join(userDataDir, 'installed-plugins')
    // Atomic staging + rename swap (audit W3): a failed write never
    // leaves a half-written plugin directory, and files dropped by the
    // new version never linger from the old one.
    return writePluginFilesAtomic(root, pluginId, files)
  })

  ipc.handle('plugins:uninstall', async (_event, pluginId: string) => {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('pluginId is required')
    }
    const root = join(userDataDir, 'installed-plugins')
    // Identity-based removal, not just the computed directory name: a
    // directory installed under a manifest id, an npm name, or a
    // pre-rename scope must go too, or the plugin resurrects at boot
    // from the leftover directory.
    const { deleted } = removePluginFiles(root, pluginId)
    if (deleted.length > 0) {
      return { ok: true, deleted }
    }
    return { ok: false, message: 'Plugin directory not found', deleted: [] }
  })

  // Proxy apply — the enforcement point of the settings-side proxy. The
  // renderer can only *ask* for a re-read (`proxy:reload` → the shell reads
  // the store + the secrets-held password and pushes here); the config
  // itself never crosses from the renderer, so nothing renderer-side can
  // point credential-bearing requests at a proxy of its choosing. (The
  // settings "test" button probes through a marked ctx.http request — the
  // dispatcher path below — so it exercises the proxy as the app uses it.)
  ipc.handle('proxy:apply', async (_event, config: unknown) => {
    const stored = proxyRegistry.set(config)
    // describeProxy is the only thing about a config that may reach a log:
    // scheme, host, port — never the credentials.
    logger.info?.(`proxy: applied -> ${describeProxy(stored)}`)
    return { ok: true }
  })

  // Stream headers
  ipc.handle('sandbox:set-html', async (_event, entry: { id: string; html: string }) => {
    return protocolManager.setSandboxHtml(entry.id, entry.html)
  })

  ipc.handle('protocol:file', async (_event, req: { url: string; range?: string | null }) => {
    return protocolManager.handleBbebeeFile(req.url, req.range)
  })

  ipc.handle('protocol:sandbox', async (_event, req: { url: string }) => {
    return protocolManager.handleBbebeeSandbox(req.url)
  })

  // System diagnostic and event emission
  ipc.handle('system:emit-event', async (_event, eventPayload: unknown) => {
    host.emit(eventPayload as Parameters<typeof host.emit>[0])
    return { ok: true }
  })

  ipc.handle('system:state', async () => {
    return {
      wakeLocks: Array.from(wakeLocks.entries()).map(([id, reason]) => ({ id, reason })),
      hotkeys: Array.from(registeredHotkeys),
      mediaKeysWatching: isMediaKeysWatching,
      nowPlaying: currentNowPlayingData,
      playbackState: currentPlaybackState,
      positionMs: currentPositionMs,
      supportedCommands: currentSupportedCommands,
    }
  })

  ipc.handle('sidecar:ping', async () => 'pong')

  const shutdown = async () => {
    proxyRegistry.dispose()
    relay.dispose()
    try {
      await audioHost.supervisor.shutdown()
    } catch {
      // ignore
    }
    try {
      await host.dispose()
    } catch {
      // ignore
    }
  }

  return {
    host,
    ipc,
    audioHost,
    protocolManager,
    handlers,
    shutdown,
    writeRaw,
  }
}

export function startStdioLoop(sidecar: SidecarContext): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  let activeRequests = 0
  let isClosed = false

  function tryExit() {
    if (isClosed && activeRequests === 0) {
      void sidecar.shutdown().then(() => {
        process.exit(0)
      })
    }
  }

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let req: JsonRpcRequest
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      sidecar.writeRaw({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      })
      return
    }

    const { id, method, params } = req
    const isNotification = id === undefined || id === null

    if (method === 'shutdown') {
      void sidecar.shutdown().then(() => {
        process.exit(0)
      })
      return
    }

    const handler = sidecar.handlers.get(method)
    if (!handler) {
      if (!isNotification) {
        sidecar.writeRaw({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
      }
      return
    }

    const args = Array.isArray(params) ? params : params !== undefined ? [params] : []
    const caller = { sender: { id: 1 } }

    activeRequests++
    Promise.resolve()
      .then(() => handler(caller, ...args))
      .then((result) => {
        if (!isNotification) {
          sidecar.writeRaw({
            jsonrpc: '2.0',
            id,
            result: result === undefined ? null : result,
          })
        }
      })
      .catch((err) => {
        if (!isNotification) {
          sidecar.writeRaw({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: (err as { message?: string })?.message || String(err),
            },
          })
        }
      })
      .finally(() => {
        activeRequests--
        tryExit()
      })
  })

  rl.on('close', () => {
    isClosed = true
    tryExit()
  })

  process.on('SIGINT', () => {
    void sidecar.shutdown().then(() => {
      process.exit(0)
    })
  })

  process.on('SIGTERM', () => {
    void sidecar.shutdown().then(() => {
      process.exit(0)
    })
  })
}

// Standalone execution entry check
const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === process.argv[1] ||
  process.argv[1].endsWith('sidecar/index.ts') ||
  process.argv[1].endsWith('sidecar/index.js') ||
  process.argv[1].endsWith('dist-sidecar/index.mjs')
)

if (isMain) {
  createSidecar()
    .then((sidecar) => {
      startStdioLoop(sidecar)
      process.stderr.write('[sidecar] BBeBee Node.js sidecar initialized and listening on stdin\n')
    })
    .catch((err) => {
      process.stderr.write(`[sidecar:FATAL] Sidecar initialization failed: ${String(err)}\n`)
      process.exit(1)
    })
}
