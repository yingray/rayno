import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import type { MessageSettings, Session } from '../data/types';
import { titleOf } from '../data/reducer';
import { DirectoryApprovalError, messageError } from '../happy/errors';
import { FolderApprovalDialog, useWorktreeCleanup } from './SessionPrompts';
import styles from './chatSessionMenu.module.css';
import chatStyles from './chat.module.css';
import { needsSessionResume } from '../happy/resume';
import { buildHandoffDraft } from '../happy/handoff';
import { draftInWorkspace } from '../data/workspaces';

type Point = { id: string; text: string; timestamp: number };

export function ChatSessionMenu({ session, settings }: { session: Session; settings: MessageSettings }) {
  const { live, adapter, mode, dispatch, connection, offline, machine, metadata, newDraft } = useDemo(store => ({
    live: store.live, adapter: store.adapter, mode: store.mode, dispatch: store.dispatch,
    connection: store.snapshot?.connection, offline: store.snapshot?.offline,
    machine: store.machines.find(machine => machine.id === session.machineId),
    metadata: store.snapshot?.sessionData[session.id]?.metadata, newDraft: store.state.newDraft,
  }));
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [folder, setFolder] = useState<{ directory: string; kind: 'fork' | 'duplicate'; point?: string } | null>(null);
  const branchRequest = useRef<{ kind: 'fork' | 'duplicate'; point?: string }>(undefined);
  const cleanup = useWorktreeCleanup();
  const [position, setPosition] = useState({ top: 0, right: 12, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const id = useId();
  const disconnected = mode === 'live' && (connection !== 'connected' || !!offline);
  const branchReason = live ? live.branchUnavailable(session.id) : '';
  const ended = mode === 'live' && needsSessionResume(session);
  const recoveryReason = ended ? live?.resumeUnavailable(session.id) : '';
  const source = { sessionId: session.id, machineId: session.machineId, path: session.path,
    homeDir: metadata?.homeDir || machine?.homeDir,
    flavor: metadata?.flavor || (session.agent === 'Happy Agent' ? 'rig' : session.agent.toLowerCase()),
    claudeSessionId: metadata?.claudeSessionId, codexThreadId: metadata?.codexThreadId,
  };
  const handoff = buildHandoffDraft(source, newDraft);
  const workspaceDraft = draftInWorkspace(source, session.agent === 'Happy Agent' ? 'Claude' : session.agent);
  function close(focus = true) {
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const button = trigger.current?.getBoundingClientRect();
      if (!button) return;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : innerHeight;
      setPosition({ top: button.bottom + 6, right: Math.max(8, innerWidth - button.right),
        maxHeight: Math.max(44, Math.min(360, bottom - button.bottom - 18)) });
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', keydown, true);
    };
  }, [open]);
  async function run(action: () => Promise<void> | void) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); close(); }
    catch (error) {
      // A missing folder replaces the menu or the duplicate picker with the folder question.
      if (error instanceof DirectoryApprovalError && branchRequest.current) {
        setFolder({ ...branchRequest.current, directory: error.directory }); setDuplicate(false); close(false);
      } else setError(messageError(error));
    }
    finally { pending.current = false; setBusy(false); }
  }
  async function branch(kind: 'fork' | 'duplicate', point?: string, approved = false) {
    let newId: string;
    branchRequest.current = { kind, point };
    if (live) newId = await live.branchSession(session.id, kind, point, settings, approved);
    else {
      newId = crypto.randomUUID();
      const cut = kind === 'duplicate' ? session.messages.findIndex(message => message.id === point) : -1;
      dispatch({ type: 'create', session: { ...session, id: newId, customTitle: `${kind === 'fork' ? 'Fork' : 'Duplicate'} of ${titleOf(session)}`,
        status: 'idle', archived: false, unread: false, needsReply: false, createdAt: Date.now(), updatedAt: Date.now(),
        messages: cut < 0 ? [...session.messages] : session.messages.slice(0, cut + 1),
      } });
    }
    setDuplicate(false); setFolder(null); close(false); navigate(`/session/${newId}`);
  }
  return <>
    <button ref={trigger} type="button" className={`${chatStyles.sessionMenuButton} ${styles.trigger}`}
      aria-label="Session actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setError(''); setOpen(value => !value); }}>
      <Icon name="menuOutline" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="menu" aria-label="Session actions" className={styles.menu} style={position}>
      <p className={styles.title}>{titleOf(session)}</p>
      {ended ? <button role="menuitem" disabled={busy || disconnected || !!recoveryReason}
        onClick={() => void run(() => live!.resumeSession(session.id))}><Icon name="refreshOutline" />Resume session</button>
        : <button role="menuitem" disabled={busy || disconnected} onClick={() => void run(async () => {
          if (session.archived) await adapter.archiveSession(session.id);
          else if (await cleanup.guard(session.id, () => adapter.archiveSession(session.id))) navigate('/sessions');
        })}><Icon name="archiveOutline" />{session.archived ? 'Restore session' : 'Archive session'}</button>}
      {recoveryReason && <p className={styles.reason}>{recoveryReason}</p>}
      <button role="menuitem" disabled={busy || !workspaceDraft} onClick={() => {
        if (!workspaceDraft) return;
        dispatch({ type: 'newDraft', value: workspaceDraft }); close(false); navigate('/new');
      }}><Icon name="add" />New session in same workspace</button>
      <button role="menuitem" disabled={busy || !handoff} onClick={() => {
        if (!handoff) return;
        dispatch({ type: 'newDraft', value: handoff }); close(false); navigate('/new');
      }}><Icon name="swapHorizontalOutline" />Hand Off</button>
      <button role="menuitem" disabled={busy || disconnected || !!branchReason || !machine?.online}
        onClick={() => { close(); setDuplicate(true); }}><Icon name="copyOutline" />Duplicate</button>
      <button role="menuitem" disabled={busy || disconnected || !!branchReason || !machine?.online}
        onClick={() => void run(() => branch('fork'))}><Icon name="gitBranchOutline" />{busy ? 'Wait…' : 'Fork'}</button>
      {branchReason && <p className={styles.reason}>{branchReason}</p>}
      {!metadata?.bot && <button role="menuitem" className={styles.danger} disabled={busy || disconnected}
        onClick={() => { close(); setConfirmDelete(true); }}><Icon name="trashOutline" />Delete session</button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>, document.body)}
    {confirmDelete && !cleanup.prompting && <Dialog title="Delete this session?" onClose={() => { if (!busy) setConfirmDelete(false); }}>
      <p>Delete “{titleOf(session)}” and its conversation?</p>
      {error && <p role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</Button>
        <Button variant="danger" disabled={busy} onClick={() => void run(async () => {
          if (!await cleanup.guard(session.id, () => adapter.deleteSession(session.id))) return;
          setConfirmDelete(false); navigate('/sessions');
        })}>Delete session</Button></footer>
    </Dialog>}
    {cleanup.dialog}
    {folder && <FolderApprovalDialog directory={folder.directory} machineName={machine?.name} busy={busy} error={error}
      onCancel={() => { live?.discardBranch(session.id, folder.kind, folder.point); setFolder(null); setError(''); }} onCreate={() => void run(() => branch(folder.kind, folder.point, true))} />}
    {duplicate && <DuplicateDialog session={session} busy={busy} error={error}
      onClose={() => { if (!busy) setDuplicate(false); }} onDuplicate={point => void run(() => branch('duplicate', point))} />}
  </>;
}

