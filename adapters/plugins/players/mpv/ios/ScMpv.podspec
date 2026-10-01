# libmpv on iPhone, as an Expo module in this package — the other half of
# `android/`.
#
# MPVKit is not on CocoaPods trunk in a usable state (every published version
# points at a tag that no longer exists), and the installed autolinking reads
# podspecs only — it has no Swift Package Manager path. So the engine comes
# from `ios.extraPods` in the app's `app.json`, which is the app's to declare:
# packaging is the app's, as `config-plugins/with-newest-libcxx.js` says for
# Android. This podspec only asks for it by name.
#
# Like `android/`, this talks to libmpv's own C API and never calls
# `mpv_request_log_messages`, so no stream address is ever generated for a log.

Pod::Spec.new do |s|
  s.name             = 'ScMpv'
  s.version          = '1.0.0'
  s.summary          = 'libmpv for Streaming Center, on iPhone.'
  s.description      = 'Streaming Center’s player plugin for mpv’s engine: the iOS half of @sc/player-mpv.'
  s.license          = 'GPL-3.0-or-later'
  s.author           = 'Streaming Center'
  # This package has no remote; it ships inside the Streaming Center workspace
  # and is consumed by path. CocoaPods only checks these when linting for
  # trunk, which never happens here.
  s.homepage         = 'https://example.invalid/streaming-center'
  s.source           = { git: 'https://example.invalid/streaming-center.git' }
  s.platforms        = { :ios => '16.4' }
  s.swift_version    = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MPVKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
