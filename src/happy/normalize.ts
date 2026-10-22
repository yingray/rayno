import type { Agent, Machine, Message, MessageSettings, RecapMode, Session, ToolCall, UsageReading, UsageWindow, ContextUsage } from '../data/types';
import { compareVersionsWithPrerelease, isWellFormedVersion } from './versionUtils';
import { stripLeadingTaskNotificationWrappers } from './controlMessages';
import { RECAP_REQUEST, recapPrompt, systemPrompt } from './systemPrompt';
import { resultPermission } from './toolDecisions';
import { SIDE_CHAT_TITLE } from '../data/sideChats';

// These records are protocol boundaries. Keep unknown metadata fields for CAS updates.
export type Json = Record<string, any>;
export type SessionRecord = {
  wire: Json;
  key: Uint8Array | null;
  metadata: Json;
  agentState: Json;
  thinking?: boolean;
};
export type MachineRecord = { wire: Json; key: Uint8Array | null; metadata: Json };
export type MessageRecord = {
  id: string;
  seq: number;
  localId?: string;
  createdAt: number;
  raw: Json;
};
export type History = {
  loading: boolean; hasMore: boolean; error: string; loaded: boolean;
  direction?: 'initial' | 'older' | 'forward';
};
export type Permission = { id: string; tool: string; arguments: unknown };
export const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
export const agentName = (value: unknown): Agent =>
  value === 'codex' ? 'Codex' : value === 'claude' || !value ? 'Claude' : 'Happy Agent';
export const isRig = (metadata: Json) => metadata.client?.id === 'rig' || metadata.flavor === 'rig';
// V1 places ended CLI sessions in the archive, even without a lifecycle marker.
// A disconnected Rig session remains visible until it is explicitly archived.
export const isSessionArchived = ({ wire, metadata }: SessionRecord) =>
  metadata.lifecycleState === 'archived' || (!isRig(metadata) && !wire.active);
// The Claude CLI sets controlledByUser while it runs in local mode, in the terminal. Rig sessions have no terminal mode.
export const terminalControls = (metadata: Json, agentState: Json) =>
  !isRig(metadata) && agentState.controlledByUser === true;
// A handoff in either direction, as in Happy Web sync/controlHandoff.ts. A missing previous value counts as app control.
export function controlHandoff(previous: unknown, next: unknown): 'terminal' | 'app' | null {
  if (next === true && previous !== true) return 'terminal';
  return previous === true && next === false ? 'app' : null;
}
export function currentModel(metadata: Json): string {
  const mode = record(metadata.draft || metadata.lastMode);
  const provider = mode.providerId || metadata.currentModelProviderId || metadata.model?.providerId;
  const model =
    mode.modelId || metadata.currentModelCode || metadata.model?.id || metadata.modelMode;
  return typeof model === 'string'
    ? isRig(metadata) && provider
      ? `${provider}:${model}`
      : model
    : 'Agent default';
}
export function currentPermission(metadata: Json): string | undefined {
  const mode = record(metadata.draft || metadata.lastMode);
  return [mode.permissionMode, metadata.permissionMode, metadata.currentOperatingModeCode,
    metadata.session?.permissionMode].find((value): value is string => typeof value === 'string' && !!value.trim());
}
export function messageMeta(
  metadata: Json,
  options: MessageSettings,
  recapMode: RecapMode = 'auto',
  recapStyle?: string,
): Json {
  const mode = record(metadata.draft || metadata.lastMode);
  const meta: Json = { sentFrom: 'web', appendSystemPrompt: systemPrompt + '\n\n' + recapPrompt(recapMode, recapStyle) };
  const permission = options.permissionMode || currentPermission(metadata);
  if (!isRig(metadata) && permission === 'dontAsk')
    throw new Error(
      'This saved permission mode is retired. Choose a permission mode before you send.',
    );
  if (
    !isRig(metadata) &&
    permission === 'auto' &&
    metadata.version &&
    (!isWellFormedVersion(metadata.version) ||
      compareVersionsWithPrerelease(metadata.version, '1.2.1-beta.2') < 0)
  )
    throw new Error(
      'This Happy CLI does not support auto mode. Choose a permission mode before you send.',
    );
  if (permission) meta.permissionMode = permission;
  const model = options.model || currentModel(metadata);
  if (model && model !== 'Agent default') {
    if (isRig(metadata) && model.includes(':')) {
      const index = model.indexOf(':');
      meta.modelProviderId = model.slice(0, index);
      meta.model = model.slice(index + 1);
    } else meta.model = model === 'default' ? null : model;
  }
  const effort = options.effort !== undefined ? options.effort : currentEffort(metadata);
  if (effort !== undefined) meta.effort = effort;
  if ('serviceTier' in mode) meta.serviceTier = mode.serviceTier;
  if (isRig(metadata) && options.model && options.model !== currentModel(metadata)) meta.serviceTier = null;
  return meta;
}
export function currentEffort(metadata: Json): string | null | undefined {
  const mode = record(metadata.draft || metadata.lastMode);
  if (mode.effort !== undefined) return mode.effort;
  if (metadata.effortLevel !== undefined) return metadata.effortLevel;
  return metadata.reasoning?.current ?? metadata.currentThoughtLevelCode;
}

