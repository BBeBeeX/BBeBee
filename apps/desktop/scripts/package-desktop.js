#!/usr/bin/env node
import { existsSync, readdirSync, chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const binDir = join(desktopRoot, 'bin')
const resourcesBinDir = join(desktopRoot, 'resources', 'bin')

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true })
if (!existsSync(resourcesBinDir)) mkdirSync(resourcesBinDir, { recursive: true })

const isWin = process.platform === 'win32'
const engineExeName = isWin ? 'audio-engine.exe' : 'audio-engine'
const engineBinPath = join(binDir, engineExeName)
const engineResourcesPath = join(resourcesBinDir, engineExeName)

// Parse arguments
const rawArgs = process.argv.slice(2)

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`
Usage: node apps/desktop/scripts/package-desktop.js [options] [electron-builder options]

Options:
  --skip-build             Skip electron-vite build step
  --skip-audio-engine      Skip audio-engine compilation if binary exists
  --rebuild-audio-engine   Force recompiling audio-engine binary
  --skip-tests             Skip running audio-engine tests before packaging
  --no-strict, --optional  Stage libmpv without strict failure
  --dry-run                Run prep steps and electron-vite build, skipping electron-builder
  --help, -h               Show this help message

All other flags are forwarded directly to electron-builder (e.g., --publish never, --dir, -l, -w, -m).
`)
  process.exit(0)
}

let skipBuild = false
let skipAudioEngine = false
let rebuildAudioEngine = false
let skipTests = false
let isStrictLibmpv = true
let isDryRun = false
const builderArgs = []

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]
  if (arg === '--skip-build') {
    skipBuild = true
  } else if (arg === '--skip-audio-engine') {
    skipAudioEngine = true
  } else if (arg === '--rebuild-audio-engine') {
    rebuildAudioEngine = true
  } else if (arg === '--skip-tests' || arg === '--skip-test') {
    skipTests = true
  } else if (arg === '--no-strict' || arg === '--optional') {
    isStrictLibmpv = false
  } else if (arg === '--dry-run') {
    isDryRun = true
  } else {
    builderArgs.push(arg)
  }
}

// Default to --publish never if --publish is not specified
if (!builderArgs.some((a) => a.startsWith('--publish'))) {
  builderArgs.push('--publish', 'never')
}

console.log('====================================================')
console.log('       BBeBee Desktop Application Packager         ')
console.log('====================================================')
console.log(`Platform: ${process.platform} (${process.arch})`)
console.log(`Desktop root: ${desktopRoot}`)
console.log(`Builder arguments: ${builderArgs.join(' ')}\n`)

// ----------------------------------------------------
// Step 1: Ensure Native Audio Engine
// ----------------------------------------------------
console.log('[package-desktop] [1/5] Checking native audio engine...')
const engineExists = existsSync(engineBinPath) || existsSync(engineResourcesPath)

if (!engineExists || rebuildAudioEngine) {
  if (skipAudioEngine && engineExists) {
    console.log('[package-desktop] Skipping audio-engine build as requested.')
  } else {
    console.log('[package-desktop] Compiling audio-engine binary...')
    const buildEngineProc = spawnSync('node', [join(__dirname, 'build-audio-engine.js')], {
      cwd: desktopRoot,
      stdio: 'inherit',
    })
    if (buildEngineProc.status !== 0) {
      console.error(`[package-desktop] Audio engine build failed with code ${buildEngineProc.status}`)
      process.exit(buildEngineProc.status || 1)
    }
  }
} else {
  console.log(`[package-desktop] Existing audio engine found.`)
}

// Ensure binaries exist in both bin and resources/bin, and set permissions
if (existsSync(engineBinPath) && !existsSync(engineResourcesPath)) {
  copyFileSync(engineBinPath, engineResourcesPath)
} else if (existsSync(engineResourcesPath) && !existsSync(engineBinPath)) {
  copyFileSync(engineResourcesPath, engineBinPath)
}

if (!isWin) {
  try {
    if (existsSync(engineBinPath)) chmodSync(engineBinPath, 0o755)
    if (existsSync(engineResourcesPath)) chmodSync(engineResourcesPath, 0o755)
  } catch (err) {
    console.warn('[package-desktop] Warning: unable to set executable permission:', err)
  }
}

