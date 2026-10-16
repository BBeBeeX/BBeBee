#!/usr/bin/env node
import { existsSync, mkdirSync, chmodSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'
import { bundleMpvDeps } from './bundle-mpv-deps.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktop2Root = join(__dirname, '..')
const desktopRoot = join(desktop2Root, '..', 'desktop')
const binDir = join(desktop2Root, 'bin')
const resourcesBinDir = join(desktop2Root, 'resources', 'bin')
const srcDir = join(desktopRoot, 'native', 'audio-engine')
const srcFiles = [
  join(srcDir, 'main.cpp'),
  join(srcDir, 'pcm_ring_buffer.cpp'),
]

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true })
}
if (!existsSync(resourcesBinDir)) {
  mkdirSync(resourcesBinDir, { recursive: true })
}

const isWin = process.platform === 'win32'
const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'
const outExe = join(binDir, exeName)
const resourcesExe = join(resourcesBinDir, exeName)

console.log(`[build-audio-engine] Compiling standalone native audio-engine executable...`)
console.log(`  Sources: ${srcFiles.join(', ')}`)
console.log(`  Target: ${outExe}`)

// Detect compiler
const compilers = isWin ? ['g++', 'clang++', 'cl'] : ['g++', 'clang++']
let chosenCompiler = null

for (const c of compilers) {
  const check = spawnSync(c, ['--version'], { stdio: 'ignore' })
  if (check.status === 0 || check.error === undefined) {
    chosenCompiler = c
    break
  }
}

if (!chosenCompiler) {
  console.error('[build-audio-engine] Error: No suitable C++17 compiler (g++, clang++, or cl) found.')
  process.exit(1)
}

const unixFlags = []
if (!isWin) {
  unixFlags.push('-pthread', '-ldl')
  if (process.platform === 'darwin') {
    unixFlags.push('-Wl,-rpath,@executable_path', '-Wl,-rpath,@loader_path')
  } else if (process.platform === 'linux') {
    unixFlags.push('-Wl,-rpath,$ORIGIN')
  }
}

const args = chosenCompiler === 'cl'
  ? ['/std:c++17', '/O2', '/EHsc', '/utf-8', `/I${srcDir}`, ...srcFiles, `/Fe:${outExe}`]
  : ['-O2', '-std=c++17', `-I${srcDir}`, ...srcFiles, '-o', outExe, ...unixFlags]

console.log(`[build-audio-engine] Running: ${chosenCompiler} ${args.join(' ')}`)
const buildProc = spawnSync(chosenCompiler, args, { stdio: 'inherit' })

if (buildProc.status !== 0) {
  console.error(`[build-audio-engine] Compilation failed with code ${buildProc.status}`)
  process.exit(buildProc.status || 1)
}

if (!isWin) {
  try {
    chmodSync(outExe, 0o755)
  } catch (err) {
    console.warn(`[build-audio-engine] Failed to set executable permission:`, err)
  }
}

// Sync to resources/bin for packaged application builds
try {
  copyFileSync(outExe, resourcesExe)
  if (!isWin) chmodSync(resourcesExe, 0o755)
  console.log(`[build-audio-engine] Packaged resource synced at: ${resourcesExe}`)
} catch (err) {
  console.warn(`[build-audio-engine] Failed to sync to resources/bin:`, err)
}

// Stage vendored platform libmpv beside the binary if available
const vendorPlatform = isWin ? 'win64' : process.platform === 'darwin' ? 'darwin' : 'linux'
const vendorDirs = [
  join(desktop2Root, 'resources', 'libmpv', vendorPlatform),
  join(desktopRoot, 'resources', 'libmpv', vendorPlatform),
]

for (const vendorDir of vendorDirs) {
  if (existsSync(vendorDir)) {
    let staged = 0
    for (const f of readdirSync(vendorDir)) {
      if (!f.endsWith('.dll') && !f.includes('.so') && !f.endsWith('.dylib')) continue
      copyFileSync(join(vendorDir, f), join(binDir, f))
      copyFileSync(join(vendorDir, f), join(resourcesBinDir, f))
      if (!isWin) {
        try { chmodSync(join(binDir, f), 0o755) } catch { /* ignore */ }
        try { chmodSync(join(resourcesBinDir, f), 0o755) } catch { /* ignore */ }
      }
      staged++
    }
    if (staged > 0) {
      console.log(`[build-audio-engine] Vendored libmpv staged: ${staged} libraries → bin/ + resources/bin/`)
      break
    }
  }
}

// On Linux, bundle transitive libmpv dependencies closure with ldd
if (process.platform === 'linux') {
  const libmpvBin = ['libmpv.so.2', 'libmpv.so'].find((f) => existsSync(join(binDir, f)))
  if (libmpvBin) {
    bundleMpvDeps(join(binDir, libmpvBin), binDir)
  }
  const libmpvRes = ['libmpv.so.2', 'libmpv.so'].find((f) => existsSync(join(resourcesBinDir, f)))
  if (libmpvRes) {
    bundleMpvDeps(join(resourcesBinDir, libmpvRes), resourcesBinDir)
  }
}

console.log(`[build-audio-engine] Standalone audio-engine built successfully at: ${outExe}`)

const skipVerify = process.env['SKIP_VERIFY'] === '1' || process.argv.includes('--no-verify')
if (!skipVerify) {
  console.log(`[build-audio-engine] Verifying executable (${outExe} --version)...`)
  const verifyProc = spawnSync(outExe, ['--version'], { stdio: 'inherit' })
  if (verifyProc.status !== 0) {
    console.error(`[build-audio-engine] Verification failed with exit code ${verifyProc.status}`)
    process.exit(verifyProc.status || 1)
  }
}
