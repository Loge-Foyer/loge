import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from 'tamagui';

/** The platform tab bar on iOS and Android; `app-tabs.web.tsx` is the browser's. */
export function AppTabs() {
  const theme = useTheme();
  // The bar is drawn natively, so it gets resolved colours rather than tokens.
  const accent = String(theme.accentBackground.val);
  const muted = String(theme.color10.val);
  // iOS draws its own dark material; Android's Material bar would otherwise
  // follow the system's light theme under a dark app.
  const android =
    process.env.EXPO_OS === 'android'
      ? {
          backgroundColor: String(theme.color2.val),
          indicatorColor: String(theme.accent4.val),
          rippleColor: String(theme.color4.val),
        }
      : {};

  return (
    <NativeTabs
      tintColor={accent}
      iconColor={{ default: muted, selected: accent }}
      labelStyle={{ default: { color: muted }, selected: { color: accent } }}
      {...android}
    >
      <NativeTabs.Trigger name="media">
        <NativeTabs.Trigger.Icon sf={{ default: 'film.stack', selected: 'film.stack.fill' }} md="movie" />
        <NativeTabs.Trigger.Label>Media</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="videos">
        <NativeTabs.Trigger.Icon sf={{ default: 'play.tv', selected: 'play.tv.fill' }} md="smart_display" />
        <NativeTabs.Trigger.Label>Videos</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
