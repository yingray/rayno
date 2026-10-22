export type Agent = 'Claude' | 'Codex' | 'Happy Agent';
export type Status = 'idle' | 'running' | 'blocked' | 'offline';
export type Attachment = { name: string; size: number; type: string; file?: File; ref?: string };
export type ToolCall = { id: string; name: string; input?: unknown; result?: unknown; isError?: boolean };
export type MessageSettings = { model?: string; effort?: string | null; permissionMode?: string };
export type RecapMode = 'auto' | 'manual';
export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  toolCalls?: ToolCall[];
  toolResults?: { id: string; result: unknown; isError?: boolean; hideUnmatched?: boolean }[];
  duration?: string;
  attachments?: Attachment[];
  // Modes that a user message carried in its meta, and the server time of that message.
  settings?: MessageSettings;
  sentAt?: number;
  // A hidden user message that asks the agent to recap its previous reply.
  recapRequest?: boolean;
  // The agent's own plan-mode tool call, its call id, and the server time of its message.
  planMode?: { active: boolean; call: string; at: number };
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
  // The connected CLI runs in local mode, so its terminal controls the session.
  terminalControl?: boolean;
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
  cliVersion?: string;
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
export type ChatWidth = 'full' | 'medium' | 'standard';
export type Preferences = {
  bubble: BubbleColor;
  fontSize: FontSize;
  chatWidth: ChatWidth;
  compactTools: boolean;
  enterToSend: boolean;
  avatar: 'provider' | 'initials';
  recap: RecapMode;
  recapStyle: string;
  recapAutoplay: boolean;
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
  | { type: 'send' | 'reply'; id: string; message: Message; now: number; preserveDraft?: boolean; keepRunning?: boolean }
  | { type: 'draft'; id: string; value: string }
  | { type: 'newDraft'; value: Partial<NewSessionDraft> }
  | { type: 'rememberWorkspace'; value: RecentWorkspace }
  | { type: 'rememberModel'; key: string; value: ModelChoice }
  | { type: 'rememberPermission'; key: string; value: string }
  | { type: 'preferences'; value: Partial<Preferences> }
  | { type: 'reset'; state: DemoState };

// This contract represents UI operations, not the Happy network protocol.
export interface DemoAdapter {
  // Rejects with DirectoryApprovalError (happy/errors.ts) until the user approves a missing folder.
  createSession(draft: NewSessionDraft, attachments?: Attachment[], options?: { approvedNewDirectoryCreation?: boolean }): Promise<string>;
  renameSession(id: string, name: string): void | Promise<void>;
  archiveSession(id: string): void | Promise<void>;
  deleteSession(id: string): void | Promise<void>;
  sendMessage(
    id: string,
    content: string,
    attachments?: Attachment[],
    options?: MessageSettings & { preserveDraft?: boolean },
  ): void | Promise<void>;
  // Send the hidden manual recap request for the last agent reply.
  sendRecapRequest(id: string, options?: MessageSettings): void | Promise<void>;
  stopSession(id: string): void | Promise<void>;
  refreshMonitor(): Promise<void>;
  killSession?(id: string): Promise<void>;
  // Move control of a local-mode CLI session from its terminal to the remote clients.
  takeControl?(id: string): Promise<void>;
}
