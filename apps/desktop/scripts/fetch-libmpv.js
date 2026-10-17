#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readdirSync, lstatSync, readlinkSync, readFileSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'
import { bundleMpvDeps } from './bundle-mpv-deps.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const resourcesBinDir = join(desktopRoot, 'resources', 'bin')
const binDir = join(desktopRoot, 'bin')

if (!existsSync(resourcesBinDir)) {
  mkdirSync(resourcesBinDir, { recursive: true })
}
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true })
}

const args = process.argv.slice(2)
const isStrict = args.includes('--strict') || Boolean(process.env['CI'] && !args.includes('--optional'))

// Target platform override or current OS
let targetPlatform = process.platform
for (const arg of args) {
  if (arg.startsWith('--platform=')) {
    targetPlatform = arg.split('=')[1]
  }
}

console.log(`[fetch-libmpv] Staging libmpv for platform: ${targetPlatform} (strict=${isStrict})`)
console.log(`  Target directory: ${resourcesBinDir}`)

function hasLibmpv(dir) {
  if (targetPlatform === 'win32') {
    return existsSync(join(dir, 'mpv-2.dll')) || existsSync(join(dir, 'libmpv-2.dll'))
  }
  if (targetPlatform === 'darwin') {
    return existsSync(join(dir, 'libmpv.dylib')) || existsSync(join(dir, 'libmpv.2.dylib'))
  }
  if (targetPlatform === 'linux') {
    return existsSync(join(dir, 'libmpv.so.2')) || existsSync(join(dir, 'libmpv.so'))
  }
  return false
}

function syncToBin() {
  const syncDir = (fromDir, toDir) => {
    if (!existsSync(fromDir)) return
    for (const f of readdirSync(fromDir)) {
      if (f.endsWith('.dll') || f.includes('.so') || f.endsWith('.dylib')) {
        const dest = join(toDir, f)
        if (!existsSync(dest)) {
          try {
            copyFileSync(join(fromDir, f), dest)
          } catch {
            // ignore
          }
        }
      }
    }
  }
  syncDir(resourcesBinDir, binDir)
  syncDir(binDir, resourcesBinDir)
}

function ensureLinuxDepsStaged() {
  if (targetPlatform !== 'linux') return
  syncToBin()
  const stagedRes = ['libmpv.so.2', 'libmpv.so'].map((f) => join(resourcesBinDir, f)).find(existsSync)
  if (stagedRes) bundleMpvDeps(stagedRes, resourcesBinDir)
  const stagedBin = ['libmpv.so.2', 'libmpv.so'].map((f) => join(binDir, f)).find(existsSync)
  if (stagedBin) bundleMpvDeps(stagedBin, binDir)
  syncToBin()
}

// 0. Fetch via fetch-audio-engine.mjs
try {
  const fetchScript = join(desktopRoot, '..', '..', 'scripts', 'fetch-audio-engine.mjs')
  if (existsSync(fetchScript)) {
    console.log(`[fetch-libmpv] Fetching prebuilt audio-engine / libmpv via fetch-audio-engine.mjs...`)
    spawnSync('node', [fetchScript, '--app', 'desktop'], { stdio: 'inherit' })
  }
} catch (err) {
  console.warn(`[fetch-libmpv] fetch-audio-engine.mjs invocation failed:`, err)
}

if (hasLibmpv(resourcesBinDir) || hasLibmpv(binDir)) {
  console.log(`[fetch-libmpv] libmpv already present in desktop.`)
  ensureLinuxDepsStaged()
  process.exit(0)
}

// 1. Check custom path from environment
const customPath = process.env['LIBMPV_PATH'] || process.env['MPV_PATH']
if (customPath && existsSync(customPath)) {
  console.log(`[fetch-libmpv] Found libmpv at custom path: ${customPath}`)
  const stat = lstatSync(customPath)
  if (stat.isDirectory()) {
    const files = readdirSync(customPath)
    for (const f of files) {
      if (f.includes('mpv') || f.endsWith('.dll') || f.endsWith('.so') || f.endsWith('.dylib')) {
        copyFileSync(join(customPath, f), join(resourcesBinDir, f))
        copyFileSync(join(customPath, f), join(binDir, f))
      }
    }
  } else {
    const filename = customPath.split(/[/\\]/).pop()
    copyFileSync(customPath, join(resourcesBinDir, filename))
    copyFileSync(customPath, join(binDir, filename))
  }
  if (hasLibmpv(resourcesBinDir)) {
    console.log(`[fetch-libmpv] Staged custom libmpv successfully.`)
    ensureLinuxDepsStaged()
    process.exit(0)
  }
}

// 2. Search host system libraries and copy transitive media dependencies
function copyResolvedFile(srcPath, destPath) {
  try {
    let current = srcPath
    while (lstatSync(current).isSymbolicLink()) {
      const link = readlinkSync(current)
      current = resolve(dirname(current), link)
    }
    copyFileSync(current, destPath)
    console.log(`[fetch-libmpv] Copied: ${srcPath} -> ${destPath}`)
    return true
  } catch (err) {
    console.warn(`[fetch-libmpv] Warning: failed to copy ${srcPath}:`, err)
    return false
  }
}

