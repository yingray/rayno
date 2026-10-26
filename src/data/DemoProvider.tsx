import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { createInitialState, machines, usageReadings } from './fixtures';
import { restoreState, STORAGE_KEY, validateDraft } from './reducer';
import type { DemoAdapter, DemoState, NewSessionDraft, Attachment } from './types';
import { modelChoiceKey } from '../happy/modelPreferences';
import { StoreProvider } from './store';
import { useUIState } from './useUIState';
import { questionDemoId, createQuestionDemo } from './questionDemo';
import { imageDemoId, createImageDemo } from './imageDemo';
import { invocationDemoId, createInvocationDemo } from './invocationDemo';
import { replyOptionsDemoId, createReplyOptionsDemo, replyOptionsDemoChoices } from './replyOptionsDemo';
import { toolTimelineDemoId, createToolTimelineDemo } from './toolTimelineDemo';
import { gitDiffDemoId, createGitDiffDemo } from './gitDiffDemo';
import { createWorkspaceLayoutDemo } from './workspaceLayoutDemo';

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
// The simulated recap answer comes before a normal reply, so the chat can show the waiting state.
const RECAP_REPLY_DELAY = 1500;
const recapTimer = (id: string) => `recap:${id}`;

export function DemoProvider({
  children,
  switchMode,
}: PropsWithChildren<{ switchMode: () => void }>) {
  const [toast, setToast] = useState('');
  const timers = useRef(new Map<string, number>());
  const replyPrompts = useRef(new Map<string, string[]>());
  const saveFailed = useRef(false);
  const save = useCallback((state: DemoState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      if (!saveFailed.current) {
        setToast('Browser storage is unavailable. Changes last for this visit.');
        saveFailed.current = true;
      }
    }
  }, []);
  const [state, dispatch, ui] = useUIState(() => {
    const fallback = createInitialState();
    try {
      const restored = restoreState(localStorage.getItem(STORAGE_KEY), fallback);
      const examples = createWorkspaceLayoutDemo().filter(example => !restored.sessions.some(session => session.id === example.id));
      if (examples.length) restored.sessions = [...restored.sessions, ...examples];
      if (!restored.sessions.some(session => session.id === gitDiffDemoId))
        restored.sessions = [...restored.sessions, createGitDiffDemo()];
      // Make the new example discoverable on older saved demo accounts, too.
      if (!restored.sessions.some(session => session.id === toolTimelineDemoId))
        restored.sessions = [...restored.sessions, createToolTimelineDemo()];
      if (window.location.pathname === `/session/${replyOptionsDemoId}`
        && !restored.sessions.some(session => session.id === replyOptionsDemoId)) {
        return { ...restored, sessions: [...restored.sessions, createReplyOptionsDemo()] };
      }
      if (window.location.pathname === `/session/${invocationDemoId}`
        && !restored.sessions.some(session => session.id === invocationDemoId)) {
        return { ...restored, sessions: [...restored.sessions, createInvocationDemo()] };
      }
      if (window.location.pathname === `/session/${imageDemoId}`
        && !restored.sessions.some(session => session.id === imageDemoId)) {
        return { ...restored, sessions: [...restored.sessions, createImageDemo()] };
      }
      // An explicit demo link also works with data from an older visit.
      if (window.location.pathname === `/session/${questionDemoId}`
        && !restored.sessions.some(session => session.id === questionDemoId)) {
        return { ...restored, sessions: [...restored.sessions, createQuestionDemo()] };
      }
      return restored;
    } catch {
      return fallback;
    }
  }, save);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      replyPrompts.current.clear();
    },
    [],
  );

  const adapter = useMemo<DemoAdapter>(() => {
    function cancel(id: string) {
      for (const key of [id, recapTimer(id)]) {
        clearTimeout(timers.current.get(key));
        timers.current.delete(key);
      }
      replyPrompts.current.delete(id);
    }
    function reply(id: string, prompt: string) {
      replyPrompts.current.set(id, [...(replyPrompts.current.get(id) || []), prompt]);
      if (timers.current.has(id)) return;
      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        const prompts = (replyPrompts.current.get(id) || []).join('\n\n');
        replyPrompts.current.delete(id);
        dispatch({
          type: 'reply',
          id,
          now: Date.now(),
          keepRunning: timers.current.has(recapTimer(id)),
          message: {
            id: crypto.randomUUID(),
            role: 'assistant',
            sentAt: Date.now(),
            duration: '3s',
            tools: ['Read the current workspace context', 'Prepare a local demonstration response'],
            content: `I’ve received your request:\n\n> ${prompts.replace(/\n/g, '\n> ')}\n\nThis is a **simulated response** in the Rayno demo. Your message and this conversation stay in this browser.\n\nYou can explore the **Changes** and **Files** tabs, open session details, or start another session.${id === replyOptionsDemoId ? '\n\n' + replyOptionsDemoChoices : ''}`,
          },
        });
      }, 3000);
      timers.current.set(id, timer);
    }
    // Answer a manual recap request like an agent: a reply with only a recap block for the previous reply.
    function replyRecap(id: string) {
      if (timers.current.has(recapTimer(id))) return;
      const timer = window.setTimeout(() => {
        // Load the Markdown parser only for this simulated answer.
        void import('./recapDemo').then(({ demoRecapReply }) => {
          if (timers.current.get(recapTimer(id)) !== timer) return;
          timers.current.delete(recapTimer(id));
          dispatch({
            type: 'reply',
            id,
            now: Date.now(),
            keepRunning: timers.current.has(id),
            message: { id: crypto.randomUUID(), role: 'assistant',
              content: demoRecapReply(ui.getState().sessions.find((item) => item.id === id)?.messages || []) },
          });
        });
      }, RECAP_REPLY_DELAY);
      timers.current.set(recapTimer(id), timer);
    }
    return {
      async createSession(draft: NewSessionDraft, attachments: Attachment[] = []) {
        const error = validateDraft(
          draft,
          !!machines.find((machine) => machine.id === draft.machineId)?.online,
        );
        if (error) throw new Error(error);
        dispatch({ type: 'rememberModel', key: modelChoiceKey(draft.agent, draft.machineId),
          value: { model: draft.model, effort: draft.effort || null } });
        dispatch({ type: 'rememberPermission', key: modelChoiceKey(draft.agent, draft.machineId), value: draft.permissionMode });
        await delay(650);
        const id = crypto.randomUUID();
        try {
          localStorage.setItem(`rayno.demo.composerModes.${id}`, JSON.stringify({
            model: draft.model, effort: draft.effort || null, permission: draft.permissionMode, at: Date.now(),
          }));
        } catch { /* Keep the session usable when browser storage is unavailable. */ }
        const now = Date.now();
        const path = draft.path.trim();
        dispatch({
          type: 'create',
          session: {
            id,
            title: draft.prompt.trim().slice(0, 110),
            workspace: path.split('/').filter(Boolean).pop() || 'workspace',
            project: 'Your sessions',
            path,
            machineId: draft.machineId,
            agent: draft.agent,
            model: draft.model,
            effort: draft.effort,
            branch: draft.type === 'Worktree' ? draft.worktree : 'main',
            additions: 0,
            deletions: 0,
            status: 'running',
            unread: false,
            archived: false,
            createdAt: now,
            updatedAt: now,
            messages: [
              { id: crypto.randomUUID(), role: 'user', content: draft.prompt.trim(), attachments },
            ],
          },
        });
        reply(id, draft.prompt.trim());
        return id;
      },
      renameSession(id, name) {
        dispatch({ type: 'rename', id, name });
        setToast(name.trim() ? 'Session renamed' : 'Agent title restored');
      },
      archiveSession(id) {
        cancel(id);
        dispatch({ type: 'archive', id });
        setToast('Session archive updated');
      },
      deleteSession(id) {
        cancel(id);
        dispatch({ type: 'delete', id });
        setToast('Session deleted');
      },
      sendMessage(id, content, attachments = [], options = {}) {
        const session = ui.getState().sessions.find((item) => item.id === id);
        if (
          !session ||
          session.status === 'offline' ||
          session.archived ||
          (!content.trim() && !attachments.length)
        )
          return;
        dispatch({
          type: 'send',
          id,
          now: Date.now(),
          message: { id: crypto.randomUUID(), role: 'user', content: content.trim(), attachments },
          preserveDraft: options.preserveDraft,
        });
        reply(id, content.trim() || 'Review the attached files.');
      },
      sendRecapRequest(id) {
        const session = ui.getState().sessions.find((item) => item.id === id);
        if (!session || session.status === 'offline' || session.archived) return;
        dispatch({
          type: 'send',
          id,
          now: Date.now(),
          message: { id: crypto.randomUUID(), role: 'user', content: 'Recap', recapRequest: true },
          preserveDraft: true,
        });
        replyRecap(id);
      },
      stopSession(id) {
        cancel(id);
        dispatch({ type: 'stop', id });
        setToast('Simulated response stopped');
      },
      async refreshMonitor() {
        await delay(750);
      },
    };
  }, [ui]);
  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    replyPrompts.current.clear();
    dispatch({ type: 'reset', state: createInitialState() });
    setToast('Demo data reset');
  }, []);
  return (
    <StoreProvider
      value={{
        mode: 'demo',
        machines,
        usage: usageReadings,
        switchMode,
        state,
        ui,
        dispatch,
        adapter,
        toast,
        notify: setToast,
        reset,
      }}
    >
      {children}
    </StoreProvider>
  );
}
