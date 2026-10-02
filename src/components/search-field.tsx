import { ChevronDown } from '@tamagui/lucide-icons-2/icons/ChevronDown';
import { Search } from '@tamagui/lucide-icons-2/icons/Search';
import { X } from '@tamagui/lucide-icons-2/icons/X';
import { useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';
import { XStack } from 'tamagui';

import { Button } from '@/components/button';
import { Menu, MenuRow } from '@/components/more-menu';
import { TextInput } from '@/components/text-input';

/** Long enough to finish a word with a TV remote, short enough not to feel slow. */
const PAUSE_MS = 2_000;

/** What a search may be narrowed to, chosen at the box's left: "All", "Video", "Channel"… */
export interface SearchScopeChoice<S extends string> {
  readonly value: S;
  readonly options: readonly S[];
  readonly label: (option: S) => string;
  readonly onChange: (option: S) => void;
}

/**
 * A search box over whatever list it is put above — never across lists. It
 * searches once typing pauses, or at once on the keyboard's search key; with
 * `searchOn="submit"`, on that key alone, for a source where every search is a
 * request someone waits on. Emptying the box brings the list back at once: an
 * empty box is no search to wait for.
 *
 * What is typed is its own, so that typing stays immediate while the list
 * behind it lags a moment. To clear it from outside — moving to another
 * section — give it a `key` for the scope it searches: it is a new box for a
 * new list, not the old one told to forget.
 *
 * Where the source can narrow a search, `scope` puts the choice at the box's
 * left; choosing searches again at once for whatever is typed.
 */
export function SearchField<S extends string>({
  placeholder,
  term,
  onTerm,
  searchOn = 'pause',
  scope,
}: {
  placeholder: string;
  term: string;
  onTerm: (term: string) => void;
  searchOn?: 'pause' | 'submit';
  scope?: SearchScopeChoice<S>;
}) {
  const [typed, setTyped] = useState(term);

  useEffect(() => {
    if (typed === term) return;
    if (typed.trim() === '') {
      onTerm('');
      return;
    }
    if (searchOn === 'submit') return;
    const timer = setTimeout(() => onTerm(typed), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed, term, onTerm, searchOn]);

  return (
    <XStack items="center" gap="$2">
      {scope ? (
        <ScopePill
          scope={scope}
          onChoose={(option) => {
            scope.onChange(option);
            // A new scope is a new question about what is typed: ask it now.
            if (typed.trim() !== '' && typed !== term) onTerm(typed);
          }}
        />
      ) : null}
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
          // Answer the moment it is asked for, rather than waiting out the pause.
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

function ScopePill<S extends string>({ scope, onChoose }: { scope: SearchScopeChoice<S>; onChoose: (option: S) => void }) {
  const anchor = useRef<View>(null);
  const [at, setAt] = useState<{ x: number; y: number }>();
  const open = () => {
    // A native view measures itself; Tamagui's button in a browser is an element, which only has its box.
    const node = anchor.current as unknown as {
      measureInWindow?: (done: (x: number, y: number, width: number, height: number) => void) => void;
      getBoundingClientRect?: () => { left: number; bottom: number };
    } | null;
    if (node?.measureInWindow) node.measureInWindow((x, y, _width, height) => setAt({ x, y: y + height + 6 }));
    else if (node?.getBoundingClientRect) {
      const box = node.getBoundingClientRect();
      setAt({ x: box.left, y: box.bottom + 6 });
    } else setAt({ x: 0, y: 0 });
  };
  const close = () => setAt(undefined);
  return (
    <>
      <Button
        ref={anchor}
        size="$3"
        iconAfter={<ChevronDown size={14} />}
        aria-label={`Search: ${scope.label(scope.value)}`}
        onPress={open}
      >
        {scope.label(scope.value)}
      </Button>
      <Menu open={at !== undefined} label="What to search" onClose={close} {...(at ? { at } : {})}>
        {scope.options.map((option, index) => (
          <MenuRow
            key={option}
            label={scope.label(option)}
            selected={option === scope.value}
            preferred={index === 0}
            onPress={() => {
              close();
              if (option !== scope.value) onChoose(option);
            }}
          />
        ))}
      </Menu>
    </>
  );
}
