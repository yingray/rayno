import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createUIState } from './uiState';
import { createDebouncedSave } from './debouncedSave';
import type { DemoState } from './types';

export function useUIState(initial: () => DemoState, save: (state: DemoState) => void) {
  const [store] = useState(() => createUIState(initial()));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const writer = useMemo(() => createDebouncedSave(save), [save]);
  useLayoutEffect(() => {
    const schedule = () => writer.schedule(store.getState());
    const unsubscribe = store.subscribeChanges(schedule);
    schedule();
    return () => { unsubscribe(); writer.flush(); };
  }, [store, writer]);
  useEffect(() => {
    const flush = () => writer.flush();
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
      document.removeEventListener('visibilitychange', visibility);
      flush();
    };
  }, [writer]);
  return [state, store.dispatch, store] as const;
}
