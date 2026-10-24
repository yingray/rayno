import type { NewSessionDraft, Preferences } from './types';
import { DEFAULT_RECAP_STYLE } from '../happy/systemPrompt';

export const defaultNewDraft: NewSessionDraft = {
  machineId: 'mbp',
  path: '~/Developer/happy',
  worktree: 'main',
  model: 'claude-opus-5',
  effort: 'high',
  permissionMode: 'bypassPermissions',
  agent: 'Claude',
  type: 'Simple',
  prompt: '',
};
export const defaultPreferences: Preferences = {
  language: 'en',
  alwaysShowContextSize: false,
  customCodexModel: '',
  bubble: 'rayno',
  fontSize: 'medium',
  chatWidth: 'medium',
  glassStyle: 'standard',
  compactTools: false,
  fasterTranscript: false,
  enterToSend: true,
  avatar: 'provider',
  recap: 'auto',
  recapStyle: DEFAULT_RECAP_STYLE,
  recapAutoplay: false,
};
