#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readdirSync, lstatSync, readlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const resourcesBinDir = join(desktopRoot, 'resources', 'bin')

if (!existsSync(resourcesBinDir)) {
  mkdirSync(resourcesBinDir, { recursive: true })
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

function hasLibmpvInResources() {
  if (targetPlatform === 'win32') {
    return existsSync(join(resourcesBinDir, 'mpv-2.dll')) || existsSync(join(resourcesBinDir, 'libmpv-2.dll'))
  }
  if (targetPlatform === 'darwin') {
    return existsSync(join(resourcesBinDir, 'libmpv.dylib')) || existsSync(join(resourcesBinDir, 'libmpv.2.dylib'))
  }
  if (targetPlatform === 'linux') {
    return existsSync(join(resourcesBinDir, 'libmpv.so.2')) || existsSync(join(resourcesBinDir, 'libmpv.so'))
  }
  return false
}

if (hasLibmpvInResources()) {
  console.log(`[fetch-libmpv] libmpv already present in ${resourcesBinDir}. Nothing to do.`)
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
      }
    }
  } else {
    const filename = customPath.split(/[/\\]/).pop()
    copyFileSync(customPath, join(resourcesBinDir, filename))
  }
  if (hasLibmpvInResources()) {
    console.log(`[fetch-libmpv] Staged custom libmpv successfully.`)
    process.exit(0)
  }
}

// 2. Search host system libraries
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

if (targetPlatform === 'linux') {
  const linuxSearchPaths = [
    '/usr/lib/x86_64-linux-gnu',
    '/usr/lib64',
    '/usr/lib',
    '/usr/local/lib',
    '/lib/x86_64-linux-gnu',
    '/lib64',
  ]

  let found = false
  for (const dir of linuxSearchPaths) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.startsWith('libmpv.so')) {
          const fullPath = join(dir, entry)
          copyResolvedFile(fullPath, join(resourcesBinDir, entry))
          found = true
        }
      }
    } catch {
      // Directory unreadable or permission denied
    }
  }

  // Ensure libmpv.so.2 and libmpv.so symlink/copy exist if any libmpv.so was found
  if (found) {
    const files = readdirSync(resourcesBinDir)
    const base = files.find((f) => f.startsWith('libmpv.so'))
    if (base) {
      if (!existsSync(join(resourcesBinDir, 'libmpv.so.2'))) {
        copyFileSync(join(resourcesBinDir, base), join(resourcesBinDir, 'libmpv.so.2'))
      }
      if (!existsSync(join(resourcesBinDir, 'libmpv.so'))) {
        copyFileSync(join(resourcesBinDir, base), join(resourcesBinDir, 'libmpv.so'))
      }
      console.log(`[fetch-libmpv] Linux libmpv successfully staged.`)
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

  let found = false
  for (const dir of macSearchPaths) {
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.includes('libmpv') && entry.endsWith('.dylib')) {
          const fullPath = join(dir, entry)
          copyResolvedFile(fullPath, join(resourcesBinDir, entry))
          found = true
        }
      }
    } catch {
      // Directory unreadable or permission denied
    }
  }

  if (found) {
    const files = readdirSync(resourcesBinDir)
    const base = files.find((f) => f.includes('libmpv') && f.endsWith('.dylib'))
    if (base) {
      if (!existsSync(join(resourcesBinDir, 'libmpv.dylib'))) {
        copyFileSync(join(resourcesBinDir, base), join(resourcesBinDir, 'libmpv.dylib'))
      }
      if (!existsSync(join(resourcesBinDir, 'libmpv.2.dylib'))) {
        copyFileSync(join(resourcesBinDir, base), join(resourcesBinDir, 'libmpv.2.dylib'))
      }
      console.log(`[fetch-libmpv] macOS libmpv successfully staged.`)
      process.exit(0)
    }
  }
} else if (targetPlatform === 'win32') {
  // Check common Windows installations
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
    if (existsSync(dll1)) {
      copyFileSync(dll1, join(resourcesBinDir, 'mpv-2.dll'))
      copyFileSync(dll1, join(resourcesBinDir, 'libmpv-2.dll'))
      found = true
      break
    } else if (existsSync(dll2)) {
      copyFileSync(dll2, join(resourcesBinDir, 'mpv-2.dll'))
      copyFileSync(dll2, join(resourcesBinDir, 'libmpv-2.dll'))
      found = true
      break
    }
  }

  if (found) {
    console.log(`[fetch-libmpv] Windows libmpv found and staged.`)
    process.exit(0)
  }

  // 3. If running on Windows or CI, attempt download of prebuilt Windows libmpv archive
  console.log(`[fetch-libmpv] Searching for prebuilt Windows libmpv release...`)
  const releaseUrl =
    process.env['LIBMPV_DOWNLOAD_URL'] ||
    'https://github.com/zhongfly/mpv-winbuild/releases/download/2024-10-27-0130fec/mpv-dev-x86_64-20241027-git-0130fec.7z'

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
    console.log(`[fetch-libmpv] Extracting DLLs from archive...`)
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
      console.log(`[fetch-libmpv] Extracted Windows libmpv successfully.`)
      process.exit(0)
    }
  }
}

// 4. Missing libmpv handling
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
