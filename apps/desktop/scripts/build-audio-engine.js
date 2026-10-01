#!/usr/bin/env node
import { existsSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs'
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

const args = chosenCompiler === 'cl'
  ? ['/std:c++17', '/O2', '/EHsc', srcFile, `/Fe:${outExe}`]
  : ['-O2', '-std=c++17', srcFile, '-o', outExe, ...(!isWin ? ['-pthread', '-ldl'] : [])]

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

console.log(`[build-audio-engine] Standalone audio-engine built successfully at: ${outExe}`)
