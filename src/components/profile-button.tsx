import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { Link } from 'expo-router';

import { Button } from '@/components/button';
import { px } from '@/components/density';
import { useProfiles } from '@/hooks/use-profiles';
import { useActiveUserId } from '@/hooks/use-session';

import { ProfileAvatar } from './profile-avatar';
import { isTV } from './remote';

/** The active profile's square; pressing it opens who's watching. A TV marks it as a choice with a chevron. */
export function ProfileButton() {
  const userId = useActiveUserId();
  const user = useProfiles().data?.find((profile) => profile.id === userId);
  if (!user) return null;
  return (
    <Link href="/who-is-watching" asChild>
      <Button unstyled rounded="$3" flexDirection="row" items="center" gap="$1.5" aria-label={`${user.name} — switch profile`}>
        <ProfileAvatar user={user} size={isTV ? px(36) : 30} shape="square" />
        {isTV ? <ChevronDown size={px(18)} color="$color11" /> : null}
      </Button>
    </Link>
  );
}
