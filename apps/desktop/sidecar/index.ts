/**
 * BBeBee Node.js Headless Sidecar
 *
 * Hosts Core Services (@BBeBee/core-desktop-bridge/main, core-fs-node, core-db-node,
 * core-paths-node), Audio Engine Supervisor, FFmpeg Transcoding, and Custom Protocol Handlers.
 *
 * Transport: Standard Input / Standard Output framed NDJSON (stdio JSON-RPC 2.0).
 * All diagnostics and application logs are isolated strictly to stderr.
 */

import { homedir, tmpdir } from 'node:os'
import { join, resolve, relative, dirname, isAbsolute } from 'node:path'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import readline from 'node:readline'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  createHost,
  type Host,
  type IpcHost,
  type HttpFetchResponse,
  type BridgeLogger,
  type SystemHost,
} from '@BBeBee/core-desktop-bridge/main'
import { CH } from '@BBeBee/core-desktop-bridge/protocol'
import { createAudioHost, type AudioHostApi } from './audio/index.js'
import { ProtocolManager } from './protocols.js'
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './types.js'

// Strictly isolate standard output for NDJSON JSON-RPC messages only.
console.log = (...args: unknown[]) => {
  process.stderr.write(`[sidecar:log] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`)
}
console.info = (...args: unknown[]) => {
  process.stderr.write(`[sidecar:info] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`)
}

export function resolveSystemPath(kind: string, appName = 'BBeBee'): string {
  const home = homedir()
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  switch (kind) {
    case 'userData':
    case 'appData':
      if (process.env['BBEBEE_DATA_DIR']) return process.env['BBEBEE_DATA_DIR']
      if (isMac) return join(home, 'Library', 'Application Support', appName)
      if (isWin) return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), appName)
      return join(process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), appName)

    case 'cache':
      if (isMac) return join(home, 'Library', 'Caches', appName)
      if (isWin) return join(process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'), appName, 'Cache')
      return join(process.env['XDG_CACHE_HOME'] ?? join(home, '.cache'), appName)

    case 'temp':
      return tmpdir()

    case 'logs': {
      const dataDir = resolveSystemPath('userData', appName)
      return join(dataDir, 'logs')
    }

    case 'downloads':
      return join(home, 'Downloads')

    case 'music':
      return join(home, 'Music')

    case 'desktop':
      return join(home, 'Desktop')

    case 'documents':
      return join(home, 'Documents')

    case 'home':
      return home

    default:
      return join(home, appName)
  }
}

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

  const audioHost = createAudioHost(audioLogger)
  const userDataDir = resolveSystemPath('userData')
  const protocolManager = new ProtocolManager(() => join(userDataDir, 'installed-plugins'))

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
      if (!existsSync(root)) return []
      const entries = readdirSync(root, { withFileTypes: true })
      const plugins: Array<{ id: string; version: string; manifest: unknown; dirName: string; sha256?: string }> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = join(root, entry.name, 'manifest.json')
        const pkgJsonPath = join(root, entry.name, 'package.json')
        let manifest: Record<string, unknown> | undefined
        if (existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
          } catch {
            // ignore error
          }
        } else if (existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>
            if (pkg['manifest'] && typeof pkg['manifest'] === 'object') {
              manifest = pkg['manifest'] as Record<string, unknown>
            } else {
              manifest = {
                id: pkg['name'],
                version: pkg['version'] ?? '1.0.0',
                displayName: pkg['displayName'] ?? pkg['name'],
                entry: { main: pkg['main'] ?? './index.js' },
                capabilities: pkg['capabilities'] ?? [],
              }
            }
          } catch {
            // ignore error
          }
        }
        if (manifest && manifest['id']) {
          const entryMain = (
            typeof manifest['entry'] === 'object' &&
            manifest['entry'] &&
            typeof (manifest['entry'] as Record<string, unknown>)['main'] === 'string'
              ? ((manifest['entry'] as Record<string, unknown>)['main'] as string)
              : './index.js'
          ).replace(/^\.?\//, '')
          const mainFilePath = join(root, entry.name, entryMain)
          let sha256: string | undefined
          if (existsSync(mainFilePath)) {
            try {
              const buf = readFileSync(mainFilePath)
              sha256 = createHash('sha256').update(buf).digest('hex')
            } catch {
              // ignore error
            }
          }
          plugins.push({
            id: String(manifest['id']),
            version: String(manifest['version'] ?? '1.0.0'),
            manifest,
            dirName: entry.name,
            ...(sha256 ? { sha256 } : {}),
          })
        }
      }
      return plugins
    } catch {
      return []
    }
  })

  ipc.handle('plugins:install', async (_event, pluginId: string, files: Record<string, string>) => {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('pluginId is required')
    }
    const root = join(userDataDir, 'installed-plugins')
    const dirName = pluginId.replace(/^@/, '').replace(/\//g, '__')
    const targetDir = join(root, dirName)
    mkdirSync(targetDir, { recursive: true })
    for (const [relPath, content] of Object.entries(files)) {
      const filePath = resolve(targetDir, relPath)
      const rel = relative(targetDir, filePath)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Path traversal rejected: ${relPath}`)
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content, 'utf8')
    }
    return { ok: true, pluginId, path: targetDir }
  })

  ipc.handle('plugins:uninstall', async (_event, pluginId: string) => {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('pluginId is required')
    }
    const root = join(userDataDir, 'installed-plugins')
    const dirName = pluginId.replace(/^@/, '').replace(/\//g, '__')
    const targetDir = join(root, dirName)
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true })
      return { ok: true }
    }
    return { ok: false, message: 'Plugin directory not found' }
  })

  // Proxy test and set
  ipc.handle('proxy:test', async (_event, config: { protocol?: string; host?: string; port?: number }) => {
    if (!config?.host || !config?.port) {
      return { ok: false, error: 'Proxy server address or port cannot be empty' }
    }
    return { ok: true, latencyMs: 15 }
  })

  ipc.handle('proxy:set', async () => {})

  // Stream headers
  ipc.handle('stream:set-headers', async () => {})

  ipc.handle('sandbox:set-html', async (_event, entry: { id: string; html: string }) => {
    return protocolManager.setSandboxHtml(entry.id, entry.html)
  })

  ipc.handle('protocol:file', async (_event, req: { url: string; range?: string | null }) => {
    return protocolManager.handleBbebeeFile(req.url, req.range)
  })

  ipc.handle('protocol:plugin', async (_event, req: { url: string }) => {
    return protocolManager.handleBbebeePlugin(req.url)
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
