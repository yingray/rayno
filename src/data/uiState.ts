import { demoReducer } from './reducer';
import type { Action, DemoState } from './types';

// Draft notifications stay local to one session. The full workspace must not
// receive an external-store notification for each character in the composer.
export function createUIState(initial: DemoState) {
  let state = initial;
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const changes = new Set<() => void>();
  const drafts = new Map<string, Set<() => void>>();
  return {
    getState: () => state,
    getSnapshot: () => snapshot,
    getDraft: (id: string) => state.drafts[id] || '',
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeChanges(listener: () => void) {
      changes.add(listener);
      return () => { changes.delete(listener); };
    },
    subscribeDraft(id: string, listener: () => void) {
      let session = drafts.get(id);
      if (!session) drafts.set(id, session = new Set());
      session.add(listener);
      return () => {
        session.delete(listener);
        if (!session.size) drafts.delete(id);
      };
    },
    dispatch(action: Action) {
      const previous = state;
      const next = demoReducer(state, action);
      if (next === previous) return;
      state = next;
      if (action.type !== 'draft') {
        snapshot = next;
        listeners.forEach((listener) => listener());
      }
      if (next.drafts !== previous.drafts) {
        const ids = action.type === 'draft' ? [action.id] : drafts.keys();
        for (const id of ids) if ((previous.drafts[id] || '') !== (next.drafts[id] || ''))
          drafts.get(id)?.forEach((listener) => listener());
      }
      changes.forEach((listener) => listener());
    },
  };
}
export type UIState = ReturnType<typeof createUIState>;
