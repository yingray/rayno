import { useText } from "../i18n";
import { lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Empty,
  Icon,
  Mark,
  RelativeTime,
  Segment,
  Spinner,
} from '../components/ui';
import { useDemo } from '../data/store';
import { shallowEqual } from '../data/subscriptions';
import { titleOf } from '../data/reducer';
import { compareSessionActivity, isSessionFaded, sessionActivityAt } from '../data/sessionList';
import type { Session, SessionListMode } from '../data/types';
import styles from './sessions.module.css';
import { SessionUsage } from './SessionUsage';
import { OfflineStatus } from '../components/OfflineStatus';
import { WorkspaceTag } from '../components/WorkspaceTag';
import { LazyBoundary } from '../components/LazyBoundary';
const SessionActions = lazy(() => import('./SessionActions').then((module) => ({ default: module.SessionActions })));

const SessionRow = memo(function SessionRow({ session, selected, showWorkspace, onSelect, onAction }: {
  session: Session; selected: boolean; showWorkspace: boolean;
  onSelect: (id: string) => void; onAction: (session: Session) => void;
}) {
  const t = useText();
  const longPress = useRef<number | undefined>(undefined);
  const didLongPress = useRef(false);
  useEffect(() => () => clearTimeout(longPress.current), []);
  return (
    <div className={styles.rowWrap} key={session.id}>
      <button
        type="button"
        className={`${styles.row} ${!showWorkspace ? styles.projectRow : ''} ${selected ? styles.selected : ''} ${isSessionFaded(session) ? styles.faded : ''}`}
        aria-current={selected ? "page" : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          onAction(session);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') {
            didLongPress.current = false;
            longPress.current = window.setTimeout(() => {
              didLongPress.current = true;
              onAction(session);
            }, 550);
          }
        }}
        onPointerUp={() => clearTimeout(longPress.current)}
        onPointerCancel={() => clearTimeout(longPress.current)}
        onPointerMove={() => clearTimeout(longPress.current)}
        onClick={() => {
          if (didLongPress.current) {
            didLongPress.current = false;
            return;
          }
          onSelect(session.id);
        }}
      >
        <Avatar sessionId={session.id} agent={session.agent} />
        <span className={styles.rowBody}>
          {showWorkspace ? <>
            <span className={styles.rowHeading}>
              <WorkspaceTag name={session.workspace} />
              <RelativeTime time={sessionActivityAt(session)} />
            </span>
            <span className={styles.summary}>{titleOf(session)}</span>
          </> : <span className={`${styles.rowHeading} ${styles.projectHeading}`}>
            <span className={styles.summary}>{titleOf(session)}</span>
            <RelativeTime time={sessionActivityAt(session)} />
          </span>}
        </span>
        <span className={styles.indicator}>
          {!isSessionFaded(session) && session.status === 'running' && (
            <Spinner />
          )}
          {(session.needsReply ?? session.status === 'blocked') && (
            <span
              className={styles.dot}
              style={{ background: 'var(--orange)' }}
              role="img"
              aria-label={t("Needs input")}
              title={t("Needs your reply")}
            />
          )}
          {session.unread && (
            <span className={styles.dot} style={{ background: 'var(--accent-soft)' }}
              role="img" aria-label={t("Unread")} title={t("Unread messages")} />
          )}
        </span>
      </button>
      <button
        className={styles.more}
        aria-label={`Actions for ${titleOf(session)}`}
        onClick={() => onAction(session)}
      >
        <Icon name="ellipsisHorizontal" size={15} />
      </button>
    </div>
  );
}, (previous, next) => {
  const { messages: _previousMessages, ...previousSummary } = previous.session;
  const { messages: _nextMessages, ...nextSummary } = next.session;
  return previous.selected === next.selected && previous.showWorkspace === next.showWorkspace && previous.onSelect === next.onSelect
    && previous.onAction === next.onAction && shallowEqual(previousSummary, nextSummary);
});