export function pendingPermissions(state: Json): Permission[] {
  return Object.entries(record(state.requests))
    .filter(([id]) => !record(state.completedRequests)[id])
    .map(([id, request]) => ({
      id,
      tool: text(record(request).tool, 'Tool request'),
      arguments: record(request).arguments,
    }));
}
// Happy Web PermissionFooter.tsx offers no session-wide approval for edit tools and plan exits.
const noSessionScope = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'ExitPlanMode', 'exit_plan_mode']);
export function allowsSessionScope(tool: string): boolean {
  return !noSessionScope.has(tool);
}
export const isExitPlanTool = (tool: string) => tool === 'ExitPlanMode' || tool === 'exit_plan_mode';
// Happy Web utils/worktreePaths.ts: the path marker of a Happy-created git worktree.
export const WORKTREE_MARKER = '/.dev/worktree/';
// Happy Web sync/agentCommunications.ts: only `form` is answerable. Other kinds stay visible so the user can dismiss them.
export type PendingCommunication = { id: string; createdAt: number } & (
  | { kind: 'form'; questions: Json[] }
  | { kind: 'unsupported'; rawKind: string; title: string | null });
export function pendingCommunications(state: Json): PendingCommunication[] {
  const completed = record(state.completedCommunications);
  return Object.entries(record(state.communications)).flatMap(([id, value]): PendingCommunication[] => {
    const communication = record(value);
    if (completed[id]) return [];
    const createdAt = typeof communication.createdAt === 'number' ? communication.createdAt : 0;
    if (communication.kind !== 'form')
      return [{ id, createdAt, kind: 'unsupported', rawKind: text(communication.kind, 'unknown'), title: text(communication.title) || null }];
    // A question is answerable when it offers options or accepts written text. A form without one has nothing to show.
    const questions = (Array.isArray(communication.form?.questions) ? communication.form.questions : [])
      .map((question: unknown) => record(question))
      .filter((question: Json) => typeof question.id === 'string')
      .map((question: Json) => ({ ...question, options: Array.isArray(question.options) ? question.options : [] }))
      .filter((question: Json) => question.options.length > 0 || question.allowCustom !== false);
    return questions.length ? [{ id, createdAt, kind: 'form', questions }] : [];
  }).sort((a, b) => a.createdAt - b.createdAt);
}
// Happy Web sync/rig.ts rigSendsMessageReceipts: strict, because a held message waits for a receipt.
export const sendsMessageReceipts = (metadata: Json) =>
  metadata.client?.id === 'rig' && (metadata.rigMetadataVersion ?? 0) >= 1 && metadata.capabilities?.messageReceipts === true;
