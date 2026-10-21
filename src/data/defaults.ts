import type { NewSessionDraft, Preferences } from './types';

export const defaultNewDraft: NewSessionDraft = {
  machineId: 'mbp',
  path: '~/Developer/happy',
  worktree: 'main',
  model: 'claude-opus-5',
  effort: 'high',
  permissionMode: 'auto',
  agent: 'Claude',
  type: 'Simple',
  prompt: '',
};
export const defaultPreferences: Preferences = {
  bubble: 'rayno',
  fontSize: 'medium',
  compactTools: false,
  showUsage: true,
  enterToSend: true,
  avatar: 'provider',
};
