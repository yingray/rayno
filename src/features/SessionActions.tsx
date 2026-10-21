import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog } from '../components/ui';
import { useDemo } from '../data/store';
import { titleOf } from '../data/reducer';
import type { Session } from '../data/types';
import styles from './sessions.module.css';

export function SessionActions({ session, onClose }: { session: Session; onClose: () => void }) {
  const { adapter, mode } = useDemo((store) => ({ adapter: store.adapter, mode: store.mode }));
  const needsResume = mode === 'live' && session.archived && session.agent !== 'Happy Agent' && session.status === 'offline';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }
  const navigate = useNavigate();
  return (
    <Dialog title="Session actions" onClose={onClose}>
      <p>{titleOf(session)}</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button
          variant="ghost"
          icon="informationCircleOutline"
          onClick={() => {
            navigate(`/session/${session.id}/info`);
            onClose();
          }}
        >
          Session info & rename
        </Button>
        {!needsResume && (
          <Button
            variant="ghost"
            icon="archiveOutline"
            disabled={busy}
            onClick={() => void run(() => adapter.archiveSession(session.id))}
          >
            {session.archived ? 'Restore session' : 'Archive session'}
          </Button>
        )}
        {session.status === 'running' && (
          <Button
            variant="ghost"
            icon="stopCircleOutline"
            disabled={busy}
            onClick={() => void run(() => adapter.stopSession(session.id))}
          >
            Stop response
          </Button>
        )}
      </div>
    </Dialog>
  );
}
