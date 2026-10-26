import { reconcileDraftOptions, toggleDraftOption, type DraftOption } from './draftOptions';
import { demoReducer } from './reducer';
import type { Action, DemoState } from './types';
import type { TranscriptMemory } from './transcript';
import { createSessionGitStore } from './sessionGit';

// Draft notifications stay local to one session. The full workspace must not
// receive an external-store notification for each character in the composer.
export function createUIState(initial: DemoState) {
  // This map belongs to the account provider. No transcript content enters a module-global cache.
  const optionDrafts = new Map<string, readonly DraftOption[]>();
  const emptyOptions: readonly DraftOption[] = [];
  const transcripts = new Map<string, TranscriptMemory>();
  const git = createSessionGitStore();
  let state = initial;
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const changes = new Set<() => void>();
  const drafts = new Map<string, Set<() => void>>();
  return {
    transcripts,
    git,
    getState: () => state,
    getSnapshot: () => snapshot,
    getDraftOptions: (id: string) => optionDrafts.get(id) || emptyOptions,
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
      if (action.type === 'reset') { optionDrafts.clear(); git.clear(); }
      if (action.type === 'delete') { transcripts.delete(action.id); optionDrafts.delete(action.id); git.clear(action.id); }
      const optionAction = action.type === 'draftOption';
      if (action.type === 'draftOption') {
        const result = toggleDraftOption(state.drafts[action.id] || '', optionDrafts.get(action.id) || [], action.key, action.messageId, action.text);
        optionDrafts.set(action.id, result.options);
        action = { type: 'draft', id: action.id, value: result.value };
      }
      const previous = state;
      const next = demoReducer(state, action);
      if (next === previous) return;
      if (!optionAction) for (const [id, options] of optionDrafts) {
        const value = next.drafts[id] || '', old = previous.drafts[id] || '';
        if (value !== old) optionDrafts.set(id, reconcileDraftOptions(old, value, options));
      }
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
