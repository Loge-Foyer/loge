import { useGate } from '@/hooks/use-session';
import { UnlockScreen } from '@/screens/unlock';

/** The default profile has a PIN: asked for at launch. */
export default function Locked() {
  const gate = useGate();
  if (gate.kind !== 'needs-user-unlock') return null;
  return <UnlockScreen userId={gate.userId} mode="boot" />;
}
