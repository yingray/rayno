import { Component, Suspense } from 'react';
import type { PropsWithChildren } from 'react';
import { currentBuild, isChunkError, recoverShell } from '../app/appUpdate';
import { Button, Spinner } from './ui';

// One automatic recovery per release. A second chunk failure shows the error, so the page cannot loop.
const RECOVERY_KEY = 'rayno.chunkRecovery';

function claimRecovery(): boolean {
  try {
    if (sessionStorage.getItem(RECOVERY_KEY) === currentBuild.commit) return false;
    sessionStorage.setItem(RECOVERY_KEY, currentBuild.commit);
    return true;
  } catch {
    return false;
  }
}

export function PanelLoading() {
  return <div role="status" aria-label="Load screen" className="panelLoading"><Spinner /><span>Load screen…</span></div>;
}

class ScreenErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: Error) {
    console.error('[Rayno] Screen failed', error);
    if (isChunkError(error) && navigator.onLine && claimRecovery()) void recoverShell();
  }
  render() {
    const { error } = this.state;
    if (error) return <div className="panelLoading screenError" role="alert">
      <p>This screen could not load. Reconnect and try again.</p>
      <code>{error.message || error.name} · {currentBuild.commit}</code>
      <Button onClick={() => void recoverShell()}>Reload screen</Button>
    </div>;
    return this.props.children;
  }
}

export function LazyBoundary({ children }: PropsWithChildren) {
  return <ScreenErrorBoundary><Suspense fallback={<PanelLoading />}>{children}</Suspense></ScreenErrorBoundary>;
}
