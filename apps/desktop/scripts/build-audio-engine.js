#!/usr/bin/env node
import { existsSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const rootDir = resolve(desktopRoot, '..', '..')
const binDir = join(desktopRoot, 'bin')
const resourcesBinDir = join(desktopRoot, 'resources', 'bin')
const isWin = process.platform === 'win32'
const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'
const outExe = join(binDir, exeName)
const resourcesExe = join(resourcesBinDir, exeName)

const args = process.argv.slice(2)
let fromSourcePath = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from-source') {
    fromSourcePath = args[++i]
  } else if (args[i].startsWith('--from-source=')) {
    fromSourcePath = args[i].split('=')[1]
  }
}

if (!fromSourcePath) {
  // Default behavior: Fetch precompiled audio-engine & patched libmpv release artifacts
  console.log(`[build-audio-engine] Staging desktop audio-engine via fetch-audio-engine.mjs...`)
  const fetchScript = join(rootDir, 'scripts', 'fetch-audio-engine.mjs')
  const fetchArgs = ['--app', 'desktop', ...args]
  const res = spawnSync('node', [fetchScript, ...fetchArgs], {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
  })

  if (res.status !== 0) {
    console.error(`[build-audio-engine] Failed to fetch audio-engine artifacts (exit code ${res.status})`)
    process.exit(res.status || 1)
  }
} else {
  // Escape hatch: Compile from source directly
  const sourceRoot = resolve(process.cwd(), fromSourcePath)
  console.log(`[build-audio-engine] Building from source escape hatch: ${sourceRoot}`)

  const candidateDirs = [
    join(sourceRoot, 'engine'),
    join(sourceRoot, 'native', 'audio-engine'),
    sourceRoot,
  ]
  const srcDir = candidateDirs.find((d) => existsSync(join(d, 'main.cpp')))
  if (!srcDir) {
    console.error(`[build-audio-engine] Error: Cannot find audio-engine C++ sources in ${sourceRoot}`)
    process.exit(1)
  }

  const srcFiles = [
    join(srcDir, 'main.cpp'),
    join(srcDir, 'pcm_ring_buffer.cpp'),
  ]

  if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true })
  if (!existsSync(resourcesBinDir)) mkdirSync(resourcesBinDir, { recursive: true })

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
    console.error('[build-audio-engine] Error: No suitable C++17 compiler found.')
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

  const compileArgs = chosenCompiler === 'cl'
    ? ['/std:c++17', '/O2', '/EHsc', '/utf-8', `/I${srcDir}`, ...srcFiles, `/Fe:${outExe}`]
    : ['-O2', '-std=c++17', `-I${srcDir}`, ...srcFiles, '-o', outExe, ...unixFlags]

  console.log(`[build-audio-engine] Running: ${chosenCompiler} ${compileArgs.join(' ')}`)
  const buildProc = spawnSync(chosenCompiler, compileArgs, { stdio: 'inherit' })
  if (buildProc.status !== 0) {
    console.error(`[build-audio-engine] Compilation failed with code ${buildProc.status}`)
    process.exit(buildProc.status || 1)
  }

  if (!isWin) {
    try { chmodSync(outExe, 0o755) } catch { /* ignore */ }
  }

  try {
    copyFileSync(outExe, resourcesExe)
    if (!isWin) chmodSync(resourcesExe, 0o755)
  } catch (err) {
    console.warn(`[build-audio-engine] Failed to sync to resources/bin:`, err)
  }
}

const skipVerify = process.env['SKIP_VERIFY'] === '1' || args.includes('--no-verify')
if (!skipVerify && existsSync(outExe)) {
  console.log(`[build-audio-engine] Verifying executable (${outExe} --version)...`)
  const verifyProc = spawnSync(outExe, ['--version'], { stdio: 'inherit' })
  if (verifyProc.status !== 0) {
    console.error(`[build-audio-engine] Verification failed with exit code ${verifyProc.status}`)
    process.exit(verifyProc.status || 1)
  }
}
console.log(`[build-audio-engine] Audio engine ready at: ${outExe}`)
