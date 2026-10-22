import type { Agent, Machine, Message, MessageSettings, Session, ToolCall, UsageReading } from '../data/types';
import { compareVersionsWithPrerelease, isWellFormedVersion } from './versionUtils';
import { stripLeadingTaskNotificationWrappers } from './controlMessages';
import { systemPrompt } from './systemPrompt';

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
): Json {
  const mode = record(metadata.draft || metadata.lastMode);
  const meta: Json = { sentFrom: 'web', appendSystemPrompt: systemPrompt };
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
export function normalizeSession(
  source: SessionRecord,
  messages: Message[],
  unread = false,
  machine?: MachineRecord,
  optionsPending = false,
): Session {
  const { wire, metadata: m, agentState: a } = source;
  const path = text(m.path);
  const worktreeMarker = '/.dev/worktree/';
  const worktreeIndex = path.indexOf(worktreeMarker);
  const projectPath = worktreeIndex < 0 ? path : path.slice(0, worktreeIndex);
  const project = text(m.project?.name, projectPath.split(/[\\/]/).filter(Boolean).pop());
  const workspace = text(
    m.workspace?.name,
    worktreeIndex < 0 ? '' : path.slice(worktreeIndex + worktreeMarker.length),
  );
  const pending =
    pendingPermissions(a).length ||
    Object.keys(record(a.communications)).some((id) => !record(a.completedCommunications)[id]);
  return {
    id: wire.id,
    title: text(m.summary?.text, path.split('/').filter(Boolean).pop() || 'Untitled session'),
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
    lastActivityAt: m.lastMeaningfulMessageAt ?? wire.createdAt,
    machineOffline: machine ? !machine.wire.active : false,
    isSideChat: m.isSideChat === true,
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
const normalizedMessages = new WeakMap<MessageRecord, Message | null>();
export function normalizeMessage(row: MessageRecord): Message | null {
  if (normalizedMessages.has(row)) return normalizedMessages.get(row)!;
  const raw = record(row.raw),
    content = record(raw.content);
  const message: Message = {
    id: row.id,
    role: raw.role === 'user' ? 'user' : 'assistant',
    content: '',
  };
  if (raw.role === 'user' && content.type === 'text') {
    message.content = text(raw.meta?.displayText || content.text);
    const settings = sentSettings(record(raw.meta));
    if (settings) {
      message.settings = settings;
      message.sentAt = row.createdAt;
    }
  }
  const envelope =
    raw.role === 'session'
      ? content.type === 'session'
        ? content.data
        : content
      : content.type === 'session'
        ? content.data
        : null;
  if (envelope) {
    message.role = envelope.role === 'user' ? 'user' : 'assistant';
    const event = record(envelope.ev);
    if (event.t === 'text' && !event.thinking) message.content = text(event.text);
    if (event.t === 'tool-call-start')
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
        const tools = chunks
          .filter((x) => x.type === 'tool_use')
          .map((x) => text(x.name, 'Tool call'));
        if (tools.length) message.tools = tools;
      }
      if (data.type === 'result' && data.is_error)
        message.content = text(data.result, 'The agent reported an error.');
    } else if (content.type === 'codex' || content.type === 'acp') {
      if (data.type === 'message') message.content = text(data.message);
      if (data.type === 'tool-call') message.tools = [text(data.name, 'Tool call')];
    }
  }
  const calls: ToolCall[] = [];
  const results: NonNullable<Message['toolResults']> = [];
  const addCall = (id: unknown, name: unknown, input: unknown) => calls.push({ id: text(id, row.id), name: text(name, 'Tool call'), input });
  const addResult = (id: unknown, result: unknown, isError: unknown) => results.push({ id: text(id), result, isError: isError === true });
  if (envelope) {
    const event = record(envelope.ev);
    if (event.t === 'tool-call-start') addCall(event.call, event.title || event.name, event.args);
    if (event.t === 'tool-call-end') addResult(event.call, event.result, event.isError);
  } else if (raw.role === 'agent') {
    const data = record(content.data);
    if (content.type === 'output') {
      const chunks = data.message?.content;
      if (Array.isArray(chunks)) for (const chunk of chunks) {
        if (chunk.type === 'tool_use' || chunk.type === 'tool-call') addCall(chunk.callId || chunk.id, chunk.name, chunk.input);
        if (chunk.type === 'tool_result' || chunk.type === 'tool-call-result') addResult(chunk.tool_use_id || chunk.callId || chunk.toolCallId, chunk.content ?? chunk.output, chunk.is_error);
      }
    } else if (content.type === 'codex' || content.type === 'acp') {
      if (data.type === 'tool-call') addCall(data.callId, data.name, data.input);
      if (data.type === 'tool-result' || data.type === 'tool-call-result') addResult(data.callId, data.output, data.isError);
    }
  }
  if (calls.length) { message.toolCalls = calls; message.tools = calls.map(call => call.name); }
  if (results.length) message.toolResults = results;
  message.content = stripLeadingTaskNotificationWrappers(message.content);
  const result = message.content || message.tools?.length || message.toolResults?.length || message.attachments?.length || message.settings ? message : null;
  normalizedMessages.set(row, result);
  return result;
}
export function visibleMessages(rows: MessageRecord[]): Message[] {
  const seen = new Set<string>();
  const messages = [...rows]
    .sort((a, b) => a.seq - b.seq)
    .filter((row) => {
      const key = row.localId || row.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(normalizeMessage)
    .filter((message): message is Message => !!message);
  const results = new Map(messages.flatMap(message => (message.toolResults || []).map(result => [result.id, result] as const)));
  const matched = new Set<string>();
  const rendered = messages.map(message => {
    if (!message.toolCalls) return message;
    return { ...message, toolCalls: message.toolCalls.map(call => {
      const result = results.get(call.id);
      if (!result) return call;
      matched.add(call.id);
      return { ...call, result: result.result, isError: result.isError };
    }) };
  });
  const output: Message[] = [];
  for (const message of rendered) {
    // Image-only sends still carry modes in the following empty text record.
    // Keep those modes on the image without adding an empty chat bubble.
    if (message.role === 'user' && message.settings && !message.content && !message.attachments?.length) {
      const previous = output.at(-1);
      if (previous?.role === 'user' && previous.attachments?.length)
        output[output.length - 1] = { ...previous, settings: message.settings, sentAt: message.sentAt };
      continue;
    }
    if (!message.toolResults?.length) { output.push(message); continue; }
    const unmatched = message.toolResults.filter(result => !matched.has(result.id));
    if (!unmatched.length && !message.content && !message.tools?.length) continue;
    output.push({ ...message, ...(unmatched.length ? {
      tools: unmatched.map(() => 'Earlier tool call'),
      toolCalls: unmatched.map(result => ({ ...result, name: 'Earlier tool call' })),
    } : {}) });
  }
  return output;
}
export function weeklyUsage(
  agent: Agent,
  windows: Json[],
  capturedAt: number,
  now = Date.now(),
): UsageReading | null {
  const window = windows.find((window) => window.id === 'seven_day');
  if (!window || typeof window.utilization !== 'number') return null;
  const resetAt = typeof window.resetsAt === 'number' ? window.resetsAt : null;
  const week = 7 * 86400000;
  const pacePercent = resetAt
    ? Math.max(0, Math.min(100, ((now - resetAt + week) / week) * 100))
    : null;
  return {
    agent,
    usedPercent: Math.round(window.utilization),
    pacePercent,
    reset: resetAt ? new Date(resetAt).toLocaleString() : 'Unknown',
    resetAt,
    capturedAt,
    stale: (resetAt !== null && resetAt <= now) || now - capturedAt > 15 * 60000,
  };
}
