import type { ToolCall, ToolPermission } from '../data/types';

// Past permission replies and question answers, as Happy Web shows them on a tool call:
// sync/reducer/reducer.ts, components/tools/PermissionFooter.tsx, and sync/agentCommunications.ts.
type Json = Record<string, any>;
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const strings = (value: unknown) => Array.isArray(value) && value.length
  ? value.filter((item): item is string => typeof item === 'string') : undefined;
const statuses = new Set(['approved', 'denied', 'canceled']);

function permission(status: unknown, source: Json): ToolPermission | undefined {
  if (typeof status !== 'string' || !statuses.has(status)) return undefined;
  const value: ToolPermission = { status: status as ToolPermission['status'] };
  const mode = text(source.mode), decision = text(source.decision), reason = text(source.reason);
  // The Claude CLI writes `allowTools` (the RPC name) and `allowedTools`.
  const allowedTools = strings(source.allowedTools) || strings(source.allowTools);
  if (mode) value.mode = mode;
  if (allowedTools?.length) value.allowedTools = allowedTools;
  if (decision) value.decision = decision;
  if (reason) value.reason = reason;
  return value;
}

// The `permissions` field that happy-cli claude/claudeRemoteLauncher.ts adds to a Claude tool_result.
export function resultPermission(value: unknown): ToolPermission | undefined {
  const source = record(value);
  return permission(source.result, source);
}

// agentState.completedRequests, joined by the raw tool call ID like the v1 reducer.
export function completedPermissions(state: Json | undefined): Map<string, ToolPermission> {
  const map = new Map<string, ToolPermission>();
  for (const [id, raw] of Object.entries(record(state?.completedRequests))) {
    const request = record(raw);
    const value = permission(request.status, request);
    if (value) map.set(text(request.toolUseId) || id, value);
  }
  return map;
}

export type Answer = { question: string; answer: string };
export type AnsweredForm = { status: 'answered' | 'cancelled'; items: Answer[] };

// agentState.completedCommunications forms, joined to their tool call by `toolUseId`.
export function completedForms(state: Json | undefined): Map<string, AnsweredForm> {
  const map = new Map<string, AnsweredForm>();
  for (const [id, raw] of Object.entries(record(state?.completedCommunications))) {
    const form = record(raw);
    if (form.kind !== 'form' || (form.status !== 'answered' && form.status !== 'cancelled')) continue;
    const answers = record(form.answers);
    const questions: unknown[] = Array.isArray(form.form?.questions) ? form.form.questions : [];
    const items = questions.flatMap((value) => {
      const question = record(value);
      const answer = record(answers[question.id]);
      const parts = [...(strings(answer.options) || []), ...(text(answer.custom) ? [answer.custom] : [])];
      const label = text(question.question) || text(question.header);
      return label ? [{ question: label, answer: parts.join(', ') || '—' }] : [];
    });
    map.set(text(form.toolUseId) || id, { status: form.status, items });
  }
  return map;
}

// As in the v1 reducer, the tool_result `permissions` field wins, and the agent-state reason and decision stay.
export function mergedPermission(fromResult: ToolPermission | undefined, fromState: ToolPermission | undefined) {
  return fromResult && fromState ? { ...fromState, ...fromResult } : fromResult || fromState;
}

// A session tool call shows its title as the name and keeps the tool name as `tool`.
export const toolName = (call: ToolCall) => call.tool || call.name;
// The PermissionFooter rule: a Claude session approval names the tool, or `Bash(command)` for one command.
function allowedForSession(call: ToolCall, value: ToolPermission) {
  if (value.decision === 'approved_for_session') return true;
  const tools = value.allowedTools || [];
  const name = toolName(call), command = record(call.input).command;
  return tools.includes(name) || (name === 'Bash' && typeof command === 'string' && tools.includes(`Bash(${command})`));
}

export type PermissionSummary = { label: string; detail: string; tone: 'approved' | 'denied' };
export function permissionSummary(call: ToolCall, value: ToolPermission, modeLabel: (mode: string) => string): PermissionSummary {
  const question = toolName(call) === 'AskUserQuestion';
  if (value.status !== 'approved') {
    const label = question ? 'Dismissed'
      : value.status === 'canceled' ? 'Canceled' : value.decision === 'abort' ? 'Aborted' : 'Denied';
    return { label, detail: value.reason ? `${label}: ${value.reason}` : `${label}.`, tone: 'denied' };
  }
  if (question) return { label: 'Answered', detail: 'Answered.', tone: 'approved' };
  const session = allowedForSession(call, value);
  const label = session ? 'Allowed for session' : value.mode ? `Allowed · ${modeLabel(value.mode)}` : 'Allowed once';
  // A Claude reply with a mode also changes the permission mode of the session.
  const details = [session ? 'Allowed for this session.' : value.mode ? `Allowed. The session mode changed to ${modeLabel(value.mode)}.` : 'Allowed once.'];
  if (value.allowedTools?.length) details.push(`Allowed tools: ${value.allowedTools.join(', ')}.`);
  return { label, detail: details.join(' '), tone: 'approved' };
}
