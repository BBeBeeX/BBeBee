const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Expo Config Plugin to integrate prebuilt audio-engine native libraries into
 * Android (jniLibs) and iOS (Xcode framework linking).
 */

function withAndroidAudioEngine(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot
      const platformRoot = modConfig.modRequest.platformProjectRoot
      const srcBase = path.join(projectRoot, 'third-party', 'audio-engine', 'android')

      if (!fs.existsSync(srcBase)) {
        return modConfig
      }

      const abis = fs.readdirSync(srcBase).filter((f) => {
        try {
          return fs.statSync(path.join(srcBase, f)).isDirectory()
        } catch {
          return false
        }
      })

      for (const abi of abis) {
        const abiSrcDir = path.join(srcBase, abi)
        const jniDestDir = path.join(platformRoot, 'app', 'src', 'main', 'jniLibs', abi)

        if (!fs.existsSync(jniDestDir)) {
          fs.mkdirSync(jniDestDir, { recursive: true })
        }

        const soFiles = fs.readdirSync(abiSrcDir).filter((f) => f.endsWith('.so'))
        for (const soFile of soFiles) {
          const srcFile = path.join(abiSrcDir, soFile)
          const destFile = path.join(jniDestDir, soFile)
          fs.copyFileSync(srcFile, destFile)
        }
      }

      return modConfig
    },
  ])
}

function withIosAudioEngine(config) {
  return withXcodeProject(config, async (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot
    const xcframeworkPath = path.join(projectRoot, 'third-party', 'audio-engine', 'ios', 'BBeBeeAudioBridge.xcframework')

    if (!fs.existsSync(xcframeworkPath)) {
      return modConfig
    }

    try {
      IOSConfig.XcodeUtils.addFramework({
        project: modConfig.modResults,
        projectName: modConfig.modRequest.projectName,
        framework: xcframeworkPath,
      })
    } catch (err) {
      console.warn('[with-audio-engine] Warning: failed to link BBeBeeAudioBridge.xcframework:', err)
    }

    return modConfig
  })
}

function withAudioEngine(config) {
  return withIosAudioEngine(withAndroidAudioEngine(config))
}

module.exports = withAudioEngine
