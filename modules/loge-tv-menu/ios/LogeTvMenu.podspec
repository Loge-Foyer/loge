Pod::Spec.new do |s|
  s.name           = 'LogeTvMenu'
  s.version        = '0.0.0'
  s.summary        = "The Apple TV remote's Menu button, kept for the app while a pushed screen needs it."
  s.description    = s.summary
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'Loge'
  s.homepage       = 'https://github.com/Loge-Foyer/loge'
  # Built for the iPhone too, where it does nothing: one module list for both.
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
