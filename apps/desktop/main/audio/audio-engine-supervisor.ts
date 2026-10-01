/**
 * Audio Engine Supervisor.
 *
 * Runs in Electron Main process. Spawns, monitors, and isolates the native
 * audio-engine standalone binary process. If the child process crashes, the supervisor
 * isolates the failure from the Main and Renderer processes, notifies listeners,
 * and recovers gracefully.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AudioMainLogger } from './audio-devices.js'

export interface DspConfig {
  preamp?: { enabled: boolean; gainDb?: number }
  eq?: { enabled: boolean; gains?: number[] }
  compressor?: {
    enabled: boolean
    threshold?: number
    ratio?: number
    attack?: number
    release?: number
  }
}

export interface FftFrame {
  frequencyData: number[]
  timeDomainData: number[]
}

export interface PlaybackStateEvent {
  status: 'idle' | 'playing' | 'paused' | 'stopped' | 'stalled' | 'loading' | 'error' | 'ended'
  positionMs: number
  durationMs: number
}

export interface CrashEvent {
  code: number | null
  signal: string | null
  restarting: boolean
}

export interface LoadResult {
  durationMs: number
  uri: string
  /** The engine reports the file's actual audio parameters on FILE_LOADED. */
  sampleRate?: number
  channels?: number
  bitDepth?: number
  /**
   * The engine already had this file sounding (a gapless handoff: the
   * playlist had auto-advanced to it) and no re-load happened — the caller
   * must not seek it back to zero.
   */
  resumed?: boolean
}

export class AudioEngineSupervisor {
  private child: ChildProcess | null = null
  private readonly logger?: AudioMainLogger
  private readonly customExecutablePath?: string
  private isShuttingDown = false
  private restartCount = 0
  private lastRestartTime = 0

  private readonly fftListeners = new Set<(frame: FftFrame) => void>()
  private readonly stateListeners = new Set<(event: PlaybackStateEvent) => void>()
  private readonly endedListeners = new Set<() => void>()
  private readonly crashListeners = new Set<(event: CrashEvent) => void>()
  private readonly readyListeners = new Set<() => void>()

  private currentUri?: string
  private currentVolume = 0.8
  private currentMuted = false
  private currentDeviceId = 'default'
  private currentDspConfig?: DspConfig
  private visualizerEnabled = true
  private currentFftSize = 128