export const SessionList = memo(function SessionList({ onSelect, onNew, searchRequested, onSearchHandled }: {
  onSelect?: () => void; onNew?: () => void; searchRequested?: boolean; onSearchHandled?: () => void;
}) {
  const t = useText();
  const { allSessions, loading, offline, mode, archived, dispatch } = useDemo((store) => ({
    allSessions: store.state.sessions, loading: store.snapshot?.loading, offline: store.snapshot?.offline,
    mode: store.state.preferences.sessionListMode || 'flat', archived: store.state.preferences.sessionListArchived ?? false, dispatch: store.dispatch,
  }));
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const setMode = useCallback((sessionListMode: SessionListMode) => {
    dispatch({ type: 'preferences', value: { sessionListMode } });
  }, [dispatch]);
  const [searchOpen, setSearchOpen] = useState(false);
  const list = useRef<HTMLElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  const [actionSession, setActionSession] = useState<Session | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!searchRequested) return;
    setSearchOpen(true);
    search.current?.focus();
    onSearchHandled?.();
  }, [searchRequested, onSearchHandled]);
  useLayoutEffect(() => {
    if (searchOpen) search.current?.focus();
    else if (restoreSearchFocus.current) {
      searchButton.current?.focus({ preventScroll: true });
      restoreSearchFocus.current = false;
    }
  }, [searchOpen]);
  function closeSearch() {
    restoreSearchFocus.current = true;
    setQuery('');
    setSearchOpen(false);
  }
  useEffect(() => {
    if (!searchOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !list.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    };
    // Handle search before a containing drawer handles Escape at the document.
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [searchOpen]);
  const deferredQuery = useDeferredValue(query);
  const sessions = useMemo(() => allSessions
    .filter(
      (session) =>
        !session.isSideChat &&
        session.archived === archived &&
        `${session.workspace} ${titleOf(session)} ${session.project}`
          .toLowerCase()
          .includes(deferredQuery.trim().toLowerCase()),
    )
    .sort(compareSessionActivity), [allSessions, archived, deferredQuery]);
  const groups = useMemo(() => mode === 'projects'
    ? Array.from(new Set(sessions.map((session) => session.project))) : [''], [mode, sessions]);
  const closeActions = useCallback(() => setActionSession(null), []);
  const selectSession = useCallback((id: string) => {
    navigate(`/session/${id}`);
    onSelect?.();
  }, [navigate, onSelect]);
  return (
    <section className={styles.list} aria-label={t("Session list")} ref={list}>
      <div className={styles.surface}>
      <header className={styles.header}>
        <div className={styles.heading}>
          {searchOpen ? <div className={styles.search} data-focus-frame role="search" aria-label={t('Search sessions')}>
            <Icon name="searchOutline" size={17} />
            <input ref={search} aria-label={t('Search sessions')} placeholder={t('Search sessions')}
              value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              }} />
            <Button icon="close" variant="ghost" aria-label={t('Close session search')} onClick={closeSearch} />
          </div> : <>
            <span className={styles.mobileLogo}><Mark size={36} /></span>
            <h1>{archived ? t('Archived') : t('Sessions')}</h1>
            <button ref={searchButton} className={styles.searchButton} type="button"
              aria-label={t('Search sessions')} onClick={() => setSearchOpen(true)}><Icon name="searchOutline" size={19} /></button>
          </>}
          <Button variant="ghost" icon="archiveOutline" aria-label={t('Archived sessions')}
            title={archived ? t('Show active sessions') : t('Show archived sessions')}
            aria-pressed={archived} className={styles.archiveToggle}
            onClick={() => dispatch({ type: 'preferences', value: { sessionListArchived: !archived } })} />
          <Button
            className={styles.newDesktop}
            variant="accent"
            icon="createOutline"
            aria-label={t("New session")}
            title={t("New session")}
            onClick={() => {
              navigate('/new');
              onNew?.();
            }}
          />
        </div>
        <div className={styles.filters}>
          <Segment label={t('Session list mode')} value={mode} onChange={setMode}
            options={[
              { value: 'flat', label: <span className={styles.filterLabel}><Icon name="listOutline" size={15} />{t('Flat')}</span> },
              { value: 'projects', label: <span className={styles.filterLabel}><Icon name="folderOutline" size={15} />{t('Projects')}</span> },
            ]} />

        </div>
        <OfflineStatus label={t("Session list availability")} />
      </header>
      <div className={styles.rows}>
        {!sessions.length ? (
          <Empty
            title={
              offline && !allSessions.length
                ? t("No saved sessions")
                : loading
                ? t("Read your sessions…")
                : query
                  ? t("No matching sessions")
                  : archived
                    ? t("Nothing archived yet")
                    : t("A fresh start")
            }
          >
            {offline && !allSessions.length
              ? t("Connect once to save your session list on this device.")
              : query
              ? t("Try another workspace or session name.")
              : t("Start a session to give your next idea a place.")}
          </Empty>
        ) : (
          groups.map((group) => (
            <div key={group}>
              {group && (
                <h2 className={styles.groupLabel} title={group}>
                  <WorkspaceTag name={group} />
                  <span className={styles.groupCount}>{sessions.filter((session) => session.project === group).length}</span>
                </h2>
              )}
              {sessions
                .filter((session) => !group || session.project === group)
                .map((session) => {
                  const selected = location.pathname.includes(`/session/${session.id}`);
                  return (
                    <SessionRow key={session.id} session={session} selected={selected} showWorkspace={mode === 'flat' || !group}
                      onSelect={selectSession} onAction={setActionSession} />
                  );
                })}
            </div>
          ))
        )}
      </div>
      </div>
      <SessionUsage />
      <Button
        className={styles.fab}
        variant="accent"
        icon="createOutline"
        aria-label={t("New session")}
        title={t("New session")}
        onClick={() => {
          navigate('/new');
          onNew?.();
        }}
      />
      {actionSession && (
        <LazyBoundary><SessionActions session={actionSession} onClose={closeActions} /></LazyBoundary>
      )}
    </section>
  );
});