function bundleMacDependencies(mainDylibPath, targetDir) {
  try {
    const result = spawnSync('otool', ['-L', mainDylibPath], { encoding: 'utf-8' })
    if (result.status !== 0 || !result.stdout) return

    const lines = result.stdout.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      const depPath = trimmed.split(' ')[0]
      if (depPath && (depPath.startsWith('/opt/homebrew') || depPath.startsWith('/usr/local/opt') || depPath.includes('Cellar'))) {
        if (existsSync(depPath)) {
          const depName = basename(depPath)
          const dest = join(targetDir, depName)
          if (!existsSync(dest)) {
            copyResolvedFile(depPath, dest)
          }
          try {
            spawnSync('install_name_tool', ['-change', depPath, `@rpath/${depName}`, mainDylibPath], { stdio: 'ignore' })
          } catch {
            // ignore
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[fetch-libmpv] Warning: failed to trace macOS dependencies via otool:`, err)
  }
}

if (targetPlatform === 'linux') {
  const linuxSearchPaths = [
    '/usr/lib/x86_64-linux-gnu',
    '/usr/lib64',
    '/usr/lib',
    '/usr/local/lib',
    '/lib/x86_64-linux-gnu',
    '/lib64',
  ]

  let primaryLibPath = null
  for (const dir of linuxSearchPaths) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.startsWith('libmpv.so')) {
          const fullPath = join(dir, entry)
          copyResolvedFile(fullPath, join(resourcesBinDir, entry))
          copyResolvedFile(fullPath, join(binDir, entry))
          if (!primaryLibPath && entry.includes('so.2')) {
            primaryLibPath = fullPath
          } else if (!primaryLibPath) {
            primaryLibPath = fullPath
          }
        }
      }
    } catch {
      // Directory unreadable or permission denied
    }
  }

  if (primaryLibPath) {
    const files = readdirSync(resourcesBinDir)
    const base = files.find((f) => f.startsWith('libmpv.so'))
    if (base) {
      for (const d of [resourcesBinDir, binDir]) {
        if (!existsSync(join(d, 'libmpv.so.2'))) {
          copyFileSync(join(resourcesBinDir, base), join(d, 'libmpv.so.2'))
        }
        if (!existsSync(join(d, 'libmpv.so'))) {
          copyFileSync(join(resourcesBinDir, base), join(d, 'libmpv.so'))
        }
      }
      ensureLinuxDepsStaged()
      console.log(`[fetch-libmpv] Linux libmpv and dependencies successfully staged.`)
      process.exit(0)
    }
  }
} else if (targetPlatform === 'darwin') {
  const macSearchPaths = [
    '/opt/homebrew/lib',
    '/usr/local/lib',
    '/opt/local/lib',
    join(process.env['HOME'] || '', '.brew/lib'),
  ]

  let primaryLibPath = null
  for (const dir of macSearchPaths) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.includes('libmpv') && entry.endsWith('.dylib')) {
          const fullPath = join(dir, entry)
          copyResolvedFile(fullPath, join(resourcesBinDir, entry))
          copyResolvedFile(fullPath, join(binDir, entry))
          if (!primaryLibPath) primaryLibPath = fullPath
        }
      }
    } catch {
      // Directory unreadable or permission denied
    }
  }

  if (primaryLibPath) {
    const files = readdirSync(resourcesBinDir)
    const base = files.find((f) => f.includes('libmpv') && f.endsWith('.dylib'))
    if (base) {
      for (const d of [resourcesBinDir, binDir]) {
        const targetMain = join(d, 'libmpv.dylib')
        if (!existsSync(targetMain)) {
          copyFileSync(join(resourcesBinDir, base), targetMain)
        }
        if (!existsSync(join(d, 'libmpv.2.dylib'))) {
          copyFileSync(join(resourcesBinDir, base), join(d, 'libmpv.2.dylib'))
        }
      }
      bundleMacDependencies(join(resourcesBinDir, 'libmpv.dylib'), resourcesBinDir)
      syncToBin()
      console.log(`[fetch-libmpv] macOS libmpv and dependencies successfully staged.`)
      process.exit(0)
    }
  }
} else if (targetPlatform === 'win32') {
  const winSearchPaths = [
    'C:\\ProgramData\\chocolatey\\lib\\mpv.install\\tools',
    'C:\\Program Files\\mpv',
    'C:\\tools\\mpv',
  ]
  const pathEnv = process.env['PATH'] || ''
  for (const p of pathEnv.split(';')) {
    if (p.trim() && !winSearchPaths.includes(p)) winSearchPaths.push(p)
  }

  let found = false
  for (const dir of winSearchPaths) {
    if (!existsSync(dir)) continue
    const dll1 = join(dir, 'mpv-2.dll')
    const dll2 = join(dir, 'libmpv-2.dll')
    const srcDll = existsSync(dll1) ? dll1 : existsSync(dll2) ? dll2 : null
    if (srcDll) {
      for (const d of [resourcesBinDir, binDir]) {
        copyFileSync(srcDll, join(d, 'mpv-2.dll'))
        copyFileSync(srcDll, join(d, 'libmpv-2.dll'))
      }
      found = true
      break
    }
  }

  if (found) {
    console.log(`[fetch-libmpv] Windows libmpv found and staged.`)
    process.exit(0)
  }

  // Attempt download of prebuilt Windows libmpv archive with SHA256 integrity verification
  console.log(`[fetch-libmpv] Searching for prebuilt Windows libmpv release...`)
  let releaseUrl = process.env['LIBMPV_DOWNLOAD_URL'] || ''
  if (!releaseUrl) {
    try {
      const api = spawnSync('curl', ['-sf', 'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest'], { encoding: 'utf-8' })
      const assets = JSON.parse(api.stdout || '[]')
      const asset = (assets.assets || []).find((a) => a.name.startsWith('mpv-dev-lgpl-x86_64-') && a.name.endsWith('.7z') && !a.name.includes('v3'))
      if (asset) releaseUrl = asset.browser_download_url
    } catch {
      // fall through
    }
  }
  if (!releaseUrl) {
    console.error('[fetch-libmpv] ERROR: no libmpv download URL resolved (set LIBMPV_DOWNLOAD_URL).')
    process.exit(1)
  }

  const expectedSha256 = process.env['LIBMPV_EXPECTED_SHA256'] || '47a544c776fb083b4b8f52ef137f8f94d93b160b73c2ea8f1350ee9c55b119cb'
  const tmpArchive = join(resourcesBinDir, 'mpv-dev-x86_64.7z')
  console.log(`[fetch-libmpv] Downloading libmpv from: ${releaseUrl}`)

  let downloadSuccess = false
  try {
    const curl = spawnSync('curl', ['-fSL', '-o', tmpArchive, releaseUrl], { stdio: 'inherit' })
    if (curl.status === 0 && existsSync(tmpArchive)) {
      downloadSuccess = true
    }
  } catch (err) {
    console.warn(`[fetch-libmpv] curl download failed:`, err)
  }

  if (downloadSuccess) {
    const fileBytes = readFileSync(tmpArchive)
    const actualSha256 = createHash('sha256').update(fileBytes).digest('hex')
    console.log(`[fetch-libmpv] Archive SHA256: ${actualSha256}`)

    if (expectedSha256 && expectedSha256 !== 'skip' && actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      console.error(`[fetch-libmpv] ERROR: SHA256 checksum mismatch!`)
      console.error(`  Expected: ${expectedSha256}`)
      console.error(`  Actual:   ${actualSha256}`)
      try { unlinkSync(tmpArchive) } catch { /* ignore */ }
      process.exit(1)
    }

    console.log(`[fetch-libmpv] SHA256 verified successfully. Extracting DLLs from archive...`)
    const extract7z = spawnSync('7z', ['e', tmpArchive, `-o${resourcesBinDir}`, '*.dll', '-y', '-r'], {
      stdio: 'inherit',
    })
    if (extract7z.status === 0) {
      if (existsSync(join(resourcesBinDir, 'libmpv-2.dll')) && !existsSync(join(resourcesBinDir, 'mpv-2.dll'))) {
        copyFileSync(join(resourcesBinDir, 'libmpv-2.dll'), join(resourcesBinDir, 'mpv-2.dll'))
      }
      if (existsSync(join(resourcesBinDir, 'mpv-2.dll')) && !existsSync(join(resourcesBinDir, 'libmpv-2.dll'))) {
        copyFileSync(join(resourcesBinDir, 'mpv-2.dll'), join(resourcesBinDir, 'libmpv-2.dll'))
      }
      try { unlinkSync(tmpArchive) } catch { /* ignore */ }
      syncToBin()
      console.log(`[fetch-libmpv] Extracted Windows libmpv successfully.`)
      process.exit(0)
    }
  }
}

// Missing libmpv handling
const instructions = {
  linux: 'Install libmpv with: sudo apt-get install -y libmpv-dev libmpv2 (or distro equivalent)',
  darwin: 'Install libmpv with: brew install mpv',
  win32: 'Place mpv-2.dll (or libmpv-2.dll) in apps/desktop/resources/bin or set LIBMPV_PATH',
}[targetPlatform] || 'Provide libmpv dynamic library in apps/desktop/resources/bin'

if (isStrict) {
  console.error(`[fetch-libmpv] ERROR: libmpv dynamic library not found for platform '${targetPlatform}'.`)
  console.error(`  ${instructions}`)
  process.exit(1)
} else {
  console.warn(`[fetch-libmpv] WARNING: libmpv dynamic library not found in development environment.`)
  console.warn(`  ${instructions}`)
  console.warn(`  The desktop app will fall back to WebAudio or decodePcm until libmpv is supplied.`)
  process.exit(0)
}
