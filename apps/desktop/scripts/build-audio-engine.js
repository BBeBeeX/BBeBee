#!/usr/bin/env node
import { existsSync, mkdirSync, chmodSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const binDir = join(desktopRoot, 'bin')
const srcDir = join(desktopRoot, 'native', 'audio-engine')
const srcFile = join(srcDir, 'main.cpp')

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true })
}

const isWin = process.platform === 'win32'
const outExe = join(binDir, isWin ? 'audio-engine.exe' : 'audio-engine')

console.log(`[build-audio-engine] Compiling standalone native audio-engine executable...`)
console.log(`  Source: ${srcFile}`)
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
  ? ['/std:c++17', '/O2', '/EHsc', '/utf-8', srcFile, `/Fe:${outExe}`]
  : ['-O2', '-std=c++17', srcFile, '-o', outExe, ...unixFlags]

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

// Also sync to resources/bin for packaged application builds
const resourcesBinDir = join(desktopRoot, 'resources', 'bin')
if (!existsSync(resourcesBinDir)) {
  mkdirSync(resourcesBinDir, { recursive: true })
}
const resourcesExe = join(resourcesBinDir, isWin ? 'audio-engine.exe' : 'audio-engine')
try {
  copyFileSync(outExe, resourcesExe)
  if (!isWin) chmodSync(resourcesExe, 0o755)
  console.log(`[build-audio-engine] Packaged resource synced at: ${resourcesExe}`)
} catch (err) {
  console.warn(`[build-audio-engine] Failed to sync to resources/bin:`, err)
}

// Stage the vendored platform libmpv beside the binary: dev testing and
// electron-builder packaging both consume it without a system libmpv.
const vendorDir = join(desktopRoot, 'resources', 'libmpv', isWin ? 'win64' : process.platform === 'darwin' ? 'darwin' : 'linux')
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
  console.log(`[build-audio-engine] Vendored libmpv staged: ${staged} libraries → bin/ + resources/bin/`)
} else {
  console.warn(`[build-audio-engine] No vendored libmpv for this platform (${vendorDir}) — the engine will need a system libmpv at runtime.`)
}

console.log(`[build-audio-engine] Standalone audio-engine built successfully at: ${outExe}`)
