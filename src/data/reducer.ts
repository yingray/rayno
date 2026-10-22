import { defaultNewDraft, defaultPreferences } from './defaults';
import type { Action, DemoState, NewSessionDraft, Session } from './types';
import { rememberWorkspace } from './workspaces';
import { shallowEqual } from './subscriptions';
import { PREVIOUS_RECAP_STYLES, RECAP_STYLE_LIMIT } from '../happy/systemPrompt';
import { resolveNewSessionPermission } from '../happy/permissionOptions';

export const STORAGE_KEY = 'rayno.demo.v1';
export const titleOf = (session: Session) => session.customTitle || session.title;

export function validateDraft(draft: NewSessionDraft, online: boolean): string | null {
  if (!online) return 'Choose an online computer to start a session.';
  if (!draft.path.trim()) return 'Choose a folder for this session.';
  if (!draft.permissionMode?.trim()) return 'Choose a permission mode before you start a session.';
  if (!draft.prompt.trim()) return 'Describe what the agent should do.';
  if (draft.type === 'Worktree' && !draft.worktree.trim())
    return 'Choose a worktree or enter a new branch name.';
  return null;
}

export function demoReducer(state: DemoState, action: Action): DemoState {
  if (action.type === 'reset') return action.state;
  if (action.type === 'draft' && (state.drafts[action.id] || '') === action.value) return state;
  if (action.type === 'newDraft' && Object.entries(action.value).every(([key, value]) =>
    Object.is(state.newDraft[key as keyof NewSessionDraft], value))) return state;
  if (action.type === 'preferences' && Object.entries(action.value).every(([key, value]) =>
    Object.is(state.preferences[key as keyof typeof state.preferences], value))) return state;
  if (action.type === 'rememberModel' && shallowEqual(state.modelChoices?.[action.key], action.value)) return state;
  if (action.type === 'rememberPermission' && state.permissionChoices?.[action.key] === action.value) return state;
  if (action.type === 'read' && !state.sessions.some((session) => session.id === action.id && session.unread)) return state;
  if (action.type === 'preferences')
    return { ...state, preferences: { ...state.preferences, ...action.value } };
  if (action.type === 'newDraft')
    return { ...state, newDraft: { ...state.newDraft, ...action.value } };
  if (action.type === 'rememberWorkspace')
    return { ...state, recentWorkspaces: rememberWorkspace(state.recentWorkspaces, action.value) };
  if (action.type === 'rememberModel')
    return { ...state, modelChoices: { ...state.modelChoices, [action.key]: action.value },
      ...(['Claude', 'Codex'].includes(action.key) ? { lastAgent: action.key as 'Claude' | 'Codex' } : {}),
    };
  if (action.type === 'rememberPermission')
    return { ...state, permissionChoices: { ...state.permissionChoices, [action.key]: action.value } };
  if (action.type === 'draft')
    return { ...state, drafts: { ...state.drafts, [action.id]: action.value } };
  if (action.type === 'create')
    return {
      ...state,
      sessions: [action.session, ...state.sessions],
      newDraft: { ...state.newDraft, prompt: '' },
      recentWorkspaces: rememberWorkspace(state.recentWorkspaces, {
        machineId: action.session.machineId, path: action.session.path, usedAt: action.session.createdAt,
      }),
      recentPaths: [
        action.session.path,
        ...state.recentPaths.filter((path) => path !== action.session.path),
      ].slice(0, 5),
    };
  if (action.type === 'delete') {
    const drafts = { ...state.drafts };
    delete drafts[action.id];
    return {
      ...state,
      drafts,
      sessions: state.sessions.filter((session) => session.id !== action.id),
    };
  }
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== action.id) return session;
      switch (action.type) {
        case 'rename':
          return { ...session, customTitle: action.name.trim() || undefined };
        case 'archive':
          return {
            ...session,
            archived: !session.archived,
            status: session.status === 'running' ? 'idle' : session.status,
          };
        case 'stop':
          return { ...session, status: 'idle' };
        case 'read':
          return session.unread ? { ...session, unread: false } : session;
        case 'send':
          return {
            ...session,
            status: 'running',
            updatedAt: action.now,
            messages: [...session.messages, action.message],
          };
        case 'reply':
          return session.status !== 'running'
            ? session
            : {
                ...session,
                // Another simulated reply can still be on its way.
                status: action.keepRunning ? 'running' : 'idle',
                updatedAt: action.now,
                messages: [...session.messages, action.message],
              };
      }
      return session;
    }),
    drafts: action.type === 'send' && !action.preserveDraft
      ? { ...state.drafts, [action.id]: '' }
      : state.drafts,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validSession(value: unknown): value is Session {
  if (!record(value)) return false;
  if (
    !['id', 'title', 'workspace', 'project', 'path', 'branch', 'machineId', 'model'].every(
      (key) => typeof value[key] === 'string',
    )
  )
    return false;
  if (
    !['createdAt', 'updatedAt', 'additions', 'deletions'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  )
    return false;
  if (
    !['Claude', 'Codex', 'Happy Agent'].includes(String(value.agent)) ||
    !['idle', 'running', 'blocked', 'offline'].includes(String(value.status))
  )
    return false;
  if (
    typeof value.unread !== 'boolean' ||
    typeof value.archived !== 'boolean' ||
    (value.customTitle !== undefined && typeof value.customTitle !== 'string')
  )
    return false;
  return (
    Array.isArray(value.messages) &&
    value.messages.every(
      (message) =>
        record(message) &&
        typeof message.id === 'string' &&
        ['user', 'assistant'].includes(String(message.role)) &&
        typeof message.content === 'string' &&
        (message.duration === undefined || typeof message.duration === 'string') &&
        (message.tools === undefined ||
          (Array.isArray(message.tools) &&
            message.tools.every((tool) => typeof tool === 'string'))) &&
        (message.attachments === undefined ||
          (Array.isArray(message.attachments) &&
            message.attachments.every(
              (file) =>
                record(file) &&
                typeof file.name === 'string' &&
                typeof file.size === 'number' &&
                typeof file.type === 'string',
            ))),
    )
  );
}

export function restoreState(raw: string | null, fallback: DemoState): DemoState {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      !record(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.sessions) ||
      !parsed.sessions.every(validSession)
    )
      return fallback;
    const preferences = { ...defaultPreferences };
    if (record(parsed.preferences)) {
      if (
        ['rayno', 'gray', 'blue', 'green', 'purple', 'rose', 'sand'].includes(
          String(parsed.preferences.bubble),
        )
      )
        preferences.bubble = parsed.preferences.bubble as typeof preferences.bubble;
      for (const key of ['compactTools', 'enterToSend', 'recapAutoplay'] as const)
        if (typeof parsed.preferences[key] === 'boolean')
          preferences[key] = parsed.preferences[key];
      if (parsed.preferences.avatar === 'provider' || parsed.preferences.avatar === 'initials')
        preferences.avatar = parsed.preferences.avatar;
      if (parsed.preferences.recap === 'auto' || parsed.preferences.recap === 'manual')
        preferences.recap = parsed.preferences.recap;
      if (typeof parsed.preferences.recapStyle === 'string')
        preferences.recapStyle = PREVIOUS_RECAP_STYLES.includes(parsed.preferences.recapStyle)
          ? defaultPreferences.recapStyle
          : parsed.preferences.recapStyle.slice(0, RECAP_STYLE_LIMIT);
      if (['small', 'medium', 'large'].includes(String(parsed.preferences.fontSize)))
        preferences.fontSize = parsed.preferences.fontSize as typeof preferences.fontSize;
      if (['full', 'medium', 'standard'].includes(String(parsed.preferences.chatWidth)))
        preferences.chatWidth = parsed.preferences.chatWidth as typeof preferences.chatWidth;
    }
    const drafts = record(parsed.drafts)
      ? (Object.fromEntries(
          Object.entries(parsed.drafts).filter(([, value]) => typeof value === 'string'),
        ) as Record<string, string>)
      : {};
    const draft = { ...defaultNewDraft };
    if (record(parsed.newDraft)) {
      for (const key of ['machineId', 'path', 'worktree', 'model', 'prompt', 'permissionMode'] as const)
        if (typeof parsed.newDraft[key] === 'string') draft[key] = parsed.newDraft[key];
      if (parsed.newDraft.effort === null || typeof parsed.newDraft.effort === 'string')
        draft.effort = parsed.newDraft.effort;
      if (['Claude', 'Codex', 'Happy Agent'].includes(String(parsed.newDraft.agent)))
        draft.agent = parsed.newDraft.agent as typeof draft.agent;
      if (parsed.newDraft.type === 'Simple' || parsed.newDraft.type === 'Worktree')
        draft.type = parsed.newDraft.type;
    }
    draft.permissionMode = resolveNewSessionPermission({ flavor: draft.agent.toLowerCase() }, [draft.permissionMode]);
    return {
      version: 1,
      sessions: parsed.sessions.map((session) => ({
        ...session,
        status: session.status === 'running' ? 'idle' : session.status,
      })),
      preferences,
      drafts,
      newDraft: draft,
      lastAgent: parsed.lastAgent === 'Claude' || parsed.lastAgent === 'Codex' ? parsed.lastAgent : undefined,
      modelChoices: record(parsed.modelChoices) ? Object.fromEntries(Object.entries(parsed.modelChoices).flatMap(([key, value]) =>
        record(value) && typeof value.model === 'string' && (typeof value.effort === 'string' || value.effort === null)
          ? [[key, { model: value.model, effort: value.effort }]] : [],
      )) : {},
      permissionChoices: record(parsed.permissionChoices) ? Object.fromEntries(Object.entries(parsed.permissionChoices)
        .filter(([, value]) => typeof value === 'string' && value.trim())) as Record<string, string> : {},
      recentWorkspaces: Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces.filter((item) =>
        record(item) && typeof item.machineId === 'string' && typeof item.path === 'string' &&
        typeof item.usedAt === 'number' && Number.isFinite(item.usedAt),
      ).slice(0, 30) : [],
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.filter((path): path is string => typeof path === 'string').slice(0, 5)
        : [],
    };
  } catch {
    return fallback;
  }
}