// Happy Web sync/messageMeta.ts resolveMessageDeliveryMeta. A pending question does not hold a new message.
export function deliveryMeta(metadata: Json, state: Json, thinking: boolean, hasPendingMessage: boolean): Json {
  if (!sendsMessageReceipts(metadata)) return {};
  const busy = Object.keys(record(state.requests)).length > 0 || (!pendingCommunications(state).length && thinking);
  return { expectsAcceptance: true, queuedWhileBusy: hasPendingMessage || busy };
}
// A `user-message-accepted` or `user-message-rejected` receipt. `ref` is the server ID of the user message.
export function messageReceipt(raw: Json): { ref: string; reason?: string } | null {
  const content = record(raw.content);
  const envelope = raw.role === 'session' ? record(content.type === 'session' ? content.data : content)
    : content.type === 'session' ? record(content.data) : null;
  const event = envelope ? record(envelope.ev) : raw.role === 'agent' && content.type === 'event' ? record(content.data) : {};
  const type = envelope ? event.t : event.type;
  if (typeof event.ref !== 'string' || (type !== 'user-message-accepted' && type !== 'user-message-rejected')) return null;
  return type === 'user-message-rejected' ? { ref: event.ref, reason: text(event.reason) } : { ref: event.ref };
}
export function normalizeSession(
  source: SessionRecord,
  messages: Message[],
  unread = false,
  machine?: MachineRecord,
  optionsPending = false,
  lastSentAt?: number,
): Session {
  const { wire, metadata: m, agentState: a } = source;
  const path = text(m.path);
  const worktreeIndex = path.indexOf(WORKTREE_MARKER);
  const projectPath = worktreeIndex < 0 ? path : path.slice(0, worktreeIndex);
  const project = text(m.project?.name, projectPath.split(/[\\/]/).filter(Boolean).pop());
  const workspace = text(
    m.workspace?.name,
    worktreeIndex < 0 ? '' : path.slice(worktreeIndex + WORKTREE_MARKER.length),
  );
  const pending = pendingPermissions(a).length || pendingCommunications(a).length;
  return {
    id: wire.id,
    title: text(m.summary?.text, m.isSideChat === true ? SIDE_CHAT_TITLE : path.split('/').filter(Boolean).pop() || 'Untitled session'),
    customTitle: m.name || undefined,
    workspace: m.bot?.id
      ? `@${text(m.bot.username)}`
      : workspace.trim() ||
        project.trim() ||
        text(machine?.metadata.displayName || machine?.metadata.host || m.host, 'Workspace'),
    project: project || 'Your sessions',
    path,
    branch: text(m.gitBranch || m.git?.branch || m.branch, '—'),
    machineId: text(m.machineId),
    agent: isRig(m) ? 'Happy Agent' : agentName(m.flavor),
    model: currentModel(m),
    effort: currentEffort(m),
    status: !wire.active
      ? 'offline'
      : pending
        ? 'blocked'
        : (source.thinking ?? a.thinking)
          ? 'running'
          : 'idle',
    unread,
    needsReply: !!pending || optionsPending,
    archived: isSessionArchived(source),
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    // Happy Web utils/sessionActivity.ts: an older CLI omits the agent time, so use this device's last send.
    lastActivityAt: m.lastMeaningfulMessageAt ?? lastSentAt ?? wire.createdAt,
    machineOffline: machine ? !machine.wire.active : false,
    terminalControl: !!wire.active && terminalControls(m, a),
    isSideChat: m.isSideChat === true,
    sideChatClosed: m.isSideChat === true && m.lifecycleState === 'archived',
    parentSessionId: typeof m.parentSessionId === 'string' && m.parentSessionId ? m.parentSessionId : undefined,
    additions: typeof m.git?.insertions === 'number' ? m.git.insertions : 0,
    deletions: typeof m.git?.deletions === 'number' ? m.git.deletions : 0,
    gitReported: !!m.git,
    messages,
  };
}
export function normalizeMachine(
  { wire, metadata: m }: MachineRecord,
  previous?: Machine,
): Machine {
  return {
    id: wire.id,
    name: text(m.displayName || m.host, 'Computer'),
    online: !!wire.active,
    os: text(m.platform, 'Unknown OS'),
    battery: previous?.battery ?? null,
    charging: previous?.charging ?? null,
    network: previous?.network || 'Not read',
    ssid: previous?.ssid || '',
    ip: previous?.ip || '',
    latency: previous?.latency ?? null,
    capturedAt: previous?.capturedAt,
    error: previous?.error,
    homeDir: m.homeDir,
    cliVersion: typeof m.happyCliVersion === 'string' ? m.happyCliVersion : undefined,
  };
}
// Some agents report their modes only through the meta of the last user message.
function sentSettings(meta: Json): MessageSettings | undefined {
  const settings: MessageSettings = {};
  if (typeof meta.model === 'string' && meta.model)
    settings.model = typeof meta.modelProviderId === 'string' && meta.modelProviderId
      ? `${meta.modelProviderId}:${meta.model}` : meta.model;
  if (typeof meta.effort === 'string' || meta.effort === null) settings.effort = meta.effort;
  if (typeof meta.permissionMode === 'string' && meta.permissionMode) settings.permissionMode = meta.permissionMode;
  return Object.keys(settings).length ? settings : undefined;
}
// The text of a Claude tool_result: a string, or the text blocks of a block list.
const resultText = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') || undefined
  : undefined;
