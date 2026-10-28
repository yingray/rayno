import type { MarkdownAppearancePreferences } from './markdownAppearance';

export type Agent = 'Claude' | 'Codex' | 'Happy Agent';
export type Status = 'idle' | 'running' | 'blocked' | 'offline';
export type Attachment = { name: string; size: number; type: string; file?: File; ref?: string };
// A permission reply to a tool call, from the tool result or the completed agent-state request.
export type ToolPermission = {
  status: 'approved' | 'denied' | 'canceled'; mode?: string; allowedTools?: string[]; decision?: string; reason?: string;
};
// resultText is the tool result text that the agent got, when the result itself is a structured value.
// tool is the tool name when name shows a session tool call title.
// children: the work of a subagent that this call started, in order. `ended` marks a call that has its result record.
export type ToolCall = {
  id: string; name: string; tool?: string; input?: unknown; result?: unknown; resultText?: string; isError?: boolean; ended?: boolean;
  permission?: ToolPermission; children?: Message[];
  startedAt?: number; endedAt?: number;
};
// Happy Web sync/storageTypes.ts TodoItemSchema.
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'high' | 'medium' | 'low'; id?: string };
export type MessageSettings = { model?: string; effort?: string | null; permissionMode?: string };
export type RecapMode = 'auto' | 'manual';
export type Message = {
  unplaced?: boolean;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // Model reasoning. It is not reply text: options, recaps, and attention ignore it.
  thinking?: string;
  tools?: string[];
  toolCalls?: ToolCall[];
  toolResults?: {
    id: string; result: unknown; resultText?: string; isError?: boolean; hideUnmatched?: boolean; permission?: ToolPermission; endedAt?: number;
  }[];
  duration?: string;
  attachments?: Attachment[];
  // Modes that a user message carried in its meta.
  settings?: MessageSettings;
  // Server timestamp in milliseconds; demo replies use their simulated creation time.
  sentAt?: number;
  // A hidden user message that asks the agent to recap its previous reply.
  recapRequest?: boolean;
  // The agent's own plan-mode tool call, its call id, and the server time of its message.
  planMode?: { active: boolean; call: string; at: number };
  // Happy Agent send state of a user message. An accepted message has none.
  delivery?: { status: 'pending'; queued: boolean; since: number } | { status: 'rejected'; reason: string };
  // A hidden agent event that starts a new context. It clears the todo list.
  contextReset?: boolean;
  // A compact agent event row, such as a switch to local mode. It has no content, so it is not reply text.
  event?: AgentEvent;
};
// The agent events that Happy Web shows (`sync/typesRaw.ts` agentEventSchema, `components/MessageView.tsx` AgentEventBlock).
// `endsAt` is in Unix seconds.
export type AgentEvent =
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number };
// Tokens in the agent's context after its latest reply, and the model's window when the CLI reports it.
export type ContextUsage = { size: number; window?: number };
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
  // A side chat is a hidden fork that the parent chat shows. Normal forks also carry a parent.
  isSideChat?: boolean;
  parentSessionId?: string;
  // Only a user close (lifecycleState 'archived') closes a side chat. An ended side chat stays open in its parent.
  sideChatClosed?: boolean;
  additions: number;
  deletions: number;
  gitReported?: boolean;
  context?: ContextUsage;
  // The main todo list, when the client knows subagent bounds beyond the loaded messages.
  todos?: Todo[];
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
export type UsageWindow = {
  usedPercent: number;
  pacePercent: number | null;
  reset: string;
  resetAt?: number | null;
};
// The plan windows that the agent reports: the weekly window, the 5-hour window, or both.
export type UsageReading = ({ week: UsageWindow; fiveHour?: UsageWindow } | { week?: undefined; fiveHour: UsageWindow }) & {
  agent: Agent;
  capturedAt?: number;
  stale?: boolean;
  machineId?: string;
  machineName?: string;
};
export type BubbleColor = 'rayno' | 'gray' | 'blue' | 'green' | 'purple' | 'rose' | 'sand';
export type FontSize = 'small' | 'medium' | 'large';
export type AvatarStyle = 'provider' | 'initials' | 'planets';
export type GlassStyle = 'standard' | 'intense';
export type ChatWidth = 'full' | 'medium' | 'standard';
export type SessionListMode = 'flat' | 'projects';
export type Preferences = MarkdownAppearancePreferences & {
  language: 'en' | 'zh-TW';
  alwaysShowContextSize: boolean;
  customCodexModel: string;
  bubble: BubbleColor;
  fontSize: FontSize;
  chatWidth: ChatWidth;
  sessionListMode: SessionListMode;
  sessionListArchived: boolean;
  glassStyle: GlassStyle;
  compactTools: boolean;
  fasterTranscript: boolean;
  enterToSend: boolean;
  avatar: AvatarStyle;
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
  // A handoff sends its context before the task text, so the task field stays free for the user.
  handoff?: HandoffContext | null;
};
export type HandoffContext = { sessionId: string; title: string; prompt: string };
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
  | { type: 'demoActivity'; id: string; now: number; status: Status; messages: Message[] }
  | { type: 'create'; session: Session }
  | { type: 'rename'; id: string; name: string }
  | { type: 'archive'; id: string }
  | { type: 'delete' | 'stop' | 'read'; id: string }
  | { type: 'send' | 'reply'; id: string; message: Message; now: number; preserveDraft?: boolean; keepRunning?: boolean }
  | { type: 'draft'; id: string; value: string }
  | { type: 'draftOption'; id: string; key: string; messageId: string; text: string }
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