function DuplicateDialog({ session, busy, error, onClose, onDuplicate }: {
  session: Session; busy: boolean; error: string; onClose: () => void; onDuplicate: (point: string) => void;
}) {
  const live = useDemo(store => store.live);
  const [points, setPoints] = useState<Point[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setReadError('');
    const load = live ? live.rewindPoints(session.id) : Promise.resolve(session.messages.filter(message => message.role === 'user')
      .map(message => ({ id: message.id, text: message.content || 'Image attachment', timestamp: message.sentAt || session.createdAt })).reverse());
    load.then(points => { if (active) setPoints(points); }).catch(error => { if (active) setReadError(messageError(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [live, session.id, attempt]);
  return <Dialog title="Duplicate session" onClose={onClose} className={styles.duplicate}>
    <p>Choose a message. The new session keeps the conversation through that message.</p>
    {loading ? <p role="status">Read conversation history…</p> : readError ? <><p role="alert">{readError}</p>
      <Button onClick={() => setAttempt(value => value + 1)}>Retry history</Button></> : points.length ?
      <div role="radiogroup" aria-label="Duplicate through message" className={styles.points}>
        {points.map(point => <button key={point.id} role="radio" aria-checked={point.id === selected} disabled={busy}
          onClick={() => setSelected(point.id)}><span>{point.text}</span><small>{new Date(point.timestamp).toLocaleString()}</small></button>)}
      </div> : <p>No messages are available to duplicate.</p>}
    {error && <p role="alert">{error}</p>}
    <footer><Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="accent" disabled={busy || loading || !selected} onClick={() => onDuplicate(selected)}>
        {busy ? 'Starting…' : 'Duplicate session'}
      </Button></footer>
  </Dialog>;
}
