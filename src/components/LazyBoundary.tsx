import { Component, Suspense } from 'react';
import type { PropsWithChildren } from 'react';
import { Button, Spinner } from './ui';

export function PanelLoading() {
  return <div role="status" aria-label="Load screen" className="panelLoading"><Spinner /><span>Load screen…</span></div>;
}

class ScreenErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="panelLoading" role="alert">
      <p>This screen could not load. Reconnect and try again.</p>
      <Button onClick={() => window.location.reload()}>Reload screen</Button>
    </div>;
    return this.props.children;
  }
}

export function LazyBoundary({ children }: PropsWithChildren) {
  return <ScreenErrorBoundary><Suspense fallback={<PanelLoading />}>{children}</Suspense></ScreenErrorBoundary>;
}
