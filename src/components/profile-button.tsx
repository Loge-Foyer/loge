import { Link } from 'expo-router';
import { Button } from 'tamagui';

import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';

import { ProfileAvatar } from './profile-avatar';

/** The active profile; tapping it opens the profile switcher. */
export function ProfileButton() {
  const userId = useActiveUserId();
  const user = useProfiles().data?.find((profile) => profile.id === userId);
  if (!user) return null;
  return (
    <Link href="/who-is-watching" asChild>
      <Button unstyled circular aria-label={`${user.name} — switch profile`}>
        <ProfileAvatar user={user} size={32} />
      </Button>
    </Link>
  );
}
