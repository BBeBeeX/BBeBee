const { withAndroidManifest } = require('expo/config-plugins')

/**
 * Expo Config Plugin to ensure android.permission.MANAGE_EXTERNAL_STORAGE
 * with tools:ignore="ScopedStorage" is declared in AndroidManifest.xml.
 *
 * This allows all-files POSIX path access on Android 11+ (API 30+) to bypass
 * FUSE MIME type filtering for non-standard audio extensions like .m4s.
 */
function withManageStorage(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest
    if (!manifest) return modConfig

    if (!manifest.$) manifest.$ = {}
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = []
    }

    const permissionName = 'android.permission.MANAGE_EXTERNAL_STORAGE'
    const existing = manifest['uses-permission'].find(
      (p) => p.$?.['android:name'] === permissionName,
    )

    if (existing) {
      if (!existing.$) existing.$ = {}
      existing.$['tools:ignore'] = 'ScopedStorage'
    } else {
      manifest['uses-permission'].push({
        $: {
          'android:name': permissionName,
          'tools:ignore': 'ScopedStorage',
        },
      })
    }

    return modConfig
  })
}

module.exports = withManageStorage
