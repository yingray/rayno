import { memo, useEffect, useId, useRef, useState } from 'react';
import { useDemo, type Store } from '../data/store';
import { SYNC_DONE_TIME, SYNC_SHOW_DELAY, idleSync, syncView, type SyncInput, type SyncView } from '../data/syncStatus';
import { useText } from '../i18n';
import { Icon, Spinner } from './ui';
import styles from './syncStatus.module.css';

type Shown = SyncView | { kind: 'synced' };
type Flat = Omit<SyncInput, 'history'> & {
  historyLoaded: boolean; historyLoading: boolean; historyError: string; historyForward: boolean; hasHistory: boolean;
};

// The selection is flat, so the shallow comparison of the store sees an unchanged state.
function readSync(store: Store, sessionId?: string): Flat {
  const source = store.syncDemo?.input;
  const snapshot = store.snapshot;
  // The demo failure of the messages belongs to the demo conversation only.
  const history = !sessionId ? undefined : source ? sessionId === store.syncDemo!.sessionId ? source.history : undefined
    : snapshot?.histories[sessionId];
  const base: Omit<SyncInput, 'history'> = source || (snapshot ? {
    offline: snapshot.offline, connection: snapshot.connection, syncing: snapshot.syncing, retrying: snapshot.retrying,
    syncedAt: snapshot.syncedAt, cachedAt: snapshot.cachedAt, workspaceError: snapshot.error,
    liveError: snapshot.connectionError, unauthorized: snapshot.unauthorized,
  } : idleSync);
  const forward = !!history && ('forward' in history ? history.forward : history.direction === 'forward');
  return {
    offline: base.offline, connection: base.connection, syncing: base.syncing, retrying: base.retrying,
    syncedAt: base.syncedAt, cachedAt: base.cachedAt, workspaceError: base.workspaceError,
    liveError: base.liveError, unauthorized: base.unauthorized, hasHistory: !!history,
    historyLoaded: !!history?.loaded, historyLoading: !!history?.loading, historyError: history?.error || '', historyForward: forward,
  };
}

const busy = (kind: Shown['kind']) => kind === 'syncing' || kind === 'reconnecting';
const viewKey = (view: SyncView) => view.kind + (view.kind === 'failed' ? ':' + view.scope + ':' + view.detail
  : view.kind === 'offline' ? ':' + view.saved : '');

