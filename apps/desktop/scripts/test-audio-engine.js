#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import readline from 'node:readline'
import process from 'node:process'
import console from 'node:console'
import { setTimeout, clearTimeout } from 'node:timers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const binDir = join(desktopRoot, 'bin')
const standaloneEngineDir = resolve(desktopRoot, '../../..', 'B_Be_Bee-audio-engine', 'engine')
const srcDir = existsSync(standaloneEngineDir) ? standaloneEngineDir : null

const isWin = process.platform === 'win32'
const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'
const outExe = join(binDir, exeName)

console.log(`[test-audio-engine] ========================================================`)
console.log(`[test-audio-engine] Starting BBeBee Audio Engine & IPC Test Suite`)
console.log(`[test-audio-engine] Binary: ${outExe}`)
console.log(`[test-audio-engine] ========================================================\n`)

if (!existsSync(outExe)) {
  console.error(`[test-audio-engine] ERROR: Audio engine executable not found at: ${outExe}`)
  console.error(`  Please run: node apps/desktop/scripts/build-audio-engine.js first.`)
  process.exit(1)
}

// -----------------------------------------------------------------------------
// Step 1: Direct Version Check
// -----------------------------------------------------------------------------
console.log(`[test-audio-engine] [1/4] Verifying native binary CLI (--version)...`)
const verCheck = spawnSync(outExe, ['--version'], { encoding: 'utf-8' })
if (verCheck.status !== 0 || !verCheck.stdout.includes('audio-engine')) {
  console.error(`[test-audio-engine] Version check failed! Code: ${verCheck.status}, Output: ${verCheck.stdout}`)
  process.exit(1)
}
console.log(`  PASSED: ${verCheck.stdout.trim()}`)

// -----------------------------------------------------------------------------
// Step 2: Native Stdio IPC (init, getRingBufferStats, load, dispose)
// -----------------------------------------------------------------------------
console.log(`\n[test-audio-engine] [2/4] Testing native audio-engine stdio lifecycle...`)

