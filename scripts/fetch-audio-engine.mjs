#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, copyFileSync, readdirSync, rmSync, chmodSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const versionConfigPath = join(rootDir, 'audio-engine.version.json')

// 1. Read default repo and version from audio-engine.version.json
let repo = 'BBeBeeX/B_Be_Bee-audio-engine'
let version = 'v1.0.0'

if (existsSync(versionConfigPath)) {
  try {
    const raw = readFileSync(versionConfigPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed.repo) repo = parsed.repo
    if (parsed.version) version = parsed.version
  } catch (err) {
    console.warn(`[fetch-audio-engine] Warning: failed to parse ${versionConfigPath}:`, err)
  }
}

if (process.env.AUDIO_ENGINE_REPO) repo = process.env.AUDIO_ENGINE_REPO
if (process.env.AUDIO_ENGINE_VERSION) version = process.env.AUDIO_ENGINE_VERSION

// 2. Parse CLI arguments
const args = process.argv.slice(2)
let targetDirArg = null
let appArg = null
let variantArg = null // 'full', 'slim', or null (both)
let isMobile = false
let isForce = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--target' || arg === '--bin-dir') {
    targetDirArg = args[++i]
  } else if (arg.startsWith('--target=')) {
    targetDirArg = arg.split('=')[1]
  } else if (arg.startsWith('--bin-dir=')) {
    targetDirArg = arg.split('=')[1]
  } else if (arg === '--app') {
    appArg = args[++i]
  } else if (arg.startsWith('--app=')) {
    appArg = arg.split('=')[1]
  } else if (arg === '--full-only') {
    variantArg = 'full'
  } else if (arg === '--slim-only') {
    variantArg = 'slim'
  } else if (arg === '--mobile') {
    isMobile = true
  } else if (arg === '--force') {
    isForce = true
  }
}

if (!variantArg && process.env.AUDIO_ENGINE_VARIANT) {
  const envVar = process.env.AUDIO_ENGINE_VARIANT.toLowerCase()
  if (envVar === 'full' || envVar === 'full-only') variantArg = 'full'
  if (envVar === 'slim' || envVar === 'slim-only') variantArg = 'slim'
}

// 3. Local fallback & cache paths
const localDistDir = process.env.AUDIO_ENGINE_LOCAL_DIST ||
  (existsSync('/home/revers/project/B_Be_Bee-audio-engine/dist') ? '/home/revers/project/B_Be_Bee-audio-engine/dist' : null)

const cacheDir = join(rootDir, '.cache', 'audio-engine', version)
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true })
}

function computeSha256(filePath) {
  const buf = readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex').toLowerCase()
}

function loadChecksums() {
  const sumsPath = join(cacheDir, 'SHA256SUMS')

  if (localDistDir && existsSync(join(localDistDir, 'SHA256SUMS'))) {
    copyFileSync(join(localDistDir, 'SHA256SUMS'), sumsPath)
  }

  if (!existsSync(sumsPath) || isForce) {
    const url = `https://github.com/${repo}/releases/download/${version}/SHA256SUMS`
    console.log(`[fetch-audio-engine] Fetching checksums: ${url}`)
    const dl = spawnSync('curl', ['-fSL', '-o', sumsPath, url], { stdio: 'inherit' })
    if (dl.status !== 0 && !existsSync(sumsPath)) {
      console.warn(`[fetch-audio-engine] Warning: Could not download SHA256SUMS from GitHub.`)
    }
  }

  const checksums = new Map()
  if (existsSync(sumsPath)) {
    const lines = readFileSync(sumsPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
      if (match) {
        checksums.set(match[2].trim(), match[1].toLowerCase())
      }
    }
  }
  return checksums
}