// One status area for the session list, a conversation, and a side chat. It stays quiet during a normal sync.
// `actions` marks the one area on screen that shows the workspace failure and its Retry button.
// `failuresOnly` is the fallback on screens without a list or a conversation.
export const SyncStatus = memo(function SyncStatus({ label, sessionId, actions = false, failuresOnly = false, className = '' }: {
  label: string; sessionId?: string; actions?: boolean; failuresOnly?: boolean; className?: string;
}) {
  const t = useText();
  const flat = useDemo((store) => readSync(store, sessionId));
  const { live, syncDemo, present, language } = useDemo((store) => ({
    live: store.live, syncDemo: store.syncDemo, present: !!store.snapshot || !!store.syncDemo,
    language: store.state.preferences.language || 'en',
  }));
  const view = syncView({ ...flat, history: flat.hasHistory ? {
    loaded: flat.historyLoaded, loading: flat.historyLoading, error: flat.historyError, forward: flat.historyForward,
  } : undefined }, actions);
  const key = viewKey(view);
  const [shown, setShown] = useState<Shown>(view.kind === 'syncing' || view.kind === 'reconnecting' ? { kind: 'hidden' } : view);
  const [open, setOpen] = useState(false);
  const current = useRef(shown);
  current.current = shown;
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  useEffect(() => {
    const previous = current.current.kind;
    let timer: number | undefined;
    if (busy(view.kind)) {
      // A sync after a visible state (a failure, offline, or another sync) shows at once, so a Retry has feedback.
      if (previous !== 'hidden' && previous !== 'synced') setShown(view);
      else timer = window.setTimeout(() => setShown(view), SYNC_SHOW_DELAY);
    } else if (view.kind === 'hidden') {
      if (previous === 'hidden') return;
      if (previous === 'synced') return;
      setShown({ kind: 'synced' });
    } else setShown(view);
    return () => window.clearTimeout(timer);
    // `key` holds every field of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (shown.kind !== 'synced' || open) return;
    const timer = window.setTimeout(() => setShown({ kind: 'hidden' }), SYNC_DONE_TIME);
    return () => window.clearTimeout(timer);
  }, [shown.kind, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  if (!present || shown.kind === 'hidden') return null;
  if (failuresOnly && shown.kind !== 'failed') return null;
  const retry = () => {
    setOpen(false);
    if (shown.kind === 'failed' && shown.scope === 'messages') {
      if (syncDemo) syncDemo.retryMessages();
      else if (sessionId) void live?.loadHistory(sessionId, 'forward').catch(() => { /* The status shows the failure. */ });
    } else if (syncDemo) syncDemo.retry();
    else void live?.retry();
  };
  const time = (at: number) => new Date(at).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });
  const title = shown.kind === 'offline' ? shown.saved ? t('Offline · saved on this device') : t('Offline · no saved data yet')
    : shown.kind === 'syncing' ? t('Syncing…')
      : shown.kind === 'reconnecting' ? t('Reconnecting…')
        : shown.kind === 'synced' ? t('Synced')
          : shown.scope === 'messages' ? t('Could not update messages')
            : shown.scope === 'live' ? t('Live updates paused') : t('Could not sync');
  const description = shown.kind === 'offline'
    ? shown.saved ? t('Rayno shows the content saved on this device. It syncs again when the network returns.')
      : t('Open your sessions online once to save them on this device.')
    : shown.kind === 'syncing' ? t('Rayno is reading the latest sessions and messages. You can keep reading and typing.')
      : shown.kind === 'reconnecting' ? t('Rayno is opening a new realtime connection. Your loaded messages stay on screen.')
        : shown.kind === 'synced' ? t('Sessions and open chats are up to date.')
          : shown.scope === 'messages' ? t('Your loaded messages are still here. Try again to get the latest replies.')
            : shown.scope === 'live' ? t('New replies can arrive late. Rayno tries again on its own.')
              : t('Rayno tries again on its own. Your loaded messages and your draft stay here.');
  const failed = shown.kind === 'failed';
  const tone = failed ? 'failed' : shown.kind === 'offline' ? 'offline' : shown.kind === 'synced' ? 'synced' : 'busy';
  const workspaceFailure = failed && shown.scope !== 'messages';
  const close = () => { setOpen(false); toggle.current?.focus({ preventScroll: true }); };
  return (
    <div ref={root} className={`${styles.anchor} ${failuresOnly ? styles.fixed : ''} ${className}`} data-sync-status={shown.kind}
      data-offline-status={shown.kind === 'offline' || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <div className={styles.pill} data-tone={tone}
        role={failed ? 'alert' : 'status'}
        aria-label={failed ? workspaceFailure ? t('Connection error') : t('Message sync error') : label}>
        <button ref={toggle} type="button" className={styles.summary} aria-expanded={open} aria-controls={detailsId}
          aria-label={`${title}. ${open ? t('Hide sync details') : t('Show sync details')}`}
          onClick={() => setOpen((value) => !value)}>
          {busy(shown.kind) ? <span className={styles.spin} aria-hidden="true"><Spinner /></span> : <Icon size={16} name={shown.kind === 'offline' ? 'cloudOfflineOutline'
            : shown.kind === 'synced' ? 'cloudDoneOutline' : 'alertCircleOutline'} />}
          <span>{title}</span>
        </button>
        {failed && <button type="button" className={styles.retry}
          aria-label={shown.scope === 'messages' ? t('Retry messages') : t('Retry')} onClick={retry}>{t('Retry')}</button>}
      </div>
      {open && (
        <section id={detailsId} className={styles.details} aria-label={t('Sync details')}>
          <p>{description}</p>
          <dl>
            <dt>{t('Last synced')}</dt>
            <dd>{flat.syncedAt ? time(flat.syncedAt) : t('Not on this visit yet')}</dd>
            {!!flat.cachedAt && !flat.syncedAt && <><dt>{t('Saved copy')}</dt><dd>{time(flat.cachedAt)}</dd></>}
          </dl>
          {failed && <details>
            <summary>{t('Technical details')}</summary>
            <pre>{shown.detail}</pre>
          </details>}
        </section>
      )}
    </div>
  );
});