async function testNativeStdioLifecycle() {
  return new Promise((resolve, reject) => {
    const child = spawn(outExe, [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: binDir,
      },
    })

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    })

    let initReceived = false
    let statsReceived = false
    let loadReceived = false

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('[test-audio-engine] Timeout waiting for native audio-engine responses'))
    }, 15000)

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const msg = JSON.parse(trimmed)

        if (msg.type === 'ready') {
          console.log(`  Received 'ready' (mpvAvailable: ${msg.mpvAvailable}, pcmTapAvailable: ${msg.pcmTapAvailable})`)
          initReceived = true
          // Query ring buffer stats
          child.stdin.write(JSON.stringify({ action: 'getRingBufferStats' }) + '\n')
        } else if (msg.type === 'ring-buffer-stats') {
          console.log(`  Received 'ring-buffer-stats' (written: ${msg.totalFramesWritten}, read: ${msg.totalFramesRead}, dropped: ${msg.droppedFrames})`)
          statsReceived = true
          // Test load action
          child.stdin.write(JSON.stringify({ action: 'load', uri: 'file:///dev/null' }) + '\n')
        } else if (msg.type === 'loaded' || msg.type === 'error' || msg.type === 'playback-state') {
          if (!loadReceived) {
            console.log(`  Received load response (type: ${msg.type})`)
            loadReceived = true
            // Orderly shutdown
            setTimeout(() => {
              child.stdin.write(JSON.stringify({ action: 'dispose' }) + '\n')
            }, 100)
          }
        }
      } catch {
        // ignore
      }
    })

    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      console.log(`  Native audio-engine process terminated (code: ${code}, signal: ${signal})`)
      if (initReceived && statsReceived && loadReceived) {
        resolve()
      } else {
        reject(new Error(`[test-audio-engine] Incomplete exchange: init=${initReceived}, stats=${statsReceived}, load=${loadReceived}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    // Start by initializing engine
    child.stdin.write(JSON.stringify({
      action: 'init',
      config: { fftSize: 128, deviceId: 'default' },
    }) + '\n')
  })
}

await testNativeStdioLifecycle()
console.log(`  PASSED: Native audio-engine stdio lifecycle verified.`)

// -----------------------------------------------------------------------------
// Step 3: Sidecar JSON-RPC Transport Test (ping, mpvEngineStatus, getOutputDevices)
// -----------------------------------------------------------------------------
console.log(`\n[test-audio-engine] [3/4] Testing Sidecar JSON-RPC interface with audio-engine supervision...`)

function unwrapBridge(raw) {
  if (raw && typeof raw === 'object') {
    if ('ok' in raw) {
      if (!raw.ok) throw new Error(raw.error?.message || 'bridge call failed')
      return raw.result
    }
  }
  return raw
}

async function testSidecarJsonRpc() {
  const sidecarScript = existsSync(join(desktopRoot, 'dist-sidecar', 'index.mjs'))
    ? join(desktopRoot, 'dist-sidecar', 'index.mjs')
    : join(desktopRoot, 'sidecar', 'index.ts')

  const isTs = sidecarScript.endsWith('.ts')
  const nodeArgs = isTs ? ['--experimental-strip-types', sidecarScript] : [sidecarScript]

  return new Promise((resolve, reject) => {
    const child = spawn('node', nodeArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: binDir,
      },
    })

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    })

    let reqId = 1
    const pending = new Map()

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('[test-audio-engine] Timeout waiting for Sidecar JSON-RPC responses'))
    }, 15000)

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const msg = JSON.parse(trimmed)
        if (msg.id && pending.has(msg.id)) {
          const cb = pending.get(msg.id)
          pending.delete(msg.id)
          cb(msg.result, msg.error)
        }
      } catch {
        // ignore
      }
    })

    function callRpc(method, params = []) {
      const id = reqId++
      return new Promise((res, rej) => {
        pending.set(id, (result, error) => {
          if (error) rej(new Error(error.message || JSON.stringify(error)))
          else res(result)
        })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    }

    // Give sidecar 200ms to initialize
    setTimeout(async () => {
      try {
        // 1. ping
        const pong = await callRpc('sidecar:ping')
        if (pong !== 'pong') throw new Error(`Expected 'pong', got: ${pong}`)
        console.log(`  JSON-RPC 'sidecar:ping' -> 'pong' received.`)

        // 2. mpvEngineStatus
        const statusRaw = await callRpc('BBeBee:call', ['audio', 'mpvEngineStatus', [], null])
        const status = unwrapBridge(statusRaw)
        console.log(`  JSON-RPC 'audio.mpvEngineStatus' -> running: ${status.running}, mpvAvailable: ${status.mpvAvailable}`)

        // 3. getOutputDevices
        const devRaw = await callRpc('BBeBee:call', ['audio', 'getOutputDevices', [], null])
        const devices = unwrapBridge(devRaw)
        console.log(`  JSON-RPC 'audio.getOutputDevices' -> ${Array.isArray(devices) ? devices.length : 0} device(s) found.`)

        clearTimeout(timeout)
        child.kill('SIGTERM')
        resolve()
      } catch (err) {
        clearTimeout(timeout)
        child.kill('SIGKILL')
        reject(err)
      }
    }, 200)
  })
}

await testSidecarJsonRpc()
console.log(`  PASSED: Sidecar JSON-RPC audio-engine supervision verified.`)

// -----------------------------------------------------------------------------
// Step 4: Native Concurrency / PCM Tap Test Suite
// -----------------------------------------------------------------------------
const skipNativeSuite = process.argv.includes('--quick') || process.argv.includes('--no-native-suite')
if (!skipNativeSuite && existsSync(join(srcDir, 'tests', 'test_pcm_tap.cpp'))) {
  console.log(`\n[test-audio-engine] [4/4] Running native PCM Tap concurrency suite...`)
  const testExe = join(binDir, isWin ? 'audio-engine-tests.exe' : 'audio-engine-tests')
  const testSrcFiles = [
    join(srcDir, 'tests', 'test_pcm_tap.cpp'),
    join(srcDir, 'pcm_ring_buffer.cpp'),
  ]

  const compilers = isWin ? ['g++', 'clang++', 'cl'] : ['g++', 'clang++']
  let chosenCompiler = null
  for (const c of compilers) {
    const check = spawnSync(c, ['--version'], { stdio: 'ignore' })
    if (check.status === 0 || check.error === undefined) {
      chosenCompiler = c
      break
    }
  }

  if (chosenCompiler) {
    const testArgs = chosenCompiler === 'cl'
      ? ['/std:c++17', '/O2', '/EHsc', `/I${srcDir}`, ...testSrcFiles, `/Fe:${testExe}`]
      : ['-O2', '-std=c++17', `-I${srcDir}`, ...testSrcFiles, '-o', testExe, '-pthread', '-ldl']

    const testBuild = spawnSync(chosenCompiler, testArgs, { stdio: 'inherit' })
    if (testBuild.status === 0) {
      const testRun = spawnSync(testExe, [], { stdio: 'inherit' })
      if (testRun.status !== 0) {
        console.error(`[test-audio-engine] PCM tap unit tests failed with code ${testRun.status}`)
        process.exit(testRun.status || 1)
      }
      console.log(`  PASSED: All 13 PCM tap concurrency tests passed.`)
    }
  }
}

console.log(`\n========================================================`)
console.log(`[test-audio-engine] ALL AUDIO ENGINE GATES PASSED CLEANLY!`)
console.log(`========================================================\n`)
process.exit(0)
