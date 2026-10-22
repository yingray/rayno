import type { Agent, Message, MessageSettings, ModelChoice, Session } from '../data/types';
import { compareSessionActivity } from '../data/sessionList';
import { canSelectModel, defaultEffort, effortOptions, isConcreteModel, modelOptions } from './modelOptions';
import { currentEffort, currentModel, record, type Json } from './normalize';
import { permissionOptions } from './permissionOptions';

export function modelChoiceKey(agent: Agent, machineId: string): string {
  return agent === 'Happy Agent' ? `${agent}:${machineId}` : agent;
}

export function recentModelChoice(sessions: Session[], agent: Agent, machineId: string): ModelChoice | undefined {
  const source = sessions.filter((session) => session.agent === agent &&
    (agent !== 'Happy Agent' || session.machineId === machineId) && isConcreteModel(session.model))
    .sort(compareSessionActivity)[0];
  return source ? { model: source.model, effort: source.effort || source.model.split(' · ')[1]?.toLowerCase() || null } : undefined;
}

/** Resolve saved choices against the current catalog before any send or spawn. */
export function resolveModelChoice(metadata: Json, candidates: (Partial<ModelChoice> | null | undefined)[] = []): ModelChoice {
  const reported = { model: currentModel(metadata), effort: currentEffort(metadata) };
  const choices = [...candidates, reported];
  const options = modelOptions(metadata);
  let model = '';
  if (!canSelectModel(metadata)) model = isConcreteModel(reported.model) ? reported.model : '';
  else {
    for (const candidate of choices) {
      if (!isConcreteModel(candidate?.model)) continue;
      const value = candidate.model.split(' · ')[0];
      const option = options.find((item) => !item.disabled && (item.value === value || item.label === value));
      if (option) { model = option.value; break; }
    }
    model ||= options.find((option) => !option.disabled)?.value || '';
  }
  if (!model) return { model: '', effort: null };
  const levels = effortOptions(metadata, model);
  const effort = choices.filter((candidate) => {
    const value = candidate?.model?.split(' · ')[0];
    return value === model || options.find((option) => option.value === model)?.label === value;
  }).map((candidate) => candidate?.effort).find((level): level is string => typeof level === 'string' && levels.includes(level));
  return { model, effort: effort || defaultEffort(metadata, model) };
}

/**
 * Composer modes that the user picked for one session. `at` is absent in values that older builds saved on every render.
 * `agentCall` is the call of the agent mode change (`latestAgentMode`) that the pick saw.
 */
export type SessionModes = { model?: string; effort?: string | null; permission?: string | null; at?: number; agentCall?: string };
export type SentModes = MessageSettings & { sentAt: number };

export function latestSentModes(messages: Message[]): SentModes | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user' && message.settings)
      return { ...message.settings, sentAt: message.sentAt ?? 0 };
  }
  return undefined;
}

export type AgentModeChange = { permission: string; at: number; call: string };

/**
 * The permission mode that the agent took itself, as Happy Web applies it (sync.ts, PermissionFooter.tsx):
 * EnterPlanMode starts plan mode. An approved ExitPlanMode ends it with the approved mode (see `modeBeforePlan`), else default.
 */
export function latestAgentMode(messages: Message[], agentState: Json, metadata: Json): AgentModeChange | undefined {
  const options = permissionOptions(metadata).filter((option) => !option.disabled).map((option) => option.value);
  for (let index = messages.length - 1; index >= 0; index--) {
    const plan = messages[index].planMode;
    if (!plan) continue;
    const request = record(record(agentState.completedRequests)[plan.call]);
    // claude/utils/permissionHandler.ts asks before EnterPlanMode outside bypass and plan modes.
    if (plan.active ? request.status === 'denied' || request.status === 'canceled'
      || (!request.status && plan.call in record(agentState.requests)) : request.status !== 'approved') continue;
    const permission = plan.active ? 'plan' : request.mode !== 'plan' && options.includes(request.mode) ? request.mode : 'default';
    return options.includes(permission) ? { permission, at: plan.at, call: plan.call } : undefined;
  }
  return undefined;
}

/** The newest picked or sent mode other than plan. An approved ExitPlanMode returns to it. */
export function modeBeforePlan(
  saved: SessionModes | null | undefined,
  messages: Message[],
  inheritedPermission: string | undefined,
  metadata: Json,
): string | undefined {
  const usable = (mode: unknown): mode is string => typeof mode === 'string' && mode !== 'plan'
    && permissionOptions(metadata).some((option) => option.value === mode && !option.disabled);
  const picked = typeof saved?.at === 'number' && usable(saved.permission) ? saved.permission : undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const mode = message.role === 'user' ? message.settings?.permissionMode : undefined;
    if (usable(mode)) return picked && saved!.at! >= (message.sentAt ?? 0) ? picked : mode;
  }
  return picked ?? (usable(inheritedPermission) ? inheritedPermission : undefined);
}

/**
 * Rank the sources for the composer modes of an open session:
 * the newer of an explicit pick and the last sent message, then the other one,
 * then the reported session values, then values without a pick time.
 * A permission mode that the agent took after the pick and the last sent message replaces both.
 */
export function rankSessionModes(
  saved: SessionModes | null | undefined,
  sent: SentModes | undefined,
  inheritedPermission?: string,
  agentMode?: AgentModeChange,
) {
  const picked = typeof saved?.at === 'number' ? saved : undefined;
  const legacy = saved && !picked ? saved : undefined;
  const sentChoice = sent && { model: sent.model, effort: sent.effort };
  // A message sent with the pick repeats it; only a different newer message replaces the pick.
  const sentPick = !!picked && !!sent &&
    (sent.model === undefined || sent.model === picked.model) &&
    (sent.effort === undefined || sent.effort === picked.effort) &&
    (sent.permissionMode === undefined || sent.permissionMode === (picked.permission ?? inheritedPermission));
  const pickedFirst = !!picked && (!sent || picked.at! >= sent.sentAt || sentPick);
  const ordered = pickedFirst ? [picked, sentChoice] : [sentChoice, picked];
  let permission: string | null | undefined;
  if (pickedFirst && 'permission' in picked) permission = picked.permission;
  else if (sent?.permissionMode) permission = sent.permissionMode;
  else if (picked && 'permission' in picked) permission = picked.permission;
  // A pick that saw this agent call is newer, whatever the browser clock says.
  if (agentMode && (!picked || (picked.agentCall !== agentMode.call && agentMode.at > picked.at!))
    && (!sent || agentMode.at > sent.sentAt)) permission = agentMode.permission;
  return {
    modelCandidates: ordered as (Partial<ModelChoice> | undefined)[],
    legacy,
    /** undefined means that no pick and no sent message names a permission mode. */
    permission: typeof permission === 'string' || permission === null ? permission : undefined,
  };
}
