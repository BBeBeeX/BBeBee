import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  createPreloadApi,
  createBridgeApi,
  unwrapBridgeResult,
} from '../renderer/preload-shim.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const shimScriptPath = resolve(__dirname, '../src-tauri/src/shim.js')

describe('Preload Surface Conformance Test: Tauri Shim API Contract', () => {
  const shimScriptContent = readFileSync(shimScriptPath, 'utf8')

  // Expected baseline surface strictly defining the desktop preload contract
  const baselineSurface = {
    namespaces: {
      paths: ['get'],
      secrets: ['available', 'encrypt', 'decrypt'],
      shell: ['openExternal', 'openPath'],
      dialog: ['pickDirectory', 'pickFiles'],
      files: ['getPath', 'authorizePath', 'toServableUrl'],
      devtools: ['open'],
      plugins: ['listInstalled', 'getLock', 'install', 'uninstall'],
      window: ['minimize', 'maximize', 'close', 'isMaximized', 'setCloseToTray', 'toggle'],
      proxy: ['test', 'set'],
      stream: ['setHeaders'],
      audio: ['cancelTranscode', 'transcode'],
      desktopLyrics: [
        'setVisible',
        'setPosition',
        'getPosition',
        'commitPosition',
        'getData',
        'onMoved',
        'setLocked',
        'setIgnoreMouse',
        'onCursor',
        'updateData',
        'sendAction',
        'onData',
        'onAction',
      ],
      taskbar: ['update', 'onAction'],
      miniPlayer: [
        'open',
        'close',
        'restoreMain',
        'setMode',
        'getState',
        'getData',
        'updateData',
        'sendAction',
        'onData',
        'onState',
        'onAction',
      ],
      locale: ['getLocale', 'notify', 'onLocaleChange'],
      sandbox: ['setHtml'],
    },
    topLevelMethods: ['getAppVersion'],
    topLevelProperties: ['platform', 'versions', 'isDebug'],
    bridgeMethods: [
      'call',
      'streamOpen',
      'streamPull',
      'streamClose',
      'httpOpen',
      'httpPull',
      'httpClose',
      'txBegin',
      'txEnd',
      'on',
    ],
  }

  it('confirms all expected baseline namespaces and methods are covered by baseline specification', () => {
    expect(Object.keys(baselineSurface.namespaces).length).toBeGreaterThanOrEqual(15)
    expect(baselineSurface.topLevelMethods.length).toBeGreaterThanOrEqual(1)
    expect(baselineSurface.bridgeMethods.length).toBeGreaterThanOrEqual(5)
  })

  it('validates 100% parity on TypeScript preload-shim surface with zero missing properties', () => {
    const api = createPreloadApi() as Record<string, any>
    const bridge = createBridgeApi() as Record<string, any>

    const missingInShim: string[] = []

    // 1. Check all namespaces and sub-methods
    for (const [ns, methods] of Object.entries(baselineSurface.namespaces)) {
      if (!api[ns] || typeof api[ns] !== 'object') {
        missingInShim.push(`Namespace missing: BBeBee.${ns}`)
        continue
      }
      for (const m of methods) {
        if (typeof api[ns][m] !== 'function') {
          missingInShim.push(`Method missing: BBeBee.${ns}.${m}()`)
        }
      }
    }

    // 2. Check top-level methods
    for (const m of baselineSurface.topLevelMethods) {
      if (typeof api[m] !== 'function') {
        missingInShim.push(`Top-level method missing: BBeBee.${m}()`)
      }
    }

    // 3. Check top-level properties
    for (const p of baselineSurface.topLevelProperties) {
      if (api[p] === undefined) {
        missingInShim.push(`Top-level property missing: BBeBee.${p}`)
      }
    }

    // 4. Check bridge methods
    for (const bm of baselineSurface.bridgeMethods) {
      if (typeof bridge[bm] !== 'function') {
        missingInShim.push(`Bridge method missing: BBeBeeBridge.${bm}()`)
      }
    }

    expect(missingInShim, `Missing members detected: \n${missingInShim.join('\n')}`).toEqual([])
  })

  it('validates 100% parity in standalone bundled shim.js evaluated in sandbox environment', () => {
    const mockWindow: Record<string, any> = {
      __TAURI_INTERNALS__: {
        invoke: async () => undefined,
      },
      __TAURI__: {
        core: { invoke: async () => undefined },
        event: { listen: async () => () => {} },
      },
    }

    const context = vm.createContext({
      window: mockWindow,
      process: {
        platform: 'linux',
        versions: { node: '22.12.0' },
        env: {},
        argv: [],
      },
      navigator: { userAgent: 'linux' },
      document: {},
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    })

    // Execute shim.js in isolated sandbox
    vm.runInContext(shimScriptContent, context)

    const api = mockWindow.BBeBee
    const bridge = mockWindow.BBeBeeBridge

    expect(api, 'window.BBeBee must be defined by shim.js').toBeDefined()
    expect(bridge, 'window.BBeBeeBridge must be defined by shim.js').toBeDefined()

    const missingInBundle: string[] = []

    for (const [ns, methods] of Object.entries(baselineSurface.namespaces)) {
      if (!api[ns] || typeof api[ns] !== 'object') {
        missingInBundle.push(`Namespace missing: BBeBee.${ns}`)
        continue
      }
      for (const m of methods) {
        if (typeof api[ns][m] !== 'function') {
          missingInBundle.push(`Method missing: BBeBee.${ns}.${m}()`)
        }
      }
    }

    for (const m of baselineSurface.topLevelMethods) {
      if (typeof api[m] !== 'function') {
        missingInBundle.push(`Top-level method missing: BBeBee.${m}()`)
      }
    }

    for (const p of baselineSurface.topLevelProperties) {
      if (api[p] === undefined) {
        missingInBundle.push(`Top-level property missing: BBeBee.${p}`)
      }
    }

    for (const bm of baselineSurface.bridgeMethods) {
      if (typeof bridge[bm] !== 'function') {
        missingInBundle.push(`Bridge method missing: BBeBeeBridge.${bm}()`)
      }
    }

    expect(
      missingInBundle,
      `Missing members in shim.js: \n${missingInBundle.join('\n')}`,
    ).toEqual([])
  })

  it('guarantees window.BBeBee and window.BBeBeeBridge are deeply frozen objects', () => {
    const api = createPreloadApi()
    const bridge = createBridgeApi()

    expect(Object.isFrozen(api), 'api root is frozen').toBe(true)
    expect(Object.isFrozen(bridge), 'bridge root is frozen').toBe(true)

    // Verify sub-namespaces are deeply frozen
    for (const [ns, val] of Object.entries(api)) {
      if (typeof val === 'object' && val !== null) {
        expect(Object.isFrozen(val), `BBeBee.${ns} is frozen`).toBe(true)
      }
    }
  })

  it('maps bbebee-file: URIs to a webview-loadable form via files.toServableUrl', () => {
    const api = createPreloadApi()
    const toServableUrl = api.files.toServableUrl as (uri: string) => string

    // Non-bbebee-file inputs pass through untouched.
    expect(toServableUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
    expect(toServableUrl('file:///C:/a.jpg')).toBe('file:///C:/a.jpg')
    expect(toServableUrl('')).toBe('')

    // The mapping depends on the host platform (baked in at shim creation).
    const input = 'bbebee-file:///C:/Users/test/music/cover.jpg'
    if (api.platform === 'win32') {
      expect(toServableUrl(input)).toBe('http://bbebee-file.localhost/C:/Users/test/music/cover.jpg')
      expect(toServableUrl('bbebee-file://localhost/C:/a.jpg')).toBe(
        'http://bbebee-file.localhost/C:/a.jpg',
      )
    } else {
      // WKWebView / WebKitGTK resolve the custom scheme natively.
      expect(toServableUrl(input)).toBe(input)
    }
  })

  it('rewrites bbebee-file: URIs to http://bbebee-file.localhost on Windows (shim.js)', () => {
    const mockWindow: Record<string, any> = {
      __TAURI_INTERNALS__: { invoke: async () => undefined },
    }
    const context = vm.createContext({
      window: mockWindow,
      process: { platform: 'win32', versions: {}, env: {}, argv: [] },
      navigator: { userAgent: 'windows' },
      document: {},
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    })
    vm.runInContext(shimScriptContent, context)
    const toServableUrl = mockWindow.BBeBee.files.toServableUrl as (uri: string) => string

    expect(toServableUrl('bbebee-file:///C:/Users/test/music/cover.jpg')).toBe(
      'http://bbebee-file.localhost/C:/Users/test/music/cover.jpg',
    )
    expect(toServableUrl('bbebee-file://localhost/D:/a/b.jpg')).toBe(
      'http://bbebee-file.localhost/D:/a/b.jpg',
    )
    // Non-bbebee-file inputs pass through untouched, even on Windows.
    expect(toServableUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('verifies platform and version contract formats', () => {
    const api = createPreloadApi()

    expect(['linux', 'darwin', 'win32']).toContain(api.platform)
    expect(typeof api.versions.tauri).toBe('string')
    expect(typeof api.versions.webview).toBe('string')
    expect(typeof api.isDebug).toBe('boolean')
  })

  it('verifies unwrapBridgeResult error deserialization and result unwrapping', () => {
    const successEnvelope = {
      __bbebee_bridge__: true,
      ok: true,
      result: { data: 'test-success' },
    }
    expect(unwrapBridgeResult(successEnvelope)).toEqual({ data: 'test-success' })

    const errorEnvelope = {
      __bbebee_bridge__: true,
      ok: false,
      error: {
        message: 'No such file or directory',
        code: 'ENOENT',
        errno: -2,
      },
    }
    expect(() => unwrapBridgeResult(errorEnvelope)).toThrow('No such file or directory')

    try {
      unwrapBridgeResult(errorEnvelope)
    } catch (err: any) {
      expect(err.code).toBe('ENOENT')
      expect(err.errno).toBe(-2)
    }

    // Non-envelope passes through untouched
    expect(unwrapBridgeResult('plain-string')).toBe('plain-string')
  })

  it('verifies listener subscription returns synchronous disposer functions', () => {
    const bridge = createBridgeApi()
    const unsub = bridge.on(() => {})
    expect(typeof unsub).toBe('function')
    expect(() => unsub()).not.toThrow()

    const api = createPreloadApi()
    const unsubMoved = api.desktopLyrics.onMoved(() => {})
    expect(typeof unsubMoved).toBe('function')
    expect(() => unsubMoved()).not.toThrow()
  })
})
