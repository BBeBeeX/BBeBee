const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Expo Config Plugin bundling the prebuilt audio-engine native libraries from
 * the repo-root `resources/` staging area (the same directory the desktop
 * packager consumes) into mobile builds:
 *
 * - Android: `resources/android-<abi>/*.so` -> `android/app/src/main/jniLibs/<abi>/`
 * - iOS: `resources/ios/mpv.framework` (dynamic) -> link + embed into the app
 *   bundle; `resources/ios/BBeBeeAudioBridge.xcframework` (static) -> link only.
 *
 * The legacy `apps/mobile/third-party/audio-engine/` layout is kept as a
 * fallback so staged assets from older checkouts keep bundling until the fetch
 * script is re-run.
 */

// modRequest.projectRoot is apps/mobile; the resources staging area is repo-root.
function repoRoot(projectRoot) {
  return path.resolve(projectRoot, '..', '..')
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function listAndroidAbiSources(projectRoot) {
  const sources = []
  const resourcesDir = path.join(repoRoot(projectRoot), 'resources')

  if (isDirectory(resourcesDir)) {
    for (const entry of fs.readdirSync(resourcesDir)) {
      if (!entry.startsWith('android-')) continue
      const abiDir = path.join(resourcesDir, entry)
      if (!isDirectory(abiDir)) continue
      sources.push({ abi: entry.slice('android-'.length), dir: abiDir })
    }
  }
  if (sources.length > 0) return sources

  // Legacy staging layout from fetch-audio-engine.
  const legacyDir = path.join(projectRoot, 'third-party', 'audio-engine', 'android')
  if (isDirectory(legacyDir)) {
    for (const abi of fs.readdirSync(legacyDir)) {
      const abiDir = path.join(legacyDir, abi)
      if (!isDirectory(abiDir)) continue
      sources.push({ abi, dir: abiDir })
    }
  }
  return sources
}

function strictMode() {
  // `BBEE_AUDIO_ENGINE_STRICT=1` turns "engine missing" from a warning into
  // a failed prebuild. The staging dirs are gitignored binaries, so a clean
  // checkout on the build machine silently produced APKs whose only audio
  // path was the JS simulation — release builds should refuse to do that.
  return process.env['BBEE_AUDIO_ENGINE_STRICT'] === '1'
}

function noEngineError(where) {
  return (
    `[with-audio-engine] No audio-engine libraries found under ${where}. ` +
    'The native engine will NOT be bundled and mobile audio degrades to the ' +
    'in-process simulation. Run `pnpm fetch:audio-engine --app mobile` on this ' +
    'machine, or unset BBEE_AUDIO_ENGINE_STRICT for a UI-only build.'
  )
}

function withAndroidAudioEngine(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const { projectRoot, platformProjectRoot } = modConfig.modRequest
      const abiSources = listAndroidAbiSources(projectRoot)

      if (abiSources.length === 0) {
        if (strictMode()) throw new Error(noEngineError('resources/android-<abi>/'))
        console.warn(noEngineError('resources/android-<abi>/'))
        return modConfig
      }

      for (const { abi, dir } of abiSources) {
        const soFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.so'))
        if (soFiles.length === 0) continue

        const jniDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'jniLibs', abi)
        fs.mkdirSync(jniDir, { recursive: true })

        for (const soFile of soFiles) {
          const src = path.join(dir, soFile)
          const dest = path.join(jniDir, soFile)
          // libmpv.so is ~90 MB per ABI; skip the copy when already staged.
          if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) continue
          fs.copyFileSync(src, dest)
        }
        console.log(`[with-audio-engine] Bundled Android ${abi} libraries: ${soFiles.join(', ')}`)
      }

      return modConfig
    },
  ])
}

function resolveIosResourceDir(projectRoot) {
  const candidates = [
    path.join(repoRoot(projectRoot), 'resources', 'ios'),
    path.join(projectRoot, 'third-party', 'audio-engine', 'ios'),
  ]
  return candidates.find((dir) => isDirectory(dir)) ?? null
}

function scrubUndefinedProps(project, sectionName, matches) {
  const section = project.hash.project.objects[sectionName] ?? {}
  for (const [key, entry] of Object.entries(section)) {
    if (key.endsWith('_comment')) continue
    if (!matches(entry)) continue
    for (const [prop, value] of Object.entries(entry)) {
      if (value === undefined) delete entry[prop]
    }
  }
}

