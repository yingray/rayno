export type Agent = 'Claude' | 'Codex' | 'Happy Agent';
export type Status = 'idle' | 'running' | 'blocked' | 'offline';
export type Attachment = { name: string; size: number; type: string };
export type MessageSettings = { model?: string; effort?: string | null; permissionMode?: string };
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  duration?: string;
  attachments?: Attachment[];
};
export type Session = {
  id: string;
  title: string;
  customTitle?: string;
  workspace: string;
  project: string;
  path: string;
  branch: string;
  machineId: string;
  agent: Agent;
  model: string;
  effort?: string | null;
  status: Status;
  unread: boolean;
  needsReply?: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;
  machineOffline?: boolean;
  isSideChat?: boolean;
  additions: number;
  deletions: number;
  gitReported?: boolean;
  messages: Message[];
};
export type Machine = {
  id: string;
  name: string;
  online: boolean;
  os: string;
  battery: number | null;
  charging: boolean | null;
  network: string;
  ssid: string;
  ip: string;
  latency: number | null;
  capturedAt?: number;
  error?: string;
  homeDir?: string;
};
export type UsageReading = {
  agent: Agent;
  usedPercent: number;
  pacePercent: number | null;
  reset: string;
  resetAt?: number | null;
  capturedAt?: number;
  stale?: boolean;
  machineId?: string;
  machineName?: string;
};
export type BubbleColor = 'rayno' | 'gray' | 'blue' | 'green' | 'purple' | 'rose' | 'sand';
export type FontSize = 'small' | 'medium' | 'large';
export type Preferences = {
  bubble: BubbleColor;
  fontSize: FontSize;
  compactTools: boolean;
  showUsage: boolean;
  enterToSend: boolean;
  avatar: 'provider' | 'initials';
};
export type NewSessionDraft = {
  machineId: string;
  path: string;
  worktree: string;
  model: string;
  effort?: string | null;
  permissionMode: string;
  agent: Agent;
  type: 'Simple' | 'Worktree';
  prompt: string;
};
export type RecentWorkspace = { machineId: string; path: string; usedAt: number };
export type ModelChoice = { model: string; effort: string | null };
export type DemoState = {
  version: 1;
  sessions: Session[];
  preferences: Preferences;
  drafts: Record<string, string>;
  newDraft: NewSessionDraft;
  recentPaths: string[];
  recentWorkspaces?: RecentWorkspace[];
  modelChoices?: Record<string, ModelChoice>;
  permissionChoices?: Record<string, string>;
  lastAgent?: 'Claude' | 'Codex';
};
export type Action =
  | { type: 'create'; session: Session }
  | { type: 'rename'; id: string; name: string }
  | { type: 'archive'; id: string }
  | { type: 'delete' | 'stop' | 'read'; id: string }
  | { type: 'send' | 'reply'; id: string; message: Message; now: number; preserveDraft?: boolean }
  | { type: 'draft'; id: string; value: string }
  | { type: 'newDraft'; value: Partial<NewSessionDraft> }
  | { type: 'rememberWorkspace'; value: RecentWorkspace }
  | { type: 'rememberModel'; key: string; value: ModelChoice }
  | { type: 'rememberPermission'; key: string; value: string }
  | { type: 'preferences'; value: Partial<Preferences> }
  | { type: 'reset'; state: DemoState };

// This contract represents UI operations, not the Happy network protocol.
export interface DemoAdapter {
  createSession(draft: NewSessionDraft, attachments?: Attachment[]): Promise<string>;
  renameSession(id: string, name: string): void | Promise<void>;
  archiveSession(id: string): void | Promise<void>;
  deleteSession(id: string): void | Promise<void>;
  sendMessage(
    id: string,
    content: string,
    attachments?: Attachment[],
    options?: MessageSettings & { preserveDraft?: boolean },
  ): void | Promise<void>;
  stopSession(id: string): void | Promise<void>;
  refreshMonitor(): Promise<void>;
  killSession?(id: string): Promise<void>;
}