// ----------------------------------------------------
// Step 1.5: Test Native Audio Engine
// ----------------------------------------------------
if (!skipTests) {
  console.log('\n[package-desktop] [1.5/5] Testing audio engine prior to packaging...')
  const testProc = spawnSync('node', [join(__dirname, 'test-audio-engine.js')], {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: { ...process.env, TEST_AUDIO_ENGINE: '1' },
  })
  if (testProc.status !== 0) {
    console.error(`[package-desktop] Audio engine tests failed with code ${testProc.status}. Aborting packaging.`)
    process.exit(testProc.status || 1)
  }
} else {
  console.log('\n[package-desktop] [1.5/5] Skipping audio engine tests as requested.')
}

// ----------------------------------------------------
// Step 2: Stage platform libmpv
// ----------------------------------------------------
console.log('\n[package-desktop] [2/5] Staging platform libmpv...')
const fetchArgs = [join(__dirname, 'fetch-libmpv.js')]
if (isStrictLibmpv) fetchArgs.push('--strict')
else fetchArgs.push('--optional')

const fetchProc = spawnSync('node', fetchArgs, {
  cwd: desktopRoot,
  stdio: 'inherit',
})

if (fetchProc.status !== 0) {
  console.error(`[package-desktop] libmpv staging failed with code ${fetchProc.status}`)
  process.exit(fetchProc.status || 1)
}

// ----------------------------------------------------
// Step 3: Verify bundled resources in resources/bin
// ----------------------------------------------------
console.log('\n[package-desktop] [3/5] Verifying bundled artifacts in resources/bin...')
if (existsSync(resourcesBinDir)) {
  const stagedFiles = readdirSync(resourcesBinDir)
  console.log(`  Staged artifacts count: ${stagedFiles.length}`)
  for (const f of stagedFiles) {
    console.log(`    - ${f}`)
  }
} else {
  console.warn('  Warning: resources/bin directory is empty or missing!')
}

// ----------------------------------------------------
// Step 4: Build Desktop Application (electron-vite)
// ----------------------------------------------------
if (!skipBuild) {
  console.log('\n[package-desktop] [4/5] Building desktop bundles (electron-vite)...')
  const viteProc = spawnSync('pnpm', ['exec', 'electron-vite', 'build'], {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: true,
  })

  if (viteProc.status !== 0) {
    console.error(`[package-desktop] electron-vite build failed with code ${viteProc.status}`)
    process.exit(viteProc.status || 1)
  }
} else {
  console.log('\n[package-desktop] [4/5] Skipping electron-vite build (--skip-build).')
}

// ----------------------------------------------------
// Step 5: Package with electron-builder
// ----------------------------------------------------
if (isDryRun) {
  console.log('\n[package-desktop] [5/5] Dry run enabled: skipping electron-builder execution.')
  console.log(`  Would run: electron-builder --config electron-builder.yml ${builderArgs.join(' ')}`)
  console.log('\n====================================================')
  console.log('       Desktop Packaging Dry Run Complete!          ')
  console.log('====================================================')
  process.exit(0)
}

console.log('\n[package-desktop] [5/5] Packaging with electron-builder...')
const builderCmdArgs = ['--config', 'electron-builder.yml', ...builderArgs]

// First attempt using pnpm exec electron-builder, fallback to npx
let packProc = spawnSync('pnpm', ['exec', 'electron-builder', ...builderCmdArgs], {
  cwd: desktopRoot,
  stdio: 'inherit',
  shell: true,
})

if (packProc.status !== 0) {
  console.log('[package-desktop] Retrying packaging with npx electron-builder...')
  packProc = spawnSync('npx', ['--yes', 'electron-builder', ...builderCmdArgs], {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: true,
  })
}

if (packProc.status !== 0) {
  console.error(`[package-desktop] electron-builder failed with code ${packProc.status}`)
  process.exit(packProc.status || 1)
}

console.log('\n====================================================')
console.log('       Desktop Packaging Finished Successfully!     ')
console.log('====================================================')
console.log(`Artifacts located in: ${join(desktopRoot, 'dist')}`)
