import { useText } from "../i18n";
import { lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useId, useLayoutEffect, useRef, useState } from 'react';
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
import type { Session } from '../data/types';
import styles from './sessions.module.css';
import { SessionUsage } from './SessionUsage';
import { OfflineStatus } from '../components/OfflineStatus';
import { WorkspaceTag } from '../components/WorkspaceTag';
import { LazyBoundary } from '../components/LazyBoundary';
const SessionActions = lazy(() => import('./SessionActions').then((module) => ({ default: module.SessionActions })));

const SessionRow = memo(function SessionRow({ session, selected, onSelect, onAction }: {
  session: Session; selected: boolean; onSelect: (id: string) => void; onAction: (session: Session) => void;
}) {
  const t = useText();
  const longPress = useRef<number | undefined>(undefined);
  const didLongPress = useRef(false);
  useEffect(() => () => clearTimeout(longPress.current), []);
  return (
    <div className={styles.rowWrap} key={session.id}>
      <button
        type="button"
        className={`${styles.row} ${selected ? styles.selected : ''} ${isSessionFaded(session) ? styles.faded : ''}`}
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
        <Avatar agent={session.agent} />
        <span className={styles.rowBody}>
          <span className={styles.rowHeading}>
            <WorkspaceTag name={session.workspace} />
            <RelativeTime time={sessionActivityAt(session)} />
          </span>
          <span className={styles.summary}>{titleOf(session)}</span>
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
  return previous.selected === next.selected && previous.onSelect === next.onSelect
    && previous.onAction === next.onAction && shallowEqual(previousSummary, nextSummary);
});

export const SessionList = memo(function SessionList({ onSelect, onNew, searchRequested, onSearchHandled }: {
  onSelect?: () => void; onNew?: () => void; searchRequested?: boolean; onSearchHandled?: () => void;
}) {
  const t = useText();
  const { allSessions, loading, offline } = useDemo((store) => ({
    allSessions: store.state.sessions, loading: store.snapshot?.loading, offline: store.snapshot?.offline,
  }));
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'flat' | 'projects'>('flat');
  const [archived, setArchived] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsPosition, setOptionsPosition] = useState({ top: 70, maxHeight: 420 });
  const optionsId = useId();
  const list = useRef<HTMLElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsPanel = useRef<HTMLDivElement>(null);
  const focusSearch = useRef(false);
  const [actionSession, setActionSession] = useState<Session | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!searchRequested) return;
    focusSearch.current = !search.current;
    setOptionsOpen(true);
    search.current?.focus();
    onSearchHandled?.();
  }, [searchRequested, onSearchHandled]);
  function closeOptions(restoreFocus = true) {
    setOptionsOpen(false);
    if (restoreFocus) optionsButton.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const position = () => {
      if (!list.current || !optionsButton.current) return;
      const bounds = list.current.getBoundingClientRect();
      const button = optionsButton.current.getBoundingClientRect();
      const reserved = parseFloat(getComputedStyle(list.current).paddingBottom) || 0;
      const viewport = window.visualViewport;
      const bottom = Math.min(bounds.bottom - reserved, viewport ? viewport.height + viewport.offsetTop : innerHeight);
      setOptionsPosition({ top: button.bottom - bounds.top + 8, maxHeight: Math.max(80, Math.min(420, bottom - button.bottom - 20)) });
    };
    position();
    const observer = new ResizeObserver(position);
    if (list.current) observer.observe(list.current);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [optionsOpen]);
  useEffect(() => {
    if (!optionsOpen) return;
    if (focusSearch.current) search.current?.focus();
    else optionsPanel.current?.focus({ preventScroll: true });
    focusSearch.current = false;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!optionsPanel.current?.contains(target) && !optionsButton.current?.contains(target)) closeOptions(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeOptions();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [optionsOpen]);
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
  const filtered = !!query.trim() || mode !== 'flat' || archived;
  return (
    <section className={styles.list} aria-label={t("Session list")} ref={list}>
      <div className={styles.surface}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.mobileLogo}>
            <Mark size={36} />
          </span>
          <h1>{archived ? t("Archived") : t("Sessions")}</h1>
          <button
            ref={optionsButton}
            className={`${styles.optionsButton} ${filtered ? styles.filtered : ''}`}
            aria-label={t("Session list options")}
            aria-haspopup="dialog"
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            title={t("Search, grouping, and archived sessions")}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <Icon name="optionsOutline" size={19} />
            {filtered && <span className={styles.filterDot} role="img" aria-label={t("Active list filters")} />}
          </button>
          <Button
            className={styles.newDesktop}
            variant="accent"
            icon="add"
            onClick={() => {
              navigate('/new');
              onNew?.();
            }}
          >{t("New")}</Button>
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
                <h2 className={styles.groupLabel}>
                  {group}
                  <span>{sessions.filter((session) => session.project === group).length}</span>
                </h2>
              )}
              {sessions
                .filter((session) => !group || session.project === group)
                .map((session) => {
                  const selected = location.pathname.includes(`/session/${session.id}`);
                  return (
                    <SessionRow key={session.id} session={session} selected={selected}
                      onSelect={selectSession} onAction={setActionSession} />
                  );
                })}
            </div>
          ))
        )}
      </div>
      </div>
      {optionsOpen && (
        <div
          ref={optionsPanel}
          id={optionsId}
          role="dialog"
          aria-label={t("Session list options")}
          tabIndex={-1}
          className={styles.optionsPanel}
          style={{ top: optionsPosition.top, maxHeight: optionsPosition.maxHeight }}
        >
          <header className={styles.optionsHeading}>
            <div><h2>{t("List options")}</h2><span>{sessions.length} {sessions.length === 1 ? t("session") : t("sessions")}</span></div>
            <Button icon="close" variant="ghost" aria-label={t("Close list options")} onClick={() => closeOptions()} />
          </header>
          <label className={styles.search} data-focus-frame>
            <Icon name="searchOutline" size={17} />
            <input
              ref={search}
              aria-label={t("Search sessions")}
              placeholder={t("Search sessions")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); closeOptions(); } }}
            />
            {query && <Button icon="close" variant="ghost" aria-label={t("Clear session search")} onClick={() => { setQuery(''); search.current?.focus(); }} />}
          </label>
          <p className={styles.optionLabel}>{t("Group by")}</p>
          <Segment label={t("Session list mode")} value={mode} onChange={setMode}
            options={[{ value: 'flat', label: 'Flat' }, { value: 'projects', label: 'Projects' }]} />
          <p className={styles.optionLabel}>{t("Show")}</p>
          <Segment label={t("Session visibility")} value={archived ? "archived" : "active"}
            onChange={(value) => setArchived(value === 'archived')}
            options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
          <footer className={styles.optionsFooter}>
            <Button variant="ghost" disabled={!filtered} onClick={() => { setQuery(''); setMode('flat'); setArchived(false); }}>{t("Reset")}</Button>
            <Button variant="accent" onClick={() => closeOptions()}>{t("Done")}</Button>
          </footer>
        </div>
      )}
      <SessionUsage />
      <Button
        className={styles.fab}
        variant="accent"
        icon="add"
        aria-label={t("New session")}
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
