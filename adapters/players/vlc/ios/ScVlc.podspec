# libVLC on iPhone, as an Expo module in this package — the other half of
# `android/`. MobileVLCKit is LGPL 2.1 and ships as a vendored xcframework
# that CocoaPods downloads from videolan.org at install time, so nothing
# large enters this repository.
#
# Pinned to the 3.7 line, which is the same libVLC generation as Android's
# `org.videolan.android:libvlc-all:3.7.6`: one engine, one set of formats,
# one `profiles.ts`. VLCKit 4 is an alpha with an incompatible track API.

Pod::Spec.new do |s|
  s.name             = 'ScVlc'
  s.version          = '1.0.0'
  s.summary          = 'libVLC for Streaming Center, on iPhone.'
  s.description      = 'Streaming Center’s player plugin for VLC’s engine: the iOS half of @sc/player-vlc.'
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
  s.dependency 'MobileVLCKit', '3.7.4'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
