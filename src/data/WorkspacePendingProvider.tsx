import { useState, type PropsWithChildren } from 'react';
import { defaultNewDraft, defaultPreferences } from './defaults';
import { StoreProvider } from './store';
import { createUIState } from './uiState';
import type { DemoAdapter, DemoState } from './types';

const unavailable = async (): Promise<never> => { throw new Error('The workspace is not ready yet.'); };
const adapter: DemoAdapter = {
  createSession: unavailable, sendMessage: unavailable, sendRecapRequest: unavailable,
  renameSession: unavailable, archiveSession: unavailable, deleteSession: unavailable,
  stopSession: unavailable, refreshMonitor: unavailable,
};

// Keep the app shell visible while the account key and encrypted cache open.
export function WorkspacePendingProvider({ children }: PropsWithChildren) {
  const [ui] = useState(() => createUIState({ version: 1, sessions: [], drafts: {}, recentPaths: [],
    preferences: { ...defaultPreferences }, newDraft: { ...defaultNewDraft, machineId: '', path: '', worktree: '', model: '', effort: undefined },
  } satisfies DemoState));
  return <StoreProvider value={{ mode: 'live', state: ui.getSnapshot(), ui, dispatch: ui.dispatch,
    adapter, machines: [], usage: [], workspaceLoading: true, workspacePending: true,
    toast: '', notify: () => {}, reset: () => {}, switchMode: () => {},
  }}>{children}</StoreProvider>;
}