function fetchAsset(filename, checksums) {
  const cachedFile = join(cacheDir, filename)
  const expectedHash = checksums.get(filename)

  if (!isForce && existsSync(cachedFile)) {
    if (!expectedHash || computeSha256(cachedFile) === expectedHash) {
      console.log(`[fetch-audio-engine] Using cached asset: ${filename}`)
      return cachedFile
    }
    console.log(`[fetch-audio-engine] Cached asset ${filename} hash mismatch. Re-fetching...`)
  }

  // 1. Try local fallback first
  if (localDistDir && existsSync(join(localDistDir, filename))) {
    console.log(`[fetch-audio-engine] Found local fallback asset in ${localDistDir}: ${filename}`)
    copyFileSync(join(localDistDir, filename), cachedFile)
    if (expectedHash) {
      const actualHash = computeSha256(cachedFile)
      if (actualHash !== expectedHash) {
        throw new Error(`[fetch-audio-engine] Checksum mismatch for local ${filename}! Expected: ${expectedHash}, Got: ${actualHash}`)
      }
    }
    return cachedFile
  }

  // 2. Download from GitHub Releases
  const downloadUrl = `https://github.com/${repo}/releases/download/${version}/${filename}`
  console.log(`[fetch-audio-engine] Downloading ${downloadUrl} -> ${cachedFile}`)
  const curlResult = spawnSync('curl', ['-fSL', '-o', cachedFile, downloadUrl], { stdio: 'inherit' })
  if (curlResult.status !== 0 || !existsSync(cachedFile)) {
    throw new Error(`[fetch-audio-engine] Failed to download ${filename} from ${downloadUrl}`)
  }

  if (expectedHash) {
    const actualHash = computeSha256(cachedFile)
    if (actualHash !== expectedHash) {
      throw new Error(`[fetch-audio-engine] Checksum mismatch for ${filename}! Expected: ${expectedHash}, Got: ${actualHash}`)
    }
    console.log(`[fetch-audio-engine] SHA256 verified for ${filename}: ${actualHash}`)
  }
  return cachedFile
}

function extractArchive(archivePath, targetDir) {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    const res = spawnSync('tar', ['-xzf', archivePath, '-C', targetDir], { stdio: 'inherit' })
    if (res.status !== 0) throw new Error(`[fetch-audio-engine] tar extraction failed for ${archivePath}`)
  } else if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const psRes = spawnSync('powershell', ['-Command', `Expand-Archive -Force -LiteralPath "${archivePath}" -DestinationPath "${targetDir}"`], { stdio: 'inherit' })
      if (psRes.status !== 0) {
        const tarRes = spawnSync('tar', ['-xf', archivePath, '-C', targetDir], { stdio: 'inherit' })
        if (tarRes.status !== 0) throw new Error(`[fetch-audio-engine] zip extraction failed for ${archivePath}`)
      }
    } else {
      const res = spawnSync('unzip', ['-o', '-q', archivePath, '-d', targetDir], { stdio: 'inherit' })
      if (res.status !== 0) throw new Error(`[fetch-audio-engine] unzip extraction failed for ${archivePath}`)
    }
  }
}

function copyExtractedFiles(srcDir, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const entries = readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyExtractedFiles(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
      if (process.platform !== 'win32' && (entry.name.startsWith('audio-engine') || entry.name.endsWith('.so') || entry.name.includes('.so.') || entry.name.endsWith('.dylib'))) {
        try { chmodSync(destPath, 0o755) } catch { /* ignore */ }
      }
    }
  }
}

