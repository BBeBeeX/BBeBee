require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The prebuilt engine binaries are gitignored and staged by
# `pnpm fetch:audio-engine --app mobile` into the repo-root `resources/` area
# (see resources/README.md); `apps/mobile/third-party/audio-engine/` is the
# legacy fallback layout the config plugin also honors. When neither exists,
# the pod still compiles — `BbebeeMpvCore.mm` gates the mpv C API behind
# `__has_include(<mpv/client.h>)` and runs in stub mode, which `engineStatus`
# reports honestly (`running:false, mpvAvailable:false`) so the JS layer
# degrades to the in-process simulation instead of failing the build.
# `BBEE_AUDIO_ENGINE_STRICT=1` turns the missing engine into a failed prebuild
# in the config plugin; prefer that for release builds.
mpv_search_dir = nil
[
  File.expand_path('../../../../../resources/ios', __dir__),
  File.expand_path('../../../third-party/audio-engine/ios', __dir__),
].each do |candidate|
  if File.directory?(File.join(candidate, 'mpv.framework', 'Headers'))
    mpv_search_dir = candidate
    break
  end
end

Pod::Spec.new do |s|
  s.name           = 'audio-engine'
  s.version        = package['version']
  s.summary        = 'BBeBee mobile audio engine — in-process libmpv via the Expo Modules API'
  s.description    = 'The iOS half of the `BbebeeAudioEngine` Expo module: libmpv playback ' \
                     'contract, PCM-tap FFT visualizer, and the codec seam, mirroring the ' \
                     'Android module one method at a time.'
  s.license        = package['license'] || 'Unlicense'
  s.author         = package['author'] || 'BBeBee Team'
  s.homepage       = 'https://github.com/BBeBeeX/B_Be_Bee'
  s.platforms      = { :ios => '15.1' } # floor of the bundled mpv.framework (15.0)
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/BBeBeeX/B_Be_Bee.git' }

  s.static_framework = true

  s.dependency 'expo-modules-core'

  # This podspec lives in ios/ (where expo-modules-autolinking scans local
  # modules for podspecs), so the source globs are relative to it.
  s.source_files        = '*.{swift,h,mm}'
  s.public_header_files = '*.h' # BbebeeMpvCore.h joins the umbrella for Swift

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # The engine core is ObjC++ (mpv C API + lock-free ring + FFT loops).
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17'
  }

  if mpv_search_dir.nil?
    Pod::UI.warn '[audio-engine] No mpv.framework found under resources/ios/ or ' \
                 'third-party/audio-engine/ios/ — the native engine will NOT be linked and ' \
                 'mobile audio degrades to the in-process simulation. ' \
                 'Run `pnpm fetch:audio-engine --app mobile` on this machine.'
  else
    s.pod_target_xcconfig['FRAMEWORK_SEARCH_PATHS'] = "\"#{mpv_search_dir}\""
    # Link only — the dynamic framework is embedded and re-signed into the app
    # bundle by the `with-audio-engine` config plugin (embedding from a pod
    # would duplicate it).
    s.pod_target_xcconfig['OTHER_LDFLAGS'] = '$(inherited) -framework mpv'
  end
end
