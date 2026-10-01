import { Search } from '@tamagui/lucide-icons-2/icons/Search';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { useEffect, useState } from 'react';
import { XStack } from 'tamagui';

import { Button } from '@/components/button';
import { TextInput } from '@/components/text-input';

/** Long enough that a key does not start a search, short enough not to feel slow. */
const SETTLE_MS = 300;

/**
 * A search box over whatever list it is put above — never across lists. It
 * reports a term only once typing settles, so a source is asked once for a
 * word rather than once for each letter of it.
 *
 * What is typed is its own, so that typing stays immediate while the list
 * behind it lags a moment. To clear it from outside — moving to another
 * section — give it a `key` for the scope it searches: it is a new box for a
 * new list, not the old one told to forget.
 */
export function SearchField({
  placeholder,
  term,
  onTerm,
}: {
  placeholder: string;
  term: string;
  onTerm: (term: string) => void;
}) {
  const [typed, setTyped] = useState(term);

  useEffect(() => {
    if (typed === term) return;
    const timer = setTimeout(() => onTerm(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed, term, onTerm]);

  return (
    <XStack items="center" gap="$2">
      <XStack flex={1} items="center" position="relative">
        <XStack position="absolute" l="$3" z={1} pointerEvents="none">
          <Search size={16} opacity={0.6} />
        </XStack>
        <TextInput
          flex={1}
          pl="$7"
          value={typed}
          onChangeText={setTyped}
          placeholder={placeholder}
          aria-label={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          // Answer the moment it is asked for, rather than waiting out the settle.
          onSubmitEditing={() => onTerm(typed)}
          clearButtonMode="never"
        />
      </XStack>
      {typed.length > 0 ? (
        <Button
          size="$3"
          chromeless
          circular
          icon={X}
          aria-label="Clear search"
          onPress={() => {
            setTyped('');
            onTerm('');
          }}
        />
      ) : null}
    </XStack>
  );
}
