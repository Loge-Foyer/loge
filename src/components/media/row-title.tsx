import { SizableText } from 'tamagui';

import { px } from '@/components/density';

/**
 * A row's title as Media writes it: in capitals, small and grey, so the
 * pictures carry the row and the words only say what it is.
 */
export function RowTitle({ children }: { children: string }) {
  return (
    <SizableText size="$2" fontWeight="700" letterSpacing={px(1)} textTransform="uppercase" color="$color10" numberOfLines={1}>
      {children}
    </SizableText>
  );
}
