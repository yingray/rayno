import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Dispatch, PropsWithChildren } from 'react';
import type { Action, DemoAdapter, DemoState, Machine, UsageReading } from './types';
import type { HappyClient, Snapshot } from '../happy/client';
import { createExternalStore, createSelection, shallowEqual } from './subscriptions';
import type { UIState } from './uiState';
import { LanguageContext } from '../i18n';

export type Store = {
  mode: 'demo' | 'live';
  machines: Machine[];
  usage: UsageReading[];
  live?: HappyClient;
  snapshot?: Snapshot;
  server?: string;
  logout?: () => void;
  switchMode: () => void;
  state: DemoState;
  ui: UIState;
  dispatch: Dispatch<Action>;
  adapter: DemoAdapter;
  toast: string;
  notify: (message: string) => void;
  reset: () => void;
};

const StoreContext = createContext<ReturnType<typeof createExternalStore<Store>> | null>(null);

export function StoreProvider({ value, children }: PropsWithChildren<{ value: Store }>) {
  const [store] = useState(() => createExternalStore(value));
  // Publish after commit. An abandoned render must not change the shared snapshot.
  useLayoutEffect(() => store.set(value), [store, value]);
  useLayoutEffect(() => { document.documentElement.lang = value.state.preferences.language || 'en'; }, [value.state.preferences.language]);
  useLayoutEffect(() => {
    document.documentElement.dataset.glassStyle = value.state.preferences.glassStyle || 'standard';
    return () => { delete document.documentElement.dataset.glassStyle; };
  }, [value.state.preferences.glassStyle]);
  return <LanguageContext.Provider value={value.state.preferences.language || 'en'}><StoreContext.Provider value={store}>{children}</StoreContext.Provider></LanguageContext.Provider>;
}

export function useDemo<T>(selector: (store: Store) => T, equal: (a: T, b: T) => boolean = shallowEqual): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('The workspace provider is missing.');
  const getSelection = useMemo(() => createSelection(store.getSnapshot, selector, equal), [store, selector, equal]);
  return useSyncExternalStore(store.subscribe, getSelection);
}

export function useDraft(sessionId: string) {
  const store = useContext(StoreContext);
  if (!store) throw new Error('The workspace provider is missing.');
  const ui = store.getSnapshot().ui;
  const subscribe = useCallback((listener: () => void) => ui.subscribeDraft(sessionId, listener), [ui, sessionId]);
  const getSnapshot = useCallback(() => ui.getDraft(sessionId), [ui, sessionId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
