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
const distSidecarDir = join(desktopRoot, 'dist-sidecar')
const distDir = join(desktopRoot, 'dist')

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
Usage: node apps/desktop/scripts/package-desktop.js [options] [tauri build options]

Options:
  --skip-build             Skip frontend and sidecar build step
  --skip-audio-engine      Skip audio-engine compilation if binary exists
  --rebuild-audio-engine   Force recompiling audio-engine binary
  --skip-tests             Skip running audio-engine tests before packaging
  --no-strict, --optional  Stage libmpv without strict failure
  --dry-run                Run prep steps and frontend/sidecar build, skipping tauri packaging
  --help, -h               Show this help message

All other flags are forwarded directly to tauri build (e.g., -b, --bundles, -t, --target, -d, --debug, --no-bundle).
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

console.log('====================================================')
console.log('     BBeBee Desktop (Tauri) Application Packager   ')
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
  console.log(`[package-desktop] Existing audio engine found at: ${engineBinPath}`)
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
// Step 3: Verify bundled resources in bin, resources/bin, dist-sidecar
// ----------------------------------------------------
console.log('\n[package-desktop] [3/5] Verifying bundled artifacts in bin/ and resources/bin/...')
if (existsSync(resourcesBinDir)) {
  const stagedFiles = readdirSync(resourcesBinDir)
  console.log(`  Staged artifacts count (resources/bin): ${stagedFiles.length}`)
  const displayFiles = stagedFiles.slice(0, 10)
  for (const f of displayFiles) {
    console.log(`    - ${f}`)
  }
  if (stagedFiles.length > 10) {
    console.log(`    ... and ${stagedFiles.length - 10} more`)
  }
} else {
  console.warn('  Warning: resources/bin directory is empty or missing!')
}

// ----------------------------------------------------
// Step 4: Build Desktop Bundles (Frontend + Sidecar)
// ----------------------------------------------------
if (!skipBuild) {
  console.log('\n[package-desktop] [4/5] Building frontend (Vite) and sidecar (Vite SSR)...')
  const viteProc = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: isWin,
  })

  if (viteProc.status !== 0) {
    console.error(`[package-desktop] vite build failed with code ${viteProc.status}`)
    process.exit(viteProc.status || 1)
  }

  const sidecarProc = spawnSync('node', [join(__dirname, 'build-sidecar.js')], {
    cwd: desktopRoot,
    stdio: 'inherit',
  })

  if (sidecarProc.status !== 0) {
    console.error(`[package-desktop] sidecar build failed with code ${sidecarProc.status}`)
    process.exit(sidecarProc.status || 1)
  }
} else {
  console.log('\n[package-desktop] [4/5] Skipping frontend & sidecar build (--skip-build).')
}

// Verify dist and dist-sidecar exist
const sidecarEntry = join(distSidecarDir, 'index.mjs')
if (!existsSync(sidecarEntry)) {
  console.error(`[package-desktop] Error: sidecar entry not found at: ${sidecarEntry}`)
  process.exit(1)
}
console.log(`[package-desktop] Verified sidecar bundle at: ${sidecarEntry}`)

// Setup PKG_CONFIG_PATH on Linux to resolve local and sysroot pc files for deb bundling
const pkgConfigDirs = [
  join(desktopRoot, 'pkgconfig'),
  '/home/revers/.local/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig',
  '/usr/lib/x86_64-linux-gnu/pkgconfig',
  '/usr/share/pkgconfig',
].filter(existsSync)
const currentPkgPath = process.env.PKG_CONFIG_PATH || ''
const newPkgConfigPath = [...pkgConfigDirs, currentPkgPath].filter(Boolean).join(':')
const buildEnv = {
  ...process.env,
  PKG_CONFIG_PATH: newPkgConfigPath,
}

// On Linux, default to deb bundle if not explicitly specified
if (process.platform === 'linux' && !builderArgs.some((a) => a === '-b' || a === '--bundles' || a === '--no-bundle')) {
  builderArgs.push('-b', 'deb')
}

// ----------------------------------------------------
// Step 5: Package with Tauri
// ----------------------------------------------------
if (isDryRun) {
  console.log('\n[package-desktop] [5/5] Dry run enabled: skipping tauri build execution.')
  console.log(`  Would run: tauri build ${builderArgs.join(' ')}`)
  console.log('\n====================================================')
  console.log('       Desktop Packaging Dry Run Complete!          ')
  console.log('====================================================')
  process.exit(0)
}

console.log('\n[package-desktop] [5/5] Packaging with Tauri (tauri build)...')
// Tell tauri not to re-run beforeBuildCommand since Step 4 already built everything cleanly
const tauriCmdArgs = ['build', '--config', '{"build":{"beforeBuildCommand":""}}', ...builderArgs]

let packProc = spawnSync('pnpm', ['exec', 'tauri', ...tauriCmdArgs], {
  cwd: desktopRoot,
  stdio: 'inherit',
  shell: isWin,
  env: buildEnv,
})

if (packProc.status !== 0) {
  console.log('[package-desktop] Retrying packaging with npx @tauri-apps/cli...')
  packProc = spawnSync('npx', ['--yes', '@tauri-apps/cli', ...tauriCmdArgs], {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: isWin,
    env: buildEnv,
  })
}

if (packProc.status !== 0) {
  console.error(`[package-desktop] tauri build failed with code ${packProc.status}`)
  process.exit(packProc.status || 1)
}

const bundleDir = join(desktopRoot, 'src-tauri', 'target', 'release', 'bundle')
if (existsSync(bundleDir)) {
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })
  function copyBundles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        copyBundles(fullPath)
      } else if (entry.isFile()) {
        const dest = join(distDir, entry.name)
        copyFileSync(fullPath, dest)
        console.log(`[package-desktop] Staged bundle artifact: ${entry.name} -> dist/`)
      }
    }
  }
  copyBundles(bundleDir)
}

console.log('\n====================================================')
console.log('       Desktop Packaging Finished Successfully!     ')
console.log('====================================================')
console.log(`Target binaries and bundles located in: ${join(desktopRoot, 'src-tauri', 'target', 'release')}`)

