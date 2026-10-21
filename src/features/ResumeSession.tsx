import { useRef, useState } from 'react';
import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import type { Session } from '../data/types';
import { messageError } from '../happy/errors';

export function ResumeSession({ session }: { session: Session }) {
  const { live, connection, offline, machine } = useDemo(store => ({ live: store.live,
    connection: store.snapshot?.connection, offline: store.snapshot?.offline,
    machine: store.machines.find(machine => machine.id === session.machineId),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  if (!live || session.agent === 'Happy Agent' || session.status !== 'offline') return null;
  const reason = live.resumeUnavailable(session.id);
  return <div aria-label="Session recovery" style={{ margin: '8px 0', overflowWrap: 'anywhere' }}>
    <Button style={{ minHeight: 44, minWidth: 44 }} disabled={busy || !!reason || offline || connection !== 'connected' || !machine?.online}
      onClick={async () => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try { await live.resumeSession(session.id); }
        catch (error) { setError(messageError(error)); }
        finally { pending.current = false; setBusy(false); }
      }}>{busy ? 'Resuming…' : 'Resume session'}</Button>
    {reason && <p>{reason}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
