import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, copyText, Dialog, Icon } from '../components/ui';
import type { IconName } from '../components/ui';
import { useDemo } from '../data/store';
import { titleOf } from '../data/reducer';
import { buildHandoffDraft } from '../happy/handoff';
import type { Session } from '../data/types';
import styles from './session-info.module.css';
import { ResumeSession } from './ResumeSession';
import { needsSessionResume } from '../happy/resume';
import { archiveAction, leaveRoute } from '../data/sideChats';

export function SessionInfo({
  session,
  onClose,
  embedded = false,
}: {
  session: Session;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { adapter, notify, machines, mode, newDraft, metadata, dispatch, live, parentKnown } = useDemo((store) => ({
    parentKnown: !!session.parentSessionId && store.state.sessions.some((item) => item.id === session.parentSessionId),
    adapter: store.adapter, notify: store.notify, machines: store.machines, mode: store.mode,
    metadata: store.snapshot?.sessionData[session.id]?.metadata,
    newDraft: store.state.newDraft, dispatch: store.dispatch, live: store.live,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => void | Promise<void>, done?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      done?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(session.customTitle || '');
  const [confirm, setConfirm] = useState<'delete' | 'stop' | null>(null);
  const machine = machines.find((item) => item.id === session.machineId);
  const needsResume = mode === 'live' && needsSessionResume(session);
  const archiveLabel = archiveAction(session, needsResume);
  const leave = leaveRoute(session, parentKnown);
  const handoff = buildHandoffDraft({
    sessionId: session.id,
    machineId: session.machineId,
    path: session.path,
    flavor: metadata?.flavor || (session.agent === 'Happy Agent' ? 'rig' : session.agent.toLowerCase()),
    homeDir: metadata?.homeDir || machine?.homeDir,
    claudeSessionId: metadata?.claudeSessionId,
    codexThreadId: metadata?.codexThreadId,
  }, newDraft);
  const facts = [
    { label: 'Path', value: session.path },
    { label: 'Machine', value: machine?.name || 'Unknown' },
    { label: 'Branch', value: session.branch },
    {
      label: 'Started',
      value: new Date(session.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    },
  ];
  function archive() {
    void run(
      () => adapter.archiveSession(session.id),
      () => navigate(archiveLabel === 'Restore session' ? '/sessions' : leave),
    );
  }
  const actions: {
    icon: IconName;
    label: string;
    detail?: string;
    color?: string;
    run: () => void;
    mobile?: boolean;
  }[] = [
    { icon: 'pencilOutline', label: 'Rename', run: () => setRenaming(true), mobile: true },
    {
      icon: 'gitCompareOutline',
      label: 'View changes',
      detail:
        mode === 'live' && !session.gitReported
          ? 'Not read'
          : `+${session.additions} −${session.deletions}`,
      run: () => navigate(`/session/${session.id}/changes`),
    },
    {
      icon: 'desktopOutline',
      label: 'View machine',
      detail: machine?.name,
      run: () => navigate(`/machine/${session.machineId}`),
    },
    {
      icon: 'copyOutline',
      label: 'Copy metadata & logs',
      run: () =>
        void copyText(JSON.stringify({ ...session, demo: mode === 'demo' }, null, 2), notify),
    },
    {
      icon: 'swapHorizontalOutline',
      label: 'Hand Off',
      detail: 'Continue in a new session',
      run: () => {
        if (!handoff) return;
        dispatch({ type: 'newDraft', value: handoff });
        navigate('/new');
      },
    },
    {
      icon: 'stopCircleOutline',
      label: 'Kill session',
      run: () => setConfirm('stop'),
    },
    // An ended CLI session must resume before it can leave the archive.
    ...(!archiveLabel
      ? []
      : [{
          icon: 'archiveOutline' as const,
          label: archiveLabel,
          run: archive,
          mobile: true,
        }]),
    {
      icon: 'trashOutline',
      label: 'Delete session',
      color: '#fca5a5',
      run: () => setConfirm('delete'),
      mobile: true,
    },
  ];
  return (
    <section className={styles.info} aria-label="Session details">
      {!embedded && (
        <header className={styles.header}>
          <Button
            className={styles.back}
            icon="arrowBack"
            aria-label="Back to chat"
            onClick={onClose}
          />
          <h1>Session info</h1>
          <Button
            className={styles.close}
            icon="close"
            aria-label="Close session info"
            onClick={onClose}
          />
        </header>
      )}
      <div className={styles.body}>
        {error && !confirm && (
          <p role="alert" style={{ color: '#fca5a5' }}>
            {error}
          </p>
        )}
        <div className={styles.identity}>
          <div className={styles.identityTop}>
            <Avatar agent={session.agent} size={44} />
            <div>
              <strong>{titleOf(session)}</strong>
              <span style={{ color: machine?.online ? 'var(--green)' : 'var(--muted)' }}>
                <i />
                {machine?.online ? 'Online' : 'Offline'} · {session.agent}
              </span>
            </div>
          </div>
          {renaming ? (
            <form
              className={styles.renameForm}
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => adapter.renameSession(session.id, name),
                  () => setRenaming(false),
                );
              }}
            >
              <label htmlFor="session-name">Custom title</label>
              <input
                id="session-name"
                data-escape-local
                aria-label="Session name"
                value={name}
                autoFocus
                placeholder="Use the agent title"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setRenaming(false);
                  }
                }}
              />
              <p>Leave empty to use the agent title.</p>
              <div>
                <Button onClick={() => setRenaming(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={busy}>
                  Save name
                </Button>
              </div>
            </form>
          ) : (
            <button
              className={styles.rename}
              onClick={() => {
                setName(session.customTitle || '');
                setRenaming(true);
              }}
            >
              <Icon name="pencilOutline" size={16} />
              <span>
                Rename
                <small>
                  {session.customTitle
                    ? 'Clear the name to use the agent title'
                    : 'Set a custom title'}
                </small>
              </span>
              <Icon name="chevronForwardOutline" size={13} />
            </button>
          )}
        </div>
        <div className={styles.facts}>
          {facts.map((fact) => (
            <button
              key={fact.label}
              onClick={() => copyText(fact.value, notify)}
              title={`Copy ${fact.label.toLowerCase()}: ${fact.value}`}
            >
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
              <Icon name="copyOutline" size={11} />
            </button>
          ))}
        </div>
        <span className={styles.sectionLabel}>SESSION ACTIONS</span>
        {needsResume && <ResumeSession session={session} />}
        <div className={styles.actions}>
          {actions.filter((action) => action.label !== 'Hand Off' || handoff).map((action) => (
            <button
              className={action.mobile ? styles.mobileOnly : ''}
              key={action.label}
              disabled={busy}
              onClick={action.run}
              style={{ color: action.color }}
            >
              <Icon name={action.icon} size={17} />
              <span>{action.label}</span>
              {action.detail && <small>{action.detail}</small>}
              <Icon name="chevronForwardOutline" size={12} />
            </button>
          ))}
        </div>
        <p className={styles.localNote}>
          <Icon name="shieldCheckmarkOutline" size={12} />
          {mode === 'demo'
            ? 'Demo session · stored on this device'
            : 'Happy session · changes sync across clients'}
        </p>
      </div>
      <footer className={styles.bottom}>
        {archiveLabel && (
          <Button icon="archiveOutline" disabled={busy} onClick={archive}>
            {archiveLabel === 'Close side chat' ? 'Close' : session.archived ? 'Restore' : 'Archive'}
          </Button>
        )}
        <Button
          variant="danger"
          icon="trashOutline"
          disabled={busy}
          onClick={() => setConfirm('delete')}
        >
          Delete
        </Button>
      </footer>
      {confirm && (
        <Dialog
          title={confirm === 'delete' ? 'Delete this session?' : 'Stop this session?'}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === 'delete'
              ? mode === 'demo'
                ? 'This removes the session and its messages from this browser. This action cannot be undone.'
                : 'This permanently deletes the session and messages from Happy on every client. This action cannot be undone.'
              : mode === 'demo'
                ? 'This stops the simulated agent response. Your conversation stays available.'
                : 'This terminates the real agent session. Your conversation stays available.'}
          </p>
          {error && (
            <p role="alert" style={{ color: '#fca5a5' }}>
              {error}
            </p>
          )}
          <footer>
            <Button disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm === 'delete' ? 'danger' : 'accent'}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    confirm === 'delete'
                      ? adapter.deleteSession(session.id)
                      : adapter.killSession
                        ? adapter.killSession(session.id)
                        : adapter.stopSession(session.id),
                  () => {
                    if (confirm === 'delete') navigate(leave);
                    setConfirm(null);
                  },
                )
              }
            >
              {confirm === 'delete' ? 'Delete session' : 'Stop session'}
            </Button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
