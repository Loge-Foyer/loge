import { AppTabs } from '@/components/app-tabs';
import { ActiveUserContext, useGate } from '@/hooks/use-session';

/**
 * Keyed by the active profile: switching profiles remounts every tab stack, so
 * no screen of the previous profile survives the switch.
 */
export default function TabsLayout() {
  const gate = useGate();
  if (gate.kind !== 'ready') return null;
  return (
    <ActiveUserContext key={gate.userId} value={gate.userId}>
      <AppTabs />
    </ActiveUserContext>
  );
}