  private pendingLoads: Array<{
    uri: string
    resolve: (res: LoadResult) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  private pendingAppends: Array<{
    uri: string
    resolve: () => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  private pendingDeviceQueries: Array<{
    resolve: (devices: Array<{ name: string; description: string }>) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(logger?: AudioMainLogger, customExecutablePath?: string) {
    this.logger = logger
    this.customExecutablePath = customExecutablePath
  }

  start(): void {
    if (this.child) return
    this.spawnWorker()
  }

  resolveExecutablePath(): string | null {
    if (this.customExecutablePath !== undefined) {
      return existsSync(this.customExecutablePath) ? this.customExecutablePath : null
    }
    const envPath = process.env['AUDIO_ENGINE_PATH']
    if (envPath && existsSync(envPath)) {
      return envPath
    }

    const isWin = process.platform === 'win32'
    const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'

    // Packaged application resources path
    const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (resourcesPath) {
      const packagedExe = join(resourcesPath, 'bin', exeName)
      if (existsSync(packagedExe)) return packagedExe
      const packagedExeDirect = join(resourcesPath, exeName)
      if (existsSync(packagedExeDirect)) return packagedExeDirect
    }

    // Development paths
    try {
      const currentDir = dirname(fileURLToPath(import.meta.url))
      const candidatePaths = [
        join(currentDir, '..', '..', 'bin', exeName),
        join(currentDir, '..', '..', 'resources', 'bin', exeName),
        join(currentDir, '..', '..', '..', 'bin', exeName),
        join(currentDir, '..', '..', '..', 'resources', 'bin', exeName),
        join(process.cwd(), 'apps', 'desktop', 'bin', exeName),
        join(process.cwd(), 'apps', 'desktop', 'resources', 'bin', exeName),
        join(process.cwd(), 'bin', exeName),
      ]

      for (const p of candidatePaths) {
        if (existsSync(p)) return p
      }
    } catch {
      // In bundled environments without fileURLToPath resolution
    }

    return null
  }

  private spawnWorker(): void {
    try {
      const exePath = this.resolveExecutablePath()

      if (!exePath) {
        this.logger?.error?.('audio-engine-supervisor: standalone native audio-engine executable not found')
        const err = new Error('audio-engine executable not found')
        while (this.pendingLoads.length > 0) {
          const p = this.pendingLoads.shift()!
          clearTimeout(p.timer)
          p.reject(err)
        }
        for (const cb of this.crashListeners) {
          cb({ code: -1, signal: null, restarting: false })
        }
        return
      }

      this.logger?.info?.('audio-engine-supervisor: spawning standalone native audio-engine executable at: %s', exePath)

      const exeDir = dirname(exePath)
      const childEnv: Record<string, string | undefined> = {
        ...process.env,
        NODE_ENV: process.env['NODE_ENV'] ?? 'production',
        LD_LIBRARY_PATH: process.env['LD_LIBRARY_PATH']
          ? `${exeDir}:${process.env['LD_LIBRARY_PATH']}`
          : exeDir,
        DYLD_LIBRARY_PATH: process.env['DYLD_LIBRARY_PATH']
          ? `${exeDir}:${process.env['DYLD_LIBRARY_PATH']}`
          : exeDir,
        PATH: process.platform === 'win32'
          ? `${exeDir};${process.env['PATH'] || ''}`
          : process.env['PATH'],
      }

      this.child = spawn(exePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: childEnv,
      })

      let stdoutBuffer = ''
      this.child.stdout?.on('data', (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString()
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            try {
              const msg = JSON.parse(trimmed)
              this.handleWorkerMessage(msg)
            } catch {
              this.logger?.debug?.('audio-engine-supervisor: unparseable stdout line: %s', trimmed)
            }
          }
        }
      })

      this.child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString().trim()
        if (text) {
          this.logger?.debug?.('audio-engine [stderr]: %s', text)
        }
      })

      this.child.on('error', (err) => {
        this.logger?.error?.('audio-engine-supervisor: worker process error: %s', String(err))
      })

      this.child.on('exit', (code, signal) => {
        this.handleWorkerExit(code, signal)
      })

      // Send initial configuration to worker
      this.sendCommand({
        action: 'init',
        config: {
          deviceId: this.currentDeviceId,
          fftSize: this.currentFftSize,
        },
      })

