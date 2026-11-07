require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'http-proxy'
  s.version        = package['version']
  s.summary        = 'BBeBee mobile http-proxy — a proxy-capable fetch through the Expo Modules API'
  s.description    = 'The iOS half of the `BbebeeHttpProxy` Expo module: NSURLSession with a ' \
                     'connectionProxyDictionary, redirects cancelled at the delegate (the JS ' \
                     'redirect loop owns hops), proxy auth answered with the stored credentials.'
  s.license        = package['license'] || 'Unlicense'
  s.author         = package['author'] || 'BBeBee Team'
  s.homepage       = 'https://github.com/BBeBeeX/B_Be_Bee'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/BBeBeeX/B_Be_Bee.git' }

  s.static_framework = true

  s.dependency 'expo-modules-core'

  # This podspec lives in ios/ (where expo-modules-autolinking scans local
  # modules for podspecs), so the source globs are relative to it.
  s.source_files        = '*.{swift,h,m}'
  s.public_header_files = '*.h'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
