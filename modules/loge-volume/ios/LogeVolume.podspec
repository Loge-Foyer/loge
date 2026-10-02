Pod::Spec.new do |s|
  s.name           = 'LogeVolume'
  s.version        = '0.0.0'
  s.summary        = "The device's media volume, for the player's edge slider."
  s.description    = s.summary
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'Loge'
  s.homepage       = 'https://github.com/Loge-Foyer/loge'
  # iPhone only: MPVolumeView does not exist on tvOS, where the television sets
  # its own volume, so autolinking leaves this out of a TV build.
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'MediaPlayer'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
