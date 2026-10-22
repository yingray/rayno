import { lazy, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Dialog, Empty, Icon, Mark } from '../components/ui';
import type { IconName } from '../components/ui';
import { useDemo } from '../data/store';
import { OfflineStatus } from '../components/OfflineStatus';
import styles from './app.module.css';
import { LazyBoundary } from '../components/LazyBoundary';
import { applyFavicon, attentionTitle, tabAttention } from './tabAttention';
const Chat = lazy(() => import('../features/Chat').then((module) => ({ default: module.Chat })));
const NewSession = lazy(() => import('../features/NewSession').then((module) => ({ default: module.NewSession })));
const SessionInfo = lazy(() => import('../features/SessionInfo').then((module) => ({ default: module.SessionInfo })));
const Settings = lazy(() => import('../features/Settings').then((module) => ({ default: module.Settings })));
const Monitor = lazy(() => import('../features/Monitor').then((module) => ({ default: module.Monitor })));
const MachineDetail = lazy(() => import('../features/Monitor').then((module) => ({ default: module.MachineDetail })));
const Inbox = lazy(() => import('../features/Inbox').then((module) => ({ default: module.Inbox })));
const SessionList = lazy(() => import('../features/Sessions').then((module) => ({ default: module.SessionList })));

const navigation: { key: string; name: string; icon: IconName; route: string }[] = [
  { key: 'sessions', name: 'Sessions', icon: 'codeSlash', route: '/sessions' },
  { key: 'monitor', name: 'Monitor', icon: 'pulseOutline', route: '/monitor' },
  { key: 'settings', name: 'Settings', icon: 'settingsOutline', route: '/settings/appearance' },
];
function subscribeViewport(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}
const viewportBreakpoint = () => window.innerWidth < 768 ? 0 : window.innerWidth < 1024 ? 768 : window.innerWidth < 1280 ? 1024 : 1280;
const useViewport = () => useSyncExternalStore(subscribeViewport, viewportBreakpoint);

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const width = useViewport();
  const mobile = width < 768;
  const path = location.pathname;
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('rayno.rail.expanded') === 'true';
    } catch {
      return false;
    }
  });
  const [listOpen, setListOpen] = useState(width >= 768 && width < 1024 && path === '/sessions');
  const [searchRequested, setSearchRequested] = useState(false);
  const searchHandled = useCallback(() => setSearchRequested(false), []);
  const closeList = useCallback(() => setListOpen(false), []);
  const [offline, setOffline] = useState(!navigator.onLine);
  const sessionRoute = path.startsWith('/session/');
  const sessionId = sessionRoute ? path.split('/')[2] : undefined;
  const sessionsArea = path === '/sessions' || sessionRoute || path === '/new';
  const showConversation = sessionRoute || (!mobile && path === '/sessions');
  const { session, dispatch, toast, mode, live, logout, loading, offlineWorkspace, retrying, unauthorized, connectionError } = useDemo((store) => ({
    session: sessionRoute ? store.state.sessions.find((item) => item.id === sessionId)
      : showConversation ? store.state.sessions.find((item) => !item.archived && !item.isSideChat) : undefined,
    dispatch: store.dispatch, toast: store.toast, mode: store.mode, live: store.live, logout: store.logout,
    loading: store.snapshot?.loading, offlineWorkspace: store.snapshot?.offline, retrying: store.snapshot?.retrying,
    unauthorized: store.snapshot?.unauthorized, connectionError: store.snapshot?.error || store.snapshot?.connectionError,
  }));
  useEffect(() => {
    if (live && session?.id) return live.watchSession(session.id);
  }, [live, session?.id]);
  const infoOpen = sessionRoute && path.endsWith('/info') && !!session;
  const active = path.startsWith('/settings')
    ? 'settings'
    : path.startsWith('/monitor') || path.startsWith('/machine')
      ? 'monitor'
      : path === '/inbox'
        ? 'inbox'
        : 'sessions';
  const showList =
    sessionsArea && (mobile ? path === '/sessions' : width >= 1024 && !(infoOpen && width >= 1280));
  const showTabs =
    (mobile && ['/sessions', '/inbox', '/monitor'].includes(path)) ||
    (mobile && path.startsWith('/settings'));
  useEffect(() => {
    setListOpen(false);
  }, [path]);
  useEffect(() => {
    if (!live && sessionId) dispatch({ type: 'read', id: sessionId });
  }, [sessionId, dispatch, live]);
  useEffect(() => {
    function search(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!mobile && width < 1024) setListOpen(true);
        else if (!sessionsArea || (mobile && path !== '/sessions')) navigate('/sessions');
        setSearchRequested(true);
      }
      if (event.key === 'Escape') {
        if (document.querySelector('[role="dialog"]')) return;
        if (listOpen) setListOpen(false);
        else if (infoOpen && session) navigate(`/session/${session.id}`);
        else if (path === '/new') navigate('/sessions');
      }
    }
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, [sessionsArea, mobile, width, path, listOpen, infoOpen, session, navigate]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const attention = useDemo((store) => tabAttention(store.state.sessions));
  useEffect(() => {
    document.title = attentionTitle(`Rayno · ${infoOpen ? 'Session info' : path === '/new' ? 'New session' : sessionRoute && session ? session.customTitle || session.title : navigation.find((item) => item.key === active)?.name || 'Floating Panels'}`, attention.count);
  }, [path, active, session, infoOpen, attention.count]);
  useEffect(() => applyFavicon(attention.needsInput), [attention.needsInput]);
  useEffect(() => () => applyFavicon(false), []);

  const closeInfo = useCallback(() => navigate(`/session/${session?.id}`), [navigate, session?.id]);
  const openInfo = useCallback(() => navigate(infoOpen ? `/session/${session?.id}` : `/session/${session?.id}/info`), [navigate, infoOpen, session?.id]);
  const openList = useCallback(() => setListOpen(true), []);
  if (path === '/') return <Navigate to="/sessions" replace />;
  if (path === '/settings') return <Navigate to="/settings/appearance" replace />;
  const knownRoute =
    sessionsArea ||
    path === '/monitor' ||
    path === '/inbox' ||
    path.startsWith('/settings/') ||
    path.startsWith('/machine/');
  const goNav = (item: (typeof navigation)[number]) => {
    if (item.key === 'sessions' && width >= 768 && width < 1024) {
      setListOpen(true);
      return;
    }
    navigate(item.route);
  };
  const showConnectionError = !!connectionError && !offlineWorkspace && !retrying;
  return (
    <>
      {offline ? (
        <div className={`${styles.networkBar} ${styles.offline}`} title="Network offline" />
      ) : loading ? (
        <div
          className={`${styles.networkBar} ${styles.loading}`}
          role="progressbar"
          aria-label="Load workspace"
        />
      ) : null}
      {showConnectionError && (
        <div className={styles.connection} role="alert" aria-label="Connection error">
          <span>{connectionError}</span>
          <button onClick={() => void live?.retry()}>
            Retry
          </button>
          {unauthorized && <button onClick={logout}>Sign in again</button>}
        </div>
      )}
      <div
        className={`${styles.shell} ${path === '/new' ? styles.newSessionShell : ''} ${showConnectionError ? styles.statusShell : ''} ${expanded ? styles.expandedShell : ''}`}
      >
        {!mobile && (
          <nav
            className={`${styles.rail} ${expanded ? styles.expanded : ''}`}
            aria-label="Main navigation"
          >
            <a
              className={styles.brand}
              href="/sessions"
              onClick={(event) => {
                event.preventDefault();
                goNav(navigation[0]);
              }}
              aria-label="Rayno home"
            >
              <Mark />
              <span>
                Rayno<span className={styles.brandCaption}>A space for your agents</span>
              </span>
            </a>
            <div className={styles.railDivider} />
            {navigation.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.navItem} ${active === item.key ? styles.navActive : ''}`}
                aria-label={item.name}
                aria-current={active === item.key ? 'page' : undefined}
                title={item.name}
                onClick={() => goNav(item)}
              >
                <Icon name={item.icon} size={21} />
                <span>{item.name}</span>
              </button>
            ))}
            <div className={styles.railBottom}>
              <Button
                variant="ghost"
                icon={expanded ? 'chevronBackOutline' : 'chevronForwardOutline'}
                aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
                aria-expanded={expanded}
                onClick={() =>
                  setExpanded((value) => {
                    try {
                      localStorage.setItem('rayno.rail.expanded', String(!value));
                    } catch {
                      /* The rail still works without browser storage. */
                    }
                    return !value;
                  })
                }
              />
              <button
                className={styles.account}
                onClick={() => navigate('/settings/account')}
                aria-label="Account settings"
              >
                {mode === 'demo' ? 'R' : 'H'}
              </button>
              {expanded && (
                <span className={styles.accountName}>
                  {mode === 'demo' ? 'Ray' : 'Happy'}
                  <span>{mode === 'demo' ? 'Personal workspace' : 'Connected workspace'}</span>
                </span>
              )}
            </div>
          </nav>
        )}
        {showList && (
          <div className={styles.listPanel}>
            <LazyBoundary><SessionList searchRequested={searchRequested} onSearchHandled={searchHandled} /></LazyBoundary>
          </div>
        )}
        {!(mobile && path === '/sessions') && (
          <main
            className={`${styles.mainPanel} ${showTabs ? styles.withTabs : ''} ${path === '/new' ? styles.newMobile : ''}`}
          >
            <LazyBoundary>{!knownRoute ? (
              <Empty
                title="This page is taking a break"
                action={<Button onClick={() => navigate('/sessions')}>Back to sessions</Button>}
              >
                The address does not match a Rayno screen.
              </Empty>
            ) : path === '/new' ? (
              <NewSession />
            ) : path === '/monitor' ? (
              <Monitor />
            ) : path.startsWith('/machine/') ? (
              <MachineDetail id={path.split('/')[2]} />
            ) : path.startsWith('/settings') ? (
              <Settings />
            ) : path === '/inbox' ? (
              <Inbox />
            ) : mobile && infoOpen ? (
              <LazyBoundary><SessionInfo session={session!} onClose={closeInfo} /></LazyBoundary>
            ) : session ? (
              <Chat
                key={session.id}
                session={session}
                onInfo={openInfo}
                onList={openList}
              />
            ) : (
              <Empty
                title={sessionRoute
                  ? loading ? 'Load conversation…' : offlineWorkspace ? 'Not available offline' : 'Session not found'
                  : 'Make room for your next idea'}
                action={
                  <Button variant="accent" icon="add" onClick={() => navigate('/new')}>
                    New session
                  </Button>
                }
              >
                {sessionRoute
                  ? loading ? 'Your saved conversations stay available while the workspace updates.'
                    : offlineWorkspace ? 'Open this conversation online once to save it on this device.'
                      : 'This session may have been deleted.'
                  : 'Pick a computer and start a conversation.'}
                {offlineWorkspace && <OfflineStatus label="Conversation availability" />}
              </Empty>
            )}</LazyBoundary>
          </main>
        )}
        {!mobile && infoOpen && width >= 1280 && (
          <aside className={styles.infoPanel}>
            <LazyBoundary><SessionInfo session={session!} onClose={closeInfo} /></LazyBoundary>
          </aside>
        )}
        {!mobile && infoOpen && width < 1280 && (
          <Dialog title="Session info" onClose={closeInfo} className={styles.infoDrawer}>
            <LazyBoundary><SessionInfo session={session!} onClose={closeInfo} embedded /></LazyBoundary>
          </Dialog>
        )}
        {!mobile && listOpen && (
          <Dialog title="Sessions" onClose={closeList} className={styles.listDrawer}>
            <LazyBoundary><SessionList searchRequested={searchRequested} onSearchHandled={searchHandled}
              onSelect={closeList} onNew={closeList} /></LazyBoundary>
          </Dialog>
        )}
        {showTabs && (
          <nav className={styles.tabBar} aria-label="Main navigation">
            {navigation.map((item) => (
              <button
                key={item.key}
                aria-label={item.name}
                aria-current={active === item.key ? 'page' : undefined}
                className={active === item.key ? styles.tabActive : ''}
                onClick={() => navigate(item.route)}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.name}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
      {toast && (
        <div className={styles.toast} role="status">
          <Icon name="checkmarkCircleOutline" size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
