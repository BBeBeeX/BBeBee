import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unwrapBridgeResult } from '@bbebee/core-desktop-bridge/protocol'
import { AudioEngineSupervisor, loadTimeoutMs } from './audio/audio-engine-supervisor.js'
import { getFileMimeType, parseByteRange } from './helpers.js'
import { toNativePath } from './fs-path.js'

const testDir = join(tmpdir(), `bbebee-sidecar-test-${Date.now()}`)
const sidecarScript = join(__dirname, '../dist-sidecar/index.mjs')

describe('BBeBee Node.js Headless Sidecar Roundtrip Tests', () => {
  let child: ChildProcess | null = null
  let rl: readline.Interface | null = null
  let reqId = 1
  const pending = new Map<number, (res: unknown) => void>()

  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true })

    if (!existsSync(sidecarScript)) {
      execFileSync(process.execPath, [join(__dirname, '../scripts/build-sidecar.js')], {
        stdio: 'inherit',
      })
    }

    child = spawn('node', [sidecarScript], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        BBEBEE_DATA_DIR: testDir,
        BBEBEE_DB_NAME: 'test.db',
      },
    })

    child.on('error', (err) => {
      for (const [, callback] of pending) {
        callback(new Error(`Sidecar process error: ${err.message}`))
      }
      pending.clear()
    })

    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        for (const [, callback] of pending) {
          callback(new Error(`Sidecar process exited unexpectedly with code ${code}, signal ${signal}`))
        }
        pending.clear()
      }
    })

    rl = readline.createInterface({
      input: child.stdout!,
      terminal: false,
    })

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed.id && pending.has(parsed.id)) {
          const resolve = pending.get(parsed.id)!
          pending.delete(parsed.id)
          resolve(parsed.result ?? parsed.error)
        }
      } catch {
        // ignore
      }
    })

    // Wait briefly for startup
    await new Promise((r) => setTimeout(r, 400))
  })

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM')
    }
  })

  function callSidecar(method: string, params: unknown[] = []): Promise<unknown> {
    const id = reqId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timeout calling sidecar method ${method}`))
      }, 5000)

      pending.set(id, (res) => {
        clearTimeout(timer)
        resolve(res)
      })

      const frame = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }) + '\n'

      child!.stdin!.write(frame)
    })
  }

  it('responds to sidecar:ping with pong', async () => {
    const res = await callSidecar('sidecar:ping')
    expect(res).toBe('pong')
  })

  it('performs BBeBee:call paths.get and returns valid file:// URI', async () => {
    const rawEnvelope = await callSidecar('BBeBee:call', ['paths', 'get', ['data'], null])
    const result = unwrapBridgeResult(rawEnvelope)
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^file:\/\//)
  })

  it('performs BBeBee:call fs operations (mkdir, writeFile, exists, readFile)', async () => {
    const dataDirEnvelope = await callSidecar('BBeBee:call', ['paths', 'get', ['data'], null])
    const dataUri = unwrapBridgeResult(dataDirEnvelope) as string

    const fileUri = `${dataUri}/hello.txt`
    const content = Buffer.from('Antigravity Sidecar Test')
    const base64Content = content.toString('base64')

    // Write file
    const writeEnvelope = await callSidecar('BBeBee:call', ['fs', 'writeFile', [fileUri, base64Content], null])
    unwrapBridgeResult(writeEnvelope)

    // Check exists
    const existsEnvelope = await callSidecar('BBeBee:call', ['fs', 'exists', [fileUri], null])
    const exists = unwrapBridgeResult(existsEnvelope)
    expect(exists).toBe(true)

    // Read file
    const readEnvelope = await callSidecar('BBeBee:call', ['fs', 'readFile', [fileUri], null])
    const readBase64 = unwrapBridgeResult(readEnvelope) as string
    expect(Buffer.from(readBase64, 'base64').toString('utf8')).toBe('Antigravity Sidecar Test')
  })

  it('performs BBeBee:call audio operations (getOutputDevices, mpvEngineStatus)', async () => {
    const devicesEnvelope = await callSidecar('BBeBee:call', ['audio', 'getOutputDevices', [], null])
    const devices = unwrapBridgeResult(devicesEnvelope)
    expect(Array.isArray(devices)).toBe(true)

    const statusEnvelope = await callSidecar('BBeBee:call', ['audio', 'mpvEngineStatus', [], null])
    const status = unwrapBridgeResult(statusEnvelope) as { running: boolean; mpvAvailable: boolean }
    expect(typeof status.running).toBe('boolean')
    expect(typeof status.mpvAvailable).toBe('boolean')
  })

  it('manages sandbox dynamic html template registration and serving', async () => {
    const setRes = await callSidecar('sandbox:set-html', [{ id: 'custom-skin', html: '<h1>Skin</h1>' }])
    expect(setRes).toBe(true)

    const getRes = (await callSidecar('protocol:sandbox', [{ url: 'bbebee-sandbox://custom-skin' }])) as {
      status: number
      body: string
    }
    expect(getRes.status).toBe(200)
    expect(getRes.body).toBe('<h1>Skin</h1>')
  })
})

describe('AudioEngineSupervisor Native Executable Tests', () => {
  let supervisor: AudioEngineSupervisor | null = null

  afterAll(async () => {
    await supervisor?.shutdown()
    supervisor = null
  })

  it.runIf(Boolean(process.env['TEST_AUDIO_ENGINE']))('resolves the standalone audio-engine executable in candidate resource paths', () => {
    supervisor = new AudioEngineSupervisor()
    const exePath = supervisor.resolveExecutablePath()
    expect(exePath).not.toBeNull()
    expect(existsSync(exePath!)).toBe(true)
    expect(exePath!.includes('audio-engine')).toBe(true)
  })

  it.runIf(Boolean(process.env['TEST_AUDIO_ENGINE']))('spawns and receives ready event from standalone audio-engine', async () => {
    supervisor = new AudioEngineSupervisor()
    const readyPromise = new Promise<void>((resolve) => {
      supervisor!.onReady(() => resolve())
    })
    supervisor.start()
    await expect(readyPromise).resolves.toBeUndefined()
    expect(supervisor.getEngineStatus().running).toBe(true)
  })

  it('calculates loadTimeoutMs correctly for local vs remote streams', () => {
    expect(loadTimeoutMs('https://stream.example.org/audio.mp3')).toBe(30_000)
    expect(loadTimeoutMs('file:///music/song.flac')).toBe(15_000)
  })
})

describe('Sidecar Pure Helpers Tests', () => {
  it('converts bbebee-file:// and file:// URLs to native filesystem paths', () => {
    expect(toNativePath('file:///tmp/music/song.mp3')).toBe('/tmp/music/song.mp3')
    expect(toNativePath('bbebee-file:///tmp/music/song.mp3')).toBe('/tmp/music/song.mp3')
  })

  it('maps audio and image file extensions to correct MIME types', () => {
    expect(getFileMimeType('track.flac')).toBe('audio/flac')
    expect(getFileMimeType('track.mp3')).toBe('audio/mpeg')
    expect(getFileMimeType('cover.jpg')).toBe('image/jpeg')
    expect(getFileMimeType('cover.png')).toBe('image/png')
  })

  it('parses HTTP byte range headers accurately', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseByteRange('invalid', 1000)).toBeUndefined()
  })

})
