# libVLC on iPhone and Apple TV, as an Expo module in this package — the
# other half of `android/`. VideoLAN publishes VLCKit 3 as one pod per
# platform, MobileVLCKit and TVVLCKit, built from the same source with the
# same API; each is LGPL 2.1 and ships as a vendored xcframework that
# CocoaPods downloads from videolan.org at install time, so nothing large
# enters this repository.
#
# Pinned to the 3.7 line, which is the same libVLC generation as Android's
# `org.videolan.android:libvlc-all:3.7.7`: one engine, one set of formats,
# one `profiles.ts`. VLCKit 4 — one pod for both, and a layer the system
# could take for picture in picture — is still an alpha, with an
# incompatible track API.

Pod::Spec.new do |s|
  s.name             = 'LogeVlc'
  s.version          = '1.0.0'
  s.summary          = 'libVLC for Loge, on iPhone and Apple TV.'
  s.description      = 'Loge’s player plugin for VLC’s engine: the iOS half of @loge/player-vlc.'
  s.license          = 'GPL-3.0-or-later'
  s.author           = 'Loge'
  # This package has no remote; it ships inside the Loge repository
  # and is consumed by path. CocoaPods only checks these when linting for
  # trunk, which never happens here.
  s.homepage         = 'https://example.invalid/loge'
  s.source           = { git: 'https://example.invalid/loge.git' }
  s.platforms        = { :ios => '16.4', :tvos => '16.4' }
  s.swift_version    = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.ios.dependency 'MobileVLCKit', '3.7.4'
  s.tvos.dependency 'TVVLCKit', '3.7.4'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