async function main() {
  console.log(`=== BBeBee Audio Engine Fetcher ===`)
  console.log(`Repo: ${repo}, Version: ${version}`)

  const checksums = loadChecksums()

  // Determine what to fetch
  const targetApps = []
  if (targetDirArg) {
    targetApps.push({ type: 'custom', dir: resolve(process.cwd(), targetDirArg) })
  } else if (isMobile || appArg === 'mobile') {
    targetApps.push({ type: 'mobile' })
  } else if (appArg === 'desktop') {
    targetApps.push({ type: 'desktop', name: 'desktop' })
  } else if (appArg === 'all') {
    targetApps.push({ type: 'desktop', name: 'desktop' })
    targetApps.push({ type: 'mobile' })
  } else {
    // Default: desktop app
    targetApps.push({ type: 'desktop', name: 'desktop' })
  }

  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const platformName = isWin ? 'windows' : isMac ? 'macos' : 'linux'
  const archName = process.arch === 'arm64' ? 'arm64' : 'x64'
  const archiveExt = isWin ? '.zip' : '.tar.gz'
  const exeName = isWin ? 'audio-engine.exe' : 'audio-engine'
  const slimExeName = isWin ? 'audio-engine-slim.exe' : 'audio-engine-slim'

  for (const target of targetApps) {
    if (target.type === 'desktop' || target.type === 'custom') {
      const binDir = target.type === 'custom' ? target.dir : join(rootDir, 'apps', target.name, 'bin')
      const resourcesBinDir = target.type === 'custom' ? null : join(rootDir, 'apps', target.name, 'resources', 'bin')
      const platformResourceDir = target.type === 'desktop' ? join(rootDir, 'resources', platformName) : null

      if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true })
      if (resourcesBinDir && !existsSync(resourcesBinDir)) mkdirSync(resourcesBinDir, { recursive: true })
      if (platformResourceDir && !existsSync(platformResourceDir)) mkdirSync(platformResourceDir, { recursive: true })

      console.log(`[fetch-audio-engine] Staging desktop audio-engine -> ${binDir} & resources/${platformName}`)

      // 1. Full Package
      if (variantArg !== 'slim') {
        const fullArchiveName = `audio-engine-${platformName}-${archName}${archiveExt}`
        console.log(`[fetch-audio-engine] Fetching full package: ${fullArchiveName}`)
        const fullArchive = fetchAsset(fullArchiveName, checksums)
        const tmpFull = join(cacheDir, `tmp_full_${Date.now()}`)
        try {
          extractArchive(fullArchive, tmpFull)
          copyExtractedFiles(tmpFull, binDir)
          if (resourcesBinDir) copyExtractedFiles(tmpFull, resourcesBinDir)
          if (platformResourceDir) copyExtractedFiles(tmpFull, platformResourceDir)
        } finally {
          try { rmSync(tmpFull, { recursive: true, force: true }) } catch { /* ignore */ }
        }
      }

      // 2. Slim Package
      if (variantArg !== 'full') {
        if (isMac) {
          // On macOS, slim package was removed because full and slim are byte-for-byte identical.
          // Copy audio-engine to audio-engine-slim to satisfy the bin/ contract.
          const mainExe = join(binDir, exeName)
          if (existsSync(mainExe)) {
            copyFileSync(mainExe, join(binDir, slimExeName))
            if (resourcesBinDir) copyFileSync(mainExe, join(resourcesBinDir, slimExeName))
            if (platformResourceDir) copyFileSync(mainExe, join(platformResourceDir, slimExeName))
            try { chmodSync(join(binDir, slimExeName), 0o755) } catch { /* ignore */ }
            if (resourcesBinDir) { try { chmodSync(join(resourcesBinDir, slimExeName), 0o755) } catch { /* ignore */ } }
            if (platformResourceDir) { try { chmodSync(join(platformResourceDir, slimExeName), 0o755) } catch { /* ignore */ } }
            console.log(`[fetch-audio-engine] Staged macOS audio-engine-slim from main executable.`)
          }
        } else {
          const slimArchiveName = `audio-engine-${platformName}-${archName}-slim${archiveExt}`
          console.log(`[fetch-audio-engine] Fetching slim package: ${slimArchiveName}`)
          const slimArchive = fetchAsset(slimArchiveName, checksums)
          const tmpSlim = join(cacheDir, `tmp_slim_${Date.now()}`)
          try {
            extractArchive(slimArchive, tmpSlim)
            const slimExeSrc = join(tmpSlim, exeName)
            if (existsSync(slimExeSrc)) {
              copyFileSync(slimExeSrc, join(binDir, slimExeName))
              if (resourcesBinDir) copyFileSync(slimExeSrc, join(resourcesBinDir, slimExeName))
              if (platformResourceDir) copyFileSync(slimExeSrc, join(platformResourceDir, slimExeName))
              if (!isWin) {
                try { chmodSync(join(binDir, slimExeName), 0o755) } catch { /* ignore */ }
                if (resourcesBinDir) { try { chmodSync(join(resourcesBinDir, slimExeName), 0o755) } catch { /* ignore */ } }
                if (platformResourceDir) { try { chmodSync(join(platformResourceDir, slimExeName), 0o755) } catch { /* ignore */ } }
              }
            }
            if (variantArg === 'slim') {
              // If slim only, ensure main audio-engine executable exists and copy libraries
              if (existsSync(slimExeSrc) && !existsSync(join(binDir, exeName))) {
                copyFileSync(slimExeSrc, join(binDir, exeName))
                if (resourcesBinDir) copyFileSync(slimExeSrc, join(resourcesBinDir, exeName))
                if (platformResourceDir) copyFileSync(slimExeSrc, join(platformResourceDir, exeName))
              }
              copyExtractedFiles(tmpSlim, binDir)
              if (resourcesBinDir) copyExtractedFiles(tmpSlim, resourcesBinDir)
              if (platformResourceDir) copyExtractedFiles(tmpSlim, platformResourceDir)
            }
          } finally {
            try { rmSync(tmpSlim, { recursive: true, force: true }) } catch { /* ignore */ }
          }
        }
      }

      // Ensure executable permissions
      if (!isWin) {
        if (existsSync(join(binDir, exeName))) chmodSync(join(binDir, exeName), 0o755)
        if (existsSync(join(binDir, slimExeName))) chmodSync(join(binDir, slimExeName), 0o755)
        if (resourcesBinDir) {
          if (existsSync(join(resourcesBinDir, exeName))) chmodSync(join(resourcesBinDir, exeName), 0o755)
          if (existsSync(join(resourcesBinDir, slimExeName))) chmodSync(join(resourcesBinDir, slimExeName), 0o755)
        }
        if (platformResourceDir) {
          if (existsSync(join(platformResourceDir, exeName))) chmodSync(join(platformResourceDir, exeName), 0o755)
          if (existsSync(join(platformResourceDir, slimExeName))) chmodSync(join(platformResourceDir, slimExeName), 0o755)
        }
      }
      console.log(`[fetch-audio-engine] Desktop assets staged successfully.`)
    } else if (target.type === 'mobile') {
      // Mobile assets stage into the repo-root resources/ area — the same place
      // the Expo config plugin (apps/mobile/plugins/with-audio-engine.js) and
      // the desktop packager consume prebuilt audio-engine binaries from.
      const mobileBase = join(rootDir, 'resources')
      console.log(`[fetch-audio-engine] Staging mobile assets -> ${mobileBase}`)

      // Android arm64-v8a
      try {
        const androidArm64Archive = fetchAsset('audio-engine-android-arm64-v8a.zip', checksums)
        const androidArm64Dest = join(mobileBase, 'android-arm64-v8a')
        const tmpAndroidArm64 = join(cacheDir, `tmp_android_arm64_${Date.now()}`)
        try {
          extractArchive(androidArm64Archive, tmpAndroidArm64)
          copyExtractedFiles(tmpAndroidArm64, androidArm64Dest)
        } finally {
          try { rmSync(tmpAndroidArm64, { recursive: true, force: true }) } catch { /* ignore */ }
        }
        console.log(`[fetch-audio-engine] Staged Android arm64-v8a assets.`)
      } catch (err) {
        console.warn(`[fetch-audio-engine] Warning: Could not stage Android arm64-v8a:`, err.message)
      }

      // Android x86_64
      try {
        const androidX86Archive = fetchAsset('audio-engine-android-x86_64.zip', checksums)
        const androidX86Dest = join(mobileBase, 'android-x86_64')
        const tmpAndroidX86 = join(cacheDir, `tmp_android_x86_${Date.now()}`)
        try {
          extractArchive(androidX86Archive, tmpAndroidX86)
          copyExtractedFiles(tmpAndroidX86, androidX86Dest)
        } finally {
          try { rmSync(tmpAndroidX86, { recursive: true, force: true }) } catch { /* ignore */ }
        }
        console.log(`[fetch-audio-engine] Staged Android x86_64 assets.`)
      } catch (err) {
        console.warn(`[fetch-audio-engine] Warning: Could not stage Android x86_64:`, err.message)
      }

      // iOS
      try {
        const iosArchive = fetchAsset('audio-engine-ios.xcframework.zip', checksums)
        const iosDest = join(mobileBase, 'ios')
        const tmpIos = join(cacheDir, `tmp_ios_${Date.now()}`)
        try {
          extractArchive(iosArchive, tmpIos)
          copyExtractedFiles(tmpIos, iosDest)
        } finally {
          try { rmSync(tmpIos, { recursive: true, force: true }) } catch { /* ignore */ }
        }
        console.log(`[fetch-audio-engine] Staged iOS xcframework assets.`)
      } catch (err) {
        console.warn(`[fetch-audio-engine] Warning: Could not stage iOS xcframework:`, err.message)
      }
    }
  }

  console.log(`=== Audio engine staging completed successfully ===`)
}

main().catch((err) => {
  console.error(`[fetch-audio-engine] ERROR:`, err)
  process.exit(1)
})
