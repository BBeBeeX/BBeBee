const { withAndroidManifest } = require('expo/config-plugins')

/**
 * Expo Config Plugin to ensure android:usesCleartextTraffic="true" is set on the
 * main application in AndroidManifest.xml. This allows HTTP connections (such as
 * self-hosted Subsonic/Navidrome servers on local IP addresses) to work without
 * being blocked by Android 9+'s default network security policy.
 */
function withCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = modConfig.modResults.manifest.application?.[0]
    if (mainApplication) {
      if (!mainApplication.$) {
        mainApplication.$ = {}
      }
      mainApplication.$['android:usesCleartextTraffic'] = 'true'
    }
    return modConfig
  })
}

module.exports = withCleartextTraffic