/**
 * node-xcode serializes `undefined` placeholders into generated entries
 * (`fileEncoding = undefined;`, `path = undefined;` on a fresh Frameworks
 * group). Xcode parses those as the string "undefined" — a bogus
 * `explicitFileType` would even override `lastKnownFileType` — so scrub the
 * entries we generated.
 */
function scrubGeneratedEntries(project, iosDir) {
  scrubUndefinedProps(project, 'PBXFileReference', (entry) =>
    typeof entry?.path === 'string' ? entry.path.includes(iosDir) : false,
  )
  scrubUndefinedProps(project, 'PBXGroup', (entry) =>
    entry?.isa === 'PBXGroup' && (entry.name === 'Frameworks' || entry.name === 'Embed Frameworks'),
  )
}

/**
 * node-xcode pushes search paths that carry embedded quotes, and for absolute
 * library paths it emits a mangled `$(SRCROOT)/<name>//<abs>` entry. Rewrite
 * the entries belonging to iosDir to clean absolute paths.
 */
function normalizeSearchPaths(project, prop, iosDir, expectedDir) {
  const section = project.hash.project.objects.XCBuildConfiguration ?? {}
  for (const [key, config] of Object.entries(section)) {
    if (key.endsWith('_comment')) continue
    const settings = config.buildSettings
    if (!settings || typeof settings !== 'object') continue

    const raw = settings[prop]
    const stripQuotes = (p) => (typeof p === 'string' ? p.replace(/^"+|"+$/g, '') : p)
    let paths = Array.isArray(raw) ? raw.map(stripQuotes) : ['$(inherited)']
    // Drop node-xcode's mangled duplicates and any previous run's entry.
    paths = paths.filter((p) => typeof p !== 'string' || !p.includes(iosDir))
    paths.push(expectedDir)
    settings[prop] = paths
  }
}

function withIosAudioEngine(config) {
  return withXcodeProject(config, async (modConfig) => {
    const project = modConfig.modResults
    const { projectRoot, projectName } = modConfig.modRequest
    const iosDir = resolveIosResourceDir(projectRoot)

    if (!iosDir) {
      if (strictMode()) throw new Error(noEngineError('resources/ios/'))
      console.warn(noEngineError('resources/ios/'))
      return modConfig
    }

    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName })

    // Dynamic frameworks must be embedded into the app bundle (and re-signed
    // on copy for device builds), not just linked — otherwise dyld fails at
    // launch. The embed phase is missing on fresh templates, so create it.
    if (!project.pbxEmbedFrameworksBuildPhaseObj(target.uuid)) {
      project.addBuildPhase([], 'PBXCopyFilesBuildPhase', 'Embed Frameworks', target.uuid, 'frameworks')
    }

    let embeddedFramework = null
    for (const fw of ['mpv.framework', 'mpv.xcframework']) {
      const fwPath = path.join(iosDir, fw)
      if (!fs.existsSync(fwPath)) continue
      project.addFramework(fwPath, {
        target: target.uuid,
        customFramework: true,
        embed: true,
        sign: true,
      })
      embeddedFramework = fw
      console.log(`[with-audio-engine] Linked and embedded ${fw}`)
    }

    // Static library archive: link only — embedding or signing a .a is invalid.
    const bridgePath = path.join(iosDir, 'BBeBeeAudioBridge.xcframework')
    if (fs.existsSync(bridgePath)) {
      project.addStaticLibrary(bridgePath, {
        target: target.uuid,
        lastKnownFileType: 'wrapper.xcframework',
      })
      console.log('[with-audio-engine] Linked BBeBeeAudioBridge.xcframework')
    }

    scrubGeneratedEntries(project, iosDir)
    normalizeSearchPaths(project, 'FRAMEWORK_SEARCH_PATHS', iosDir, iosDir)
    normalizeSearchPaths(project, 'LIBRARY_SEARCH_PATHS', iosDir, bridgePath)

    return modConfig
  })
}

function withAudioEngine(config) {
  return withIosAudioEngine(withAndroidAudioEngine(config))
}

module.exports = withAudioEngine
