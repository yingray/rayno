import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Spinner } from '../components/ui';
import { useDemo } from '../data/store';
import type { Session } from '../data/types';
import type { Json } from './normalize';
import { messageError } from './errors';
import { unbase64 } from './encoding';
import styles from './workspace-files.module.css';

export function WorkspaceFiles({ session }: { session: Session }) {
  const { live, connection, offline } = useDemo((store) => ({
    live: store.live, connection: store.snapshot?.connection, offline: store.snapshot?.offline,
  }));
  const connected = connection === 'connected' && !offline;
  const navigate = useNavigate();
  const [folder, setFolder] = useState(session.path);
  const [entries, setEntries] = useState<Json[]>([]);
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!live || !connected) {
      setBusy(false);
      setError('');
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError('');
    setContent('');
    setSelected('');
    (async () => {
      const result = await live.rpc(session.id, 'listDirectory', { path: folder });
      if (!result.success || !Array.isArray(result.entries))
        throw new Error(result.error || 'The agent cannot list this folder.');
      if (!cancelled) setEntries(result.entries);
    })()
      .catch((error) => {
        if (!cancelled) setError(messageError(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [live, connected, session.id, session.path, folder, revision]);
  async function open(entry: Json) {
    if (!live || busy || !connected) return;
    const path = folder.replace(/\/$/, '') + '/' + entry.name;
    if (entry.type === 'directory') {
      setFolder(path);
      return;
    }
    setBusy(true);
    setError('');
    setSelected(entry.name);
    try {
      if (entry.size > 1024 * 1024) throw new Error('This preview supports files up to 1 MB.');
      const result = await live.rpc(session.id, 'readFile', { path });
      if (!result.success || typeof result.content !== 'string')
        throw new Error(result.error || 'The agent cannot read this file.');
      const bytes = unbase64(result.content);
      if (bytes.length > 1024 * 1024 || bytes.includes(0))
        throw new Error('This file is too large or contains binary data.');
      setContent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      setError(messageError(error));
      setContent('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.screen} aria-label="Real workspace files">
      <header>
        <strong>Workspace files</strong>
        <Button
          icon="refreshOutline"
          disabled={busy || !connected}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </Button>
      </header>
      <p className={styles.path}>{folder || 'No workspace path'} · read only</p>
      {!connected && <p role="status">{offline ? 'Connect to browse workspace files.' : 'Connect to Happy…'}</p>}
      {busy && (
        <div className={styles.status}>
          <Spinner /> Read from the agent…
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.layout}>
          <nav aria-label="Workspace files">
            {folder !== session.path && (
              <button onClick={() => setFolder(folder.slice(0, folder.lastIndexOf('/')) || '/')}>
                ↑ Parent folder
              </button>
            )}
            {entries.map((entry) => (
              <button key={entry.name} disabled={busy || !connected} onClick={() => void open(entry)}>
                {entry.type === 'directory' ? '▸ ' : ''}
                {entry.name}
              </button>
            ))}
            {!entries.length && !busy && !error && connected && (
              <Empty title="Empty folder">This folder has no entries.</Empty>
            )}
          </nav>
        <div className={styles.content}>
          <small>{selected || 'Select a file to preview'}</small>
          <pre>{content}</pre>
        </div>
      </div>
      <Button icon="arrowBack" onClick={() => navigate(`/session/${session.id}`)}>
        Back to chat
      </Button>
    </section>
  );
}
