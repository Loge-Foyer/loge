import { SlidersHorizontal } from '@tamagui/lucide-icons-2/icons/SlidersHorizontal';
import { Link, type Href } from 'expo-router';

import { Button } from '@/components/button';

/** Opens the sheet that edits the home's rows — or one row's, from its full list. */
export function CustomizeButton({ href = '/customize-home', label = 'Customize the home screen' }: { href?: Href; label?: string }) {
  return (
    <Link href={href} asChild>
      <Button size="$3" circular chromeless icon={<SlidersHorizontal size={20} color="$color11" />} aria-label={label} />
    </Link>
  );
}