// Tool calls that move a Claude agent into (true) or out of (false) plan mode, as in Happy sync/messagePlanMode.ts.
const planTools = new Map([['EnterPlanMode', true], ['enter_plan_mode', true], ['ExitPlanMode', false], ['exit_plan_mode', false]]);
// The session envelope of a record, in the new `role: 'session'` shape or the older wrapped shape.
function sessionEnvelope(raw: Json): Json | null {
  const content = record(raw.content);
  if (content.type === 'session') return record(content.data);
  return raw.role === 'session' ? content : null;
}
// V1 hides these known tools (`components/tools/knownTools.tsx`). Their text arrives as thinking or as the call result.
const reasoningTools = new Set(['CodexReasoning', 'GeminiReasoning', 'think']);
// The id of a hidden reasoning call that a row starts.
function reasoningCall(raw: Json): string | undefined {
  const event = record(sessionEnvelope(raw)?.ev), content = record(raw.content), data = record(content.data);
  if (event.t === 'tool-call-start') return reasoningTools.has(event.name) ? text(event.call) : undefined;
  if (raw.role === 'agent' && (content.type === 'codex' || content.type === 'acp') && data.type === 'tool-call')
    return reasoningTools.has(data.name) ? text(data.callId) : undefined;
}
const normalizedMessages = new WeakMap<MessageRecord, Message | null>();
// ACP thinking records are stream chunks. The chat joins neighbors without a break.
const thinkingChunks = new WeakSet<Message>();
export function normalizeMessage(row: MessageRecord): Message | null {
  if (normalizedMessages.has(row)) return normalizedMessages.get(row)!;
  const raw = record(row.raw),
    content = record(raw.content);
  // V1 skips Claude meta prompts and compact summaries. Sidechain records belong to their parent tool, not the main thread.
  // Session envelopes with a `subagent` id are split in visibleMessages, because the CLI also tags main replies with it.
  const output = raw.role === 'agent' && content.type === 'output' ? record(content.data) : null;
  const envelope = sessionEnvelope(raw);
  const event = record(envelope?.ev);
  // V1 drops agent envelopes without a turn, except usage-only service events and send receipts. Neither has content here.
  const turnless = envelope?.role === 'agent' && !envelope.turn
    && !(event.t === 'service' && !text(event.text).trim() && envelope.usage)
    && event.t !== 'user-message-accepted' && event.t !== 'user-message-rejected';
  if (output?.isMeta || output?.isCompactSummary || output?.isSidechain || turnless) {
    normalizedMessages.set(row, null);
    return null;
  }
  const hidden = reasoningCall(raw) !== undefined;
  const message: Message = {
    id: row.id,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: '',
  };
  if (raw.role === 'user' && content.type === 'text') {
    message.content = text(raw.meta?.displayText || content.text);
    // Old clients and other apps can send the request text without the Rayno meta.
    if (raw.meta?.raynoRecap === true || text(content.text).trim() === RECAP_REQUEST) message.recapRequest = true;
    const settings = sentSettings(record(raw.meta));
    if (settings) {
      message.settings = settings;
      message.sentAt = row.createdAt;
    }
  }
  if (envelope) {
    message.role = envelope.role === 'user' ? 'user' : 'assistant';
    if (event.t === 'text' && !event.thinking) message.content = text(event.text);
    if (event.t === 'text' && event.thinking && message.role === 'assistant') message.thinking = text(event.text);
    if (event.t === 'service' && message.role === 'assistant') message.content = text(event.text);
    if (message.role === 'user' && event.t === 'text' && text(event.text).trim() === RECAP_REQUEST) message.recapRequest = true;
    if (event.t === 'tool-call-start' && !hidden)
      message.tools = [text(event.title || event.name, 'Tool call')];
    if (event.t === 'file')
      message.attachments = [
        { name: text(event.name, 'Attachment'), size: event.size || 0, type: text(event.mimeType), ...(typeof event.ref === 'string' ? { ref: event.ref } : {}) },
      ];
  } else if (raw.role === 'agent') {
    const data = record(content.data);
    if (content.type === 'output') {
      const chunks = data.type === 'assistant' ? data.message?.content : null;
      if (Array.isArray(chunks)) {
        message.content = chunks
          .filter((x) => x.type === 'text')
          .map((x) => text(x.text))
          .join('\n\n');
        message.thinking = chunks.filter((x) => x.type === 'thinking').map((x) => text(x.thinking)).join('\n\n');
        const tools = chunks
          .filter((x) => x.type === 'tool_use')
          .map((x) => text(x.name, 'Tool call'));
        if (tools.length) message.tools = tools;
      }
      if (data.type === 'user' && typeof data.message?.content === 'string') {
        message.role = 'user';
        message.content = data.message.content;
      }
      if (data.type === 'result' && data.is_error)
        message.content = text(data.result, 'The agent reported an error.');
    } else if (content.type === 'event') {
      // ApiSession.sendSessionEvent in happy-cli. Happy Web sync/reducer/reducer.ts clears the todos on this event.
      if (data.type === 'message' && data.message === 'Context was reset') message.contextReset = true;
    } else if (content.type === 'codex' || content.type === 'acp') {
      if (data.type === 'message') message.content = text(data.message);
      // V1 shows Codex and ACP reasoning as text. Rayno treats it as thinking, like ACP `thinking` records.
      if (data.type === 'reasoning') message.thinking = text(data.message);
      if (content.type === 'acp' && data.type === 'thinking') {
        message.thinking = text(data.text);
        thinkingChunks.add(message);
      }
      if (data.type === 'tool-call' && !hidden) message.tools = [text(data.name, 'Tool call')];
    }
  }
  const calls: ToolCall[] = [];
  const results: NonNullable<Message['toolResults']> = [];
  const addCall = (id: unknown, name: unknown, input: unknown, tool = name) => {
    // A session tool call shows its title. `tool` keeps the tool name for the permission and answer views.
    calls.push({ id: text(id, row.id), name: text(name, 'Tool call'), input,
      ...(typeof tool === 'string' && tool && tool !== name ? { tool } : {}) });
    const active = typeof tool === 'string' ? planTools.get(tool) : undefined;
    if (active !== undefined) message.planMode = { active, call: text(id, row.id), at: row.createdAt };
  };
  const addResult = (id: unknown, result: unknown, isError: unknown, resultText?: string, permissions?: unknown) => {
    const permission = resultPermission(permissions);
    results.push({ id: text(id), result, isError: isError === true,
      ...(resultText && resultText !== result ? { resultText } : {}), ...(permission ? { permission } : {}) });
  };
  if (envelope) {
    if (event.t === 'tool-call-start' && !hidden) addCall(event.call, event.title || event.name, event.args, event.name);
    // Like v1 typesRaw.ts, a tool-call-end without a result still ends the call. The Claude CLI sends no result.
    if (event.t === 'tool-call-end') addResult(event.call, event.result ?? null, event.isError);
  } else if (raw.role === 'agent') {
    const data = record(content.data);
    if (content.type === 'output') {
      const chunks = data.message?.content;
      // Like v1 typesRaw.ts, the stored toolUseResult (text or a structured value) replaces the text for the model.
      // The text stays as resultText for unknown structured values.
      const stored = data.toolUseResult ? data.toolUseResult : undefined;
      if (Array.isArray(chunks)) for (const chunk of chunks) {
        if (chunk.type === 'tool_use' || chunk.type === 'tool-call') addCall(chunk.callId || chunk.id, chunk.name, chunk.input);
        if (chunk.type === 'tool_result' || chunk.type === 'tool-call-result')
          addResult(chunk.tool_use_id || chunk.callId || chunk.toolCallId, stored ?? chunk.content ?? chunk.output, chunk.is_error,
            resultText(chunk.content), chunk.permissions);
      }
    } else if (content.type === 'codex' || content.type === 'acp') {
      if (data.type === 'tool-call' && !hidden) addCall(data.callId, data.name, data.input);
      if (data.type === 'tool-result' || data.type === 'tool-call-result') addResult(data.callId, data.output, data.isError);
      if (content.type === 'acp' && data.type === 'file-edit') addCall(data.id, 'file-edit', {
        filePath: data.filePath, description: data.description, diff: data.diff, oldContent: data.oldContent, newContent: data.newContent,
      });
      // Gemini sends a random call id, so V1 drops terminal output that matches no call.
      if (content.type === 'acp' && data.type === 'terminal-output') results.push({ id: text(data.callId), result: data.data, isError: false, hideUnmatched: true });
    }
  }
  if (calls.length) { message.toolCalls = calls; message.tools = calls.map(call => call.name); }
  if (results.length) message.toolResults = results;
  message.content = stripLeadingTaskNotificationWrappers(message.content);
  if (!message.thinking?.trim()) delete message.thinking;
  const result = message.content || message.thinking || message.tools?.length || message.toolResults?.length
    || message.attachments?.length || message.settings || message.contextReset ? message : null;
  normalizedMessages.set(row, result);
  return result;
}
// Subagent start and stop markers by session `seq` (true marks a start), and the title from the start.
export type SubagentMarks = Map<string, { title?: string; bounds: Map<number, boolean> }>;
export function markSubagents(marks: SubagentMarks, rows: Iterable<MessageRecord>): SubagentMarks {
  for (const row of rows) {
    const envelope = sessionEnvelope(record(row.raw)), event = record(envelope?.ev), id = envelope?.subagent;
    if (typeof id !== 'string' || !id || (event.t !== 'start' && event.t !== 'stop') || !Number.isSafeInteger(row.seq)) continue;
    let entry = marks.get(id);
    if (!entry) marks.set(id, entry = { bounds: new Map() });
    entry.bounds.set(row.seq, event.t === 'start');
    if (event.t === 'start' && text(event.title).trim()) entry.title = text(event.title).trim();
  }
  return marks;
}
// The plain JSON shape of subagent bounds for the encrypted offline cache: [seq, true for a start] pairs.
export type SavedSubagent = { id: string; title?: string; bounds: [number, boolean][] };
export function saveSubagentMarks(marks: SubagentMarks): SavedSubagent[] {
  return [...marks].map(([id, entry]) => ({ id, ...(entry.title ? { title: entry.title } : {}), bounds: [...entry.bounds] }));
}
// A damaged entry or bound is dropped. Without a bound, a row stays in the main thread.
export function restoreSubagentMarks(value: unknown, marks: SubagentMarks = new Map()): SubagentMarks {
  for (const item of Array.isArray(value) ? value : []) {
    const saved = record(item), id = saved.id;
    if (typeof id !== 'string' || !id || !Array.isArray(saved.bounds)) continue;
    const bounds = saved.bounds.filter((bound: unknown): bound is [number, boolean] => Array.isArray(bound) && bound.length === 2
      && Number.isSafeInteger(bound[0]) && bound[0] >= 0 && typeof bound[1] === 'boolean');
    if (!bounds.length) continue;
    let entry = marks.get(id);
    if (!entry) marks.set(id, entry = { bounds: new Map() });
    for (const [seq, start] of bounds) entry.bounds.set(seq, start);
    if (!entry.title && typeof saved.title === 'string' && saved.title.trim()) entry.title = saved.title.trim();
  }
  return marks;
}
// The subagent that a row belongs to. The Claude CLI mapper passes the subagent id on through `parentUuid`,
// so main rows after the subagent stops carry it too. A tagged row belongs to the subagent only between
// its start and its stop. When no bound is known, the row stays in the main thread.
export function subagentOf(row: MessageRecord, marks: SubagentMarks): string | undefined {
  const envelope = sessionEnvelope(record(row.raw)), id = envelope?.subagent;
  if (typeof id !== 'string' || !id) return undefined;
  const t = record(envelope!.ev).t;
  // Only a subagent reports service status (Codex collab state) with its id.
  if (t === 'start' || t === 'stop' || t === 'service') return id;
  const bounds = marks.get(id)?.bounds;
  let before: number | undefined, after: number | undefined;
  for (const seq of bounds?.keys() || []) {
    if (seq < row.seq && (before === undefined || seq > before)) before = seq;
    if (seq > row.seq && (after === undefined || seq < after)) after = seq;
  }
  return (before !== undefined ? bounds!.get(before) : after !== undefined && !bounds!.get(after)) ? id : undefined;
}
const shows = (message: Message) => !!(message.content.trim() || message.tools?.length || message.attachments?.length);
const onlyThinking = (message: Message) => message.role === 'assistant' && !!message.thinking && !shows(message)
  && !message.toolResults?.length && !message.settings;