      // Restore parameters if reconnecting
      if (this.currentVolume !== 0.8) this.setVolume(this.currentVolume)
      if (this.currentMuted) this.setMuted(this.currentMuted)
      if (this.currentDspConfig) this.setDspConfig(this.currentDspConfig)
    } catch (err) {
      this.logger?.error?.('audio-engine-supervisor: failed to spawn worker: %s', String(err))
    }
  }

  private handleWorkerMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return
    const payload = msg as Record<string, unknown>
    const type = payload['type']

    switch (type) {
      case 'ready':
        for (const cb of this.readyListeners) cb()
        break
      case 'loaded': {
        const durationMs = Number(payload['durationMs'] ?? 0)
        const uri = String(payload['uri'] ?? this.currentUri ?? '')
        const resumed = payload['resumed'] === true
        const sampleRate = Number(payload['sampleRate'] ?? 0) || undefined
        const channels = Number(payload['channels'] ?? 0) || undefined
        const bitDepth = Number(payload['bitDepth'] ?? 0) || undefined
        while (this.pendingLoads.length > 0) {
          const p = this.pendingLoads.shift()!
          clearTimeout(p.timer)
          p.resolve({ durationMs, uri, resumed, sampleRate, channels, bitDepth })
        }
        break
      }
      case 'error': {
        const message = String(payload['message'] ?? 'Audio engine error')
        const action = payload['action']
        if (action === 'append' && this.pendingAppends.length > 0) {
          const p = this.pendingAppends.shift()!
          clearTimeout(p.timer)
          p.reject(new Error(message))
          break
        }
        while (this.pendingLoads.length > 0) {
          const p = this.pendingLoads.shift()!
          clearTimeout(p.timer)
          p.reject(new Error(message))
        }
        break
      }
      case 'appended': {
        while (this.pendingAppends.length > 0) {
          const p = this.pendingAppends.shift()!
          clearTimeout(p.timer)
          p.resolve()
        }
        break
      }
      case 'audio-devices': {
        const devices = (Array.isArray(payload['devices']) ? payload['devices'] : []) as Array<{
          name: string
          description: string
        }>
        while (this.pendingDeviceQueries.length > 0) {
          const p = this.pendingDeviceQueries.shift()!
          clearTimeout(p.timer)
          p.resolve(devices)
        }
        break
      }
      case 'state':
      case 'playback-state':
        for (const cb of this.stateListeners) {
          cb({
            status: payload['status'] as PlaybackStateEvent['status'],
            positionMs: Number(payload['positionMs'] ?? 0),
            durationMs: Number(payload['durationMs'] ?? 0),
          })
        }
        break
      case 'ended':
        for (const cb of this.endedListeners) cb()
        break
      case 'fftFrame':
      case 'fft-frame':
        for (const cb of this.fftListeners) {
          cb({
            frequencyData: (payload['frequencyData'] as number[]) ?? [],
            timeDomainData: (payload['timeDomainData'] as number[]) ?? [],
          })
        }
        break
      case 'heartbeat':
        break
    }
  }

  private handleWorkerExit(code: number | null, signal: string | null): void {
    this.child = null

    // Reject any pending loads, appends, and fallback device queries
    while (this.pendingLoads.length > 0) {
      const p = this.pendingLoads.shift()!
      clearTimeout(p.timer)
      p.reject(new Error(`audio-engine process terminated unexpectedly (code: ${code}, signal: ${signal})`))
    }
    while (this.pendingAppends.length > 0) {
      const p = this.pendingAppends.shift()!
      clearTimeout(p.timer)
      p.reject(new Error(`audio-engine process terminated unexpectedly (code: ${code}, signal: ${signal})`))
    }
    while (this.pendingDeviceQueries.length > 0) {
      const p = this.pendingDeviceQueries.shift()!
      clearTimeout(p.timer)
      p.resolve([{ name: 'auto', description: 'Autoselect audio device' }])
    }

    if (this.isShuttingDown) return

    const now = Date.now()
    if (now - this.lastRestartTime > 10_000) {
      this.restartCount = 0
    }
    this.lastRestartTime = now
    this.restartCount++

    this.logger?.warn?.(
      'audio-engine-supervisor: worker exited (code: %s, signal: %s). Restart count: %d',
      code,
      signal,
      this.restartCount,
    )

    const shouldRestart = this.restartCount <= 5
    for (const cb of this.crashListeners) {
      cb({ code, signal, restarting: shouldRestart })
    }

    if (shouldRestart) {
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.spawnWorker()
          // If a track was playing, re-load state
          if (this.currentUri) {
            void this.load(this.currentUri).catch(() => undefined)
          }
        }
      }, 500)
    }
  }

  async load(
    uri: string,
    options?: { headers?: Record<string, string>; strategy?: string },
  ): Promise<LoadResult> {
    this.currentUri = uri
    this.start()

    if (!this.child || this.child.killed) {
      const err = new Error(`Audio engine executable not found or process not running. Cannot load: ${uri}`)
      this.logger?.warn?.('audio-engine-supervisor: %s', err.message)
      throw err
    }

    return new Promise<LoadResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingLoads.findIndex((p) => p.timer === timer)
        if (idx !== -1) {
          this.pendingLoads.splice(idx, 1)
          reject(new Error(`Timeout loading audio: ${uri}`))
        }
      }, 15_000)

      this.pendingLoads.push({ uri, resolve, reject, timer })
      this.sendCommand({ action: 'load', uri, options })
    })
  }

  play(atMs?: number): void {
    this.sendCommand({ action: 'play', atMs })
  }

  pause(): void {
    this.sendCommand({ action: 'pause' })
  }

  stop(): void {
    this.sendCommand({ action: 'stop' })
  }

  seek(positionMs: number): void {
    this.sendCommand({ action: 'seek', positionMs })
  }

  setVolume(volume: number): void {
    this.currentVolume = volume
    this.sendCommand({ action: 'setVolume', volume })
  }

  setMuted(muted: boolean): void {
    this.currentMuted = muted
    this.sendCommand({ action: 'setMuted', muted })
  }

  setOutputDevice(deviceId: string): void {
    this.currentDeviceId = deviceId
    this.sendCommand({ action: 'setOutputDevice', deviceId })
  }

  setDspConfig(config: DspConfig): void {
    this.currentDspConfig = config
    this.sendCommand({ action: 'setDspConfig', config })
  }

  setVisualizer(enabled: boolean, fftSize?: number): void {
    this.visualizerEnabled = enabled
    if (fftSize) this.currentFftSize = fftSize
    this.sendCommand({ action: 'setVisualizer', enabled, fftSize })
  }

  private sendCommand(cmd: Record<string, unknown>): void {
    if (!this.child || this.child.killed) return
    if (this.child.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(cmd) + '\n')
    }
  }

  onFftFrame(cb: (frame: FftFrame) => void): () => void {
    this.fftListeners.add(cb)
    return () => this.fftListeners.delete(cb)
  }

  onStateChange(cb: (event: PlaybackStateEvent) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb)
    return () => this.endedListeners.delete(cb)
  }

  onCrash(cb: (event: CrashEvent) => void): () => void {
    this.crashListeners.add(cb)
    return () => this.crashListeners.delete(cb)
  }

  onReady(cb: () => void): () => void {
    this.readyListeners.add(cb)
    return () => this.readyListeners.delete(cb)
  }

  async append(uri: string, playNow = false): Promise<void> {
    this.start()

    if (!this.child || this.child.killed) {
      const err = new Error(`Audio engine executable not found or process not running. Cannot append: ${uri}`)
      this.logger?.warn?.('audio-engine-supervisor: %s', err.message)
      throw err
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingAppends.findIndex((p) => p.timer === timer)
        if (idx !== -1) {
          this.pendingAppends.splice(idx, 1)
          reject(new Error(`Timeout appending audio: ${uri}`))
        }
      }, 10_000)

      this.pendingAppends.push({ uri, resolve, reject, timer })
      this.sendCommand({ action: 'append', uri, playNow })
    })
  }

  getAudioDevices(): Promise<Array<{ name: string; description: string }>> {
    this.start()

    if (!this.child || this.child.killed) {
      return Promise.resolve([{ name: 'auto', description: 'Autoselect audio device' }])
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pendingDeviceQueries.findIndex((p) => p.timer === timer)
        if (idx !== -1) {
          this.pendingDeviceQueries.splice(idx, 1)
          resolve([{ name: 'auto', description: 'Autoselect audio device' }])
        }
      }, 5_000)

      this.pendingDeviceQueries.push({ resolve, reject, timer })
      this.sendCommand({ action: 'getAudioDevices' })
    })
  }

  dispose(): void {
    void this.shutdown()
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true
    this.sendCommand({ action: 'dispose' })
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    while (this.pendingLoads.length > 0) {
      const p = this.pendingLoads.shift()!
      clearTimeout(p.timer)
      p.reject(new Error('Audio engine shut down'))
    }
    while (this.pendingAppends.length > 0) {
      const p = this.pendingAppends.shift()!
      clearTimeout(p.timer)
      p.reject(new Error('Audio engine shut down'))
    }
    while (this.pendingDeviceQueries.length > 0) {
      const p = this.pendingDeviceQueries.shift()!
      clearTimeout(p.timer)
      p.resolve([{ name: 'auto', description: 'Autoselect audio device' }])
    }
    this.pendingLoads = []
    this.pendingAppends = []
    this.pendingDeviceQueries = []
  }
}
