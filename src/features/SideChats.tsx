import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Empty, Icon } from '../components/ui';
import { useMinuteNow } from '../components/useMinuteNow';
import { useDemo } from '../data/store';
import { formatSessionTimestamp } from '../data/sessionList';
import { activeSideChat, isSideChatClosed, SIDE_CHAT_TITLE, sideChatLabel, sideChatsOf } from '../data/sideChats';
import type { MessageSettings, Session } from '../data/types';
import { messageError } from '../happy/errors';
import { Chat } from './Chat';
import styles from './side-chats.module.css';

const noop = () => {};
// An ended side chat (no CLI connection) stays open until the user closes it, like Happy Web.
const statusOf = (chat: Session) => isSideChatClosed(chat) ? 'Closed' : chat.archived ? 'Ended' : chat.status === 'running' ? 'Working'
  : chat.status === 'blocked' ? 'Needs you' : chat.unread ? 'New reply' : 'Ready';

/**
 * The side chats of one parent (Happy Web SideChatPanel.tsx). The wide panel shows the open ones as
 * switchable chats next to the parent; the drawer and the phone page list them and open each one full size.
 */
export function SideChats({ parent, layout, settings, onClose }: {
  parent: Session;
  layout: 'panel' | 'drawer' | 'page';
  /** The parent's composer choices, so that a new side chat starts with a concrete model. */
  settings: () => MessageSettings;
  onClose: () => void;
}) {
  const { sessions, live, adapter, mode, dispatch, notify, connection, offline, machineOnline } = useDemo((store) => ({
    sessions: store.state.sessions, live: store.live, adapter: store.adapter, mode: store.mode, dispatch: store.dispatch,
    notify: store.notify, connection: store.snapshot?.connection, offline: store.snapshot?.offline,
    machineOnline: store.machines.find((machine) => machine.id === parent.machineId)?.online,
  }));
  const navigate = useNavigate();
  const location = useLocation();
  const now = useMinuteNow();
  const chats = useMemo(() => sideChatsOf(sessions, parent.id), [sessions, parent.id]);
  const open = useMemo(() => chats.filter((chat) => !isSideChatClosed(chat)), [chats]);
  const closed = useMemo(() => chats.filter(isSideChatClosed), [chats]);
  const labels = useMemo(() => new Map([...open.map((chat, index) => [chat.id, sideChatLabel(chat, index)] as const),
    ...closed.map((chat, index) => [chat.id, sideChatLabel(chat, index, 'Closed side chat')] as const)]), [open, closed]);
  const [requested, setRequested] = useState<string | null>(() => (location.state as { sideChat?: string } | null)?.sideChat ?? null);
  const active = layout === 'panel' ? activeSideChat(open, requested) : undefined;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const disconnected = mode === 'live' && (connection !== 'connected' || !!offline);
  let unavailable = disconnected ? offline ? 'Reconnect to start a side chat.' : 'Connect to Happy to start a side chat.' : '';
  if (!unavailable && live) {
    try { unavailable = live.branchUnavailable(parent.id, 'side'); } catch (error) { unavailable = messageError(error); }
  } else if (!unavailable && parent.agent === 'Happy Agent') unavailable = 'This agent cannot start side chats.';
  else if (!unavailable && machineOnline === false) unavailable = 'Bring the original computer online first.';
  useEffect(() => {
    if (!active) return;
    if (live) return live.watchSession(active.id);
    if (active.unread) dispatch({ type: 'read', id: active.id });
  }, [live, active?.id, active?.unread, dispatch]);

  async function run(key: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(key); setError('');
    try { await action(); }
    catch (error) { setError(messageError(error)); }
    finally { pending.current = false; setBusy(''); }
  }
  const create = () => run('create', async () => {
    if (unavailable) throw new Error(unavailable);
    let id: string;
    if (live) id = await live.branchSession(parent.id, 'side', undefined, settings());
    else {
      id = crypto.randomUUID();
      const at = Date.now();
      dispatch({ type: 'create', session: { ...parent, id, title: SIDE_CHAT_TITLE, customTitle: undefined, isSideChat: true,
        parentSessionId: parent.id, sideChatClosed: false, status: 'idle', archived: false, unread: false, needsReply: false,
        createdAt: at, updatedAt: at, lastActivityAt: at, messages: [] } });
    }
    if (live && live.getMetadata(id).isSideChat !== true) {
      // A Happy CLI without side chat support ignores isSideChat and starts a regular fork.
      notify('This Happy CLI started a regular fork. Update Happy CLI to keep side chats out of the session list.');
      navigate(`/session/${id}`);
      return;
    }
    if (layout === 'panel') setRequested(id);
    else navigate(`/session/${id}`);
  });
  const closeChat = (chat: Session) => run(chat.id, async () => {
    const index = open.findIndex((item) => item.id === chat.id);
    await adapter.archiveSession(chat.id);
    if (chat.id === active?.id) setRequested((open[index - 1] || open[index + 1])?.id ?? null);
  });
  const openFull = (chat: Session) => navigate(`/session/${chat.id}`);

  const newButton = layout === 'panel'
    ? <Button className={styles.iconButton} icon="add" aria-label="New side chat" title={unavailable || 'New side chat'}
      disabled={!!busy || !!unavailable} onClick={() => void create()} />
    : <Button className={styles.newButton} variant="accent" icon="add" disabled={!!busy || !!unavailable} onClick={() => void create()}>
      {busy === 'create' ? 'Starting…' : 'New side chat'}
    </Button>;
  const notice = <>
    {busy === 'create' && <p className={styles.status} role="status">Start a side chat on the original computer…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {unavailable && <p className={styles.reason}>{unavailable}</p>}
  </>;
  const row = (chat: Session) => {
    const label = labels.get(chat.id) || SIDE_CHAT_TITLE;
    const chatClosed = isSideChatClosed(chat);
    return <li key={chat.id} className={styles.row} data-closed={chatClosed || undefined}>
      <button className={styles.rowMain} onClick={() => openFull(chat)} aria-label={`Open ${label}`}>
        <Icon name="chatbubblesOutline" size={16} />
        <span>
          <strong>{label}</strong>
          <small>{statusOf(chat)} · {formatSessionTimestamp(chat.createdAt, now)}</small>
        </span>
        <Icon name="chevronForwardOutline" size={13} />
      </button>
      {!chatClosed && <Button className={styles.iconButton} variant="ghost" icon="close" aria-label={`Close ${label}`}
        disabled={!!busy || disconnected} onClick={() => void closeChat(chat)} />}
    </li>;
  };
  const closedList = closed.length > 0 && <details className={styles.closed}>
    <summary>Closed side chats ({closed.length})</summary>
    <ul className={styles.rows}>{closed.map(row)}</ul>
  </details>;
  const intro = 'Ask a side question with this conversation as context. Side chats stay out of the session list, and the parent chat does not change.';

  if (layout !== 'panel') return (
    <section className={styles.list} data-layout={layout} aria-label="Side chats">
      {layout === 'page' && <header className={styles.pageHeader}>
        <Button className={styles.iconButton} icon="arrowBack" aria-label="Back to chat" onClick={onClose} />
        <h1>Side chats</h1>
      </header>}
      <div className={styles.listBody}>
        <p className={styles.intro}>{intro}</p>
        {newButton}
        {notice}
        {open.length ? <ul className={styles.rows} aria-label="Open side chats">{open.map(row)}</ul>
          : <p className={styles.none}>No open side chats.</p>}
        {closedList}
      </div>
    </section>
  );
  return (
    <section className={styles.panel} aria-label="Side chats">
      <header className={styles.panelHeader}>
        <Icon name="chatbubblesOutline" size={17} />
        <h2>Side chats</h2>
        {newButton}
        <Button className={styles.iconButton} icon="close" aria-label="Close side chats" onClick={onClose} />
      </header>
      {open.length > 0 && <div className={styles.tabs} role="group" aria-label="Open side chats">
        {open.map((chat) => {
          const label = labels.get(chat.id) || SIDE_CHAT_TITLE;
          return <span key={chat.id} className={styles.tab} data-active={chat.id === active?.id || undefined}>
            <button aria-pressed={chat.id === active?.id} onClick={() => setRequested(chat.id)}>
              {chat.unread && <i className={styles.unread} aria-label="New reply" role="img" />}{label}
            </button>
            <button className={styles.tabClose} aria-label={`Close ${label}`} disabled={!!busy || disconnected}
              onClick={() => void closeChat(chat)}><Icon name="close" size={13} /></button>
          </span>;
        })}
      </div>}
      {(error || busy === 'create' || unavailable) && <div className={styles.panelNotice}>{notice}</div>}
      {active ? <div className={styles.conversation}>
        <div className={styles.toolbar}>
          <span>{statusOf(active)}</span>
          <Button className={styles.iconButton} variant="ghost" icon="expandOutline" aria-label="Open side chat in full view"
            title="Open in full view" onClick={() => openFull(active)} />
        </div>
        <div className={styles.chat}><Chat key={active.id} session={active} embedded onInfo={noop} onList={noop} /></div>
      </div> : <div className={styles.empty}>
        <Empty icon="chatbubblesOutline" title="Ask on the side"
          action={<Button variant="accent" icon="add" disabled={!!busy || !!unavailable} onClick={() => void create()}>
            {busy === 'create' ? 'Starting…' : 'Start a side chat'}</Button>}>{intro}</Empty>
        {closedList}
      </div>}
      {active && closedList && <div className={styles.panelClosed}>{closedList}</div>}
    </section>
  );
}