// Happy Web sync/reducer/reducer.ts: a receipt puts its user message at the place where the agent took it.
// With `holdUntilAccepted`, a message that expects a receipt stays pending at the end until the receipt comes.
export function visibleMessages(rows: MessageRecord[], holdUntilAccepted = false): Message[] {
  const seen = new Set<string>();
  const sorted = [...rows]
    .sort((a, b) => a.seq - b.seq)
    .filter((row) => {
      const key = row.localId || row.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const marks = markSubagents(new Map(), sorted);
  const reasoning = new Set(sorted.map(row => reasoningCall(record(row.raw))).filter((id): id is string => id !== undefined));
  // Like the v1 reducer, subagent rows go under the tool call that names them in `sessionSubagent`.
  const receipts = new Map<string, { seq: number; reason?: string }>();
  for (const row of sorted) {
    const receipt = messageReceipt(record(row.raw));
    if (receipt && !receipts.has(receipt.ref)) receipts.set(receipt.ref, { seq: row.seq, reason: receipt.reason });
  }
  const settle = (row: MessageRecord, message: Message): { at: number; message: Message } => {
    if (message.role !== 'user') return { message, at: row.seq };
    const receipt = receipts.get(row.id);
    if (receipt) return { at: receipt.seq, message: receipt.reason === undefined ? message
      : { ...message, delivery: { status: 'rejected' as const, reason: receipt.reason } } };
    const meta = record(record(row.raw).meta);
    if (holdUntilAccepted && meta.expectsAcceptance === true) return { at: Number.MAX_SAFE_INTEGER, message: {
      ...message, delivery: { status: 'pending' as const, queued: meta.queuedWhileBusy === true, since: row.createdAt },
    } };
    return { message, at: row.seq };
  };
  const placed: { at: number; message: Message }[] = [];
  const work = new Map<string, { seq: number; message: Message }[]>();
  const seqs = new WeakMap<Message, number>();
  const standalone = new WeakSet<Message>();
  for (const row of sorted) {
    const normalized = normalizeMessage(row);
    if (!normalized) continue;
    const subagent = subagentOf(row, marks);
    if (!subagent) { const item = settle(row, normalized); placed.push(item); seqs.set(item.message, row.seq); continue; }
    let list = work.get(subagent);
    if (!list) {
      work.set(subagent, list = []);
      // The CLI sends no tool call for Task, and the parent can be on an older page. That work shows on its own.
      const name = marks.get(subagent)?.title || 'Subagent';
      const holder: Message = { id: `subagent:${subagent}`, role: 'assistant', content: '', tools: [name], toolCalls: [{ id: subagent, name }] };
      standalone.add(holder);
      placed.push({ at: row.seq, message: holder });
    }
    list.push({ seq: row.seq, message: normalized });
  }
  const messages = placed.sort((a, b) => a.at - b.at).map(({ message }) => message);
  const results = new Map([...messages, ...[...work.values()].flat().map(item => item.message)]
    .flatMap(message => (message.toolResults || []).map(result => [result.id, result] as const)));
  const matched = new Set<string>();
  const join = (message: Message): Message => !message.toolCalls ? message : { ...message, toolCalls: message.toolCalls.map(call => {
    const result = results.get(call.id);
    if (!result) return call;
    matched.add(call.id);
    return { ...call, result: result.result, isError: result.isError, ended: true,
      ...(result.resultText ? { resultText: result.resultText } : {}), ...(result.permission ? { permission: result.permission } : {}) };
  }) };
  const ownerOf = (call: ToolCall) => {
    const id = record(call.input).sessionSubagent;
    return typeof id === 'string' && work.has(id) ? id : work.has(call.id) ? call.id : undefined;
  };
  // Codex names the subagent in every collab call (spawn, send, wait, close). Like the v1 tracer, a row goes to
  // the latest call that names it before the row, or to the first call when the row comes before all of them.
  const owners = new Map<string, { seq: number; call: ToolCall }[]>();
  for (const message of messages) if (!standalone.has(message)) for (const call of message.toolCalls || []) {
    const id = ownerOf(call);
    if (id) owners.set(id, [...owners.get(id) || [], { seq: seqs.get(message)!, call }]);
  }
  const assigned = new Map<ToolCall, Message[]>();
  for (const [id, calls] of owners) for (const { seq, message } of work.get(id)!) {
    const { call } = calls.reduce((owner, next) => next.seq < seq ? next : owner, calls[0]);
    assigned.set(call, [...assigned.get(call) || [], message]);
  }
  const childrenOf = (call: ToolCall, list: Message[]) => {
    const children = list.filter(child => shows(child) || !!child.thinking).map(join);
    // V1 drops a subagent text that repeats the parent prompt, but only as the first row of its work.
    const prompt = text(record(call.input).prompt).trim(), first = children[0];
    if (prompt && first && !first.tools?.length && !first.thinking && first.content.trim() === prompt) children.shift();
    return children;
  };
  const rendered = messages.flatMap(message => {
    if (standalone.has(message) && owners.has(message.toolCalls![0].id)) return [];
    const joined = join(message);
    if (!joined.toolCalls) return [joined];
    const toolCalls = joined.toolCalls.map((call, index) => {
      const list = standalone.has(message) ? work.get(call.id)!.map(item => item.message) : assigned.get(message.toolCalls![index]);
      const children = list ? childrenOf(call, list) : [];
      return children.length ? { ...call, children } : call;
    });
    return standalone.has(message) && !toolCalls[0].children ? [] : [{ ...joined, toolCalls }];
  });
  const output: Message[] = [];
  for (const item of rendered) {
    // Older Codex and ACP records keep the text of a hidden reasoning call only in its result.
    const folded = (item.toolResults || []).filter(result => reasoning.has(result.id))
      .map(result => text(record(result.result).content).trim()).filter(Boolean);
    const rest = item.toolResults?.filter(result => !reasoning.has(result.id));
    const message = folded.length ? { ...item, thinking: [item.thinking, ...folded].filter(Boolean).join('\n\n'),
      toolResults: rest?.length ? rest : undefined } : item;
    // Image-only sends still carry modes in the following empty text record.
    // Keep those modes on the image without adding an empty chat bubble.
    if (message.role === 'user' && message.settings && !message.content && !message.attachments?.length) {
      const previous = output.at(-1);
      if (previous?.role === 'user' && previous.attachments?.length)
        output[output.length - 1] = { ...previous, settings: message.settings, sentAt: message.sentAt };
      continue;
    }
    const previous = output.at(-1);
    if (previous && onlyThinking(previous) && onlyThinking(message)) {
      const chunk = thinkingChunks.has(message);
      const merged = { ...previous, thinking: previous.thinking + (chunk && thinkingChunks.has(previous) ? '' : '\n\n') + message.thinking };
      if (chunk) thinkingChunks.add(merged);
      output[output.length - 1] = merged;
      continue;
    }
    if (!message.toolResults?.length) { output.push(message); continue; }
    const unmatched = message.toolResults.filter(result => !matched.has(result.id) && !result.hideUnmatched && !reasoning.has(result.id));
    if (!unmatched.length && !message.content && !message.tools?.length && !message.thinking) continue;
    output.push({ ...message, ...(unmatched.length ? {
      tools: unmatched.map(() => 'Earlier tool call'),
      toolCalls: unmatched.map(result => ({ ...result, name: 'Earlier tool call' })),
    } : {}) });
  }
  return output;
}
const tokens = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
const contextResets = new Set(['Context was reset', 'Compaction completed']);
/**
 * The context use of the main thread, as in Happy sync/reducer/reducer.ts processUsageData.
 * The newest usage wins, and a later record wins a tie. A reset or compaction clears it. Subagent usage does not count.
 */
export function contextUsage(rows: Iterable<MessageRecord>): ContextUsage | undefined {
  let latest: (ContextUsage & { at: number }) | undefined;
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  // The Claude mapper also tags main rows after a subagent with its id, so only rows inside the subagent bounds are skipped.
  const marks = markSubagents(new Map(), sorted);
  for (const row of sorted) {
    const raw = record(row.raw), content = record(raw.content);
    const envelope = raw.role === 'session' ? record(content.type === 'session' ? content.data : content)
      : content.type === 'session' ? record(content.data) : null;
    let usage: Json | null = null, at = row.createdAt;
    if (envelope) {
      if (envelope.role !== 'agent' || subagentOf(row, marks)) continue;
      usage = record(envelope.usage);
      if (typeof envelope.time === 'number') at = envelope.time;
    } else if (raw.role === 'agent' && content.type === 'output') {
      const data = record(content.data);
      if (data.type !== 'assistant' || data.isSidechain) continue;
      usage = record(data.message?.usage);
    } else if (raw.role === 'agent' && content.type === 'event') {
      const data = record(content.data);
      if (data.type === 'message' && contextResets.has(data.message)) latest = { size: 0, at };
      continue;
    } else continue;
    if (typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number' || (latest && at < latest.at)) continue;
    const window = tokens(usage.context_window);
    latest = {
      size: tokens(usage.input_tokens) + tokens(usage.cache_creation_input_tokens) + tokens(usage.cache_read_input_tokens),
      ...(window ? { window } : {}),
      at,
    };
  }
  return latest && { size: latest.size, ...(latest.window ? { window: latest.window } : {}) };
}
// Happy's usage popup shows only these two plan windows (AgentInput.tsx usageRows).
const usageWindows = { five_hour: 5 * 3600000, seven_day: 7 * 86400000 } as const;
function windowReading(windows: Json[], id: keyof typeof usageWindows, now: number): UsageWindow | null {
  const window = windows.find((window) => window.id === id);
  if (!window || typeof window.utilization !== 'number') return null;
  const resetAt = typeof window.resetsAt === 'number' ? window.resetsAt : null;
  const length = usageWindows[id];
  return {
    usedPercent: Math.round(window.utilization),
    pacePercent: resetAt ? Math.max(0, Math.min(100, ((now - resetAt + length) / length) * 100)) : null,
    reset: resetAt ? new Date(resetAt).toLocaleString() : 'Unknown',
    resetAt,
  };
}
export function weeklyUsage(
  agent: Agent,
  windows: Json[],
  capturedAt: number,
  now = Date.now(),
): UsageReading | null {
  const week = windowReading(windows, 'seven_day', now);
  if (!week) return null;
  const fiveHour = windowReading(windows, 'five_hour', now);
  return {
    agent,
    ...week,
    ...(fiveHour ? { fiveHour } : {}),
    capturedAt,
    stale: (!!week.resetAt && week.resetAt <= now) || now - capturedAt > 15 * 60000,
  };
}
