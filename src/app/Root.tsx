import { lazy, useCallback, useEffect, useState } from 'react';
import { clearCredentials, readCredentials } from '../happy/credentials';
import type { Credentials } from '../happy/credentials';
import { LazyBoundary } from '../components/LazyBoundary';

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));
const DemoProvider = lazy(() => import('../data/DemoProvider').then((module) => ({ default: module.DemoProvider })));
const LiveProvider = lazy(() => import('../happy/LiveProvider').then((module) => ({ default: module.LiveProvider })));
const Login = lazy(() => import('../happy/Login').then((module) => ({ default: module.Login })));

export function Root() {
  const [credentials, setCredentials] = useState<Credentials | null>(readCredentials);
  const [demo, setDemo] = useState(() =>
    new URLSearchParams(window.location.search).get('demo') === '1'
    || localStorage.getItem('rayno.mode') === 'demo');
  useEffect(() => {
    if (!demo) return;
    try { localStorage.setItem('rayno.mode', 'demo'); } catch { /* Keep demo mode for this visit when storage is unavailable. */ }
  }, [demo]);
  const login = useCallback((value: Credentials) => {
    localStorage.setItem('rayno.mode', 'live');
    setDemo(false);
    setCredentials(value);
  }, []);
  const switchMode = useCallback(() => {
    localStorage.setItem('rayno.mode', demo ? 'live' : 'demo');
    setDemo(!demo);
  }, [demo]);
  const logout = useCallback(() => {
    clearCredentials();
    setCredentials(null);
  }, []);
  if (demo)
    return (
      <LazyBoundary>
        <DemoProvider switchMode={switchMode}>
          <App />
        </DemoProvider>
      </LazyBoundary>
    );
  if (!credentials) return <LazyBoundary><Login onLogin={login} onDemo={switchMode} /></LazyBoundary>;
  return (
    <LazyBoundary>
      <LiveProvider
        key={credentials.server + credentials.token}
        credentials={credentials}
        login={login}
        logout={logout}
        switchMode={switchMode}
      >
        <App />
      </LiveProvider>
    </LazyBoundary>
  );
}
