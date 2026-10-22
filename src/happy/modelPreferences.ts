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

/** Composer modes that the user picked for one session. `at` is absent in values that older builds saved on every render. */
export type SessionModes = { model?: string; effort?: string | null; permission?: string | null; at?: number };
export type SentModes = MessageSettings & { sentAt: number };

export function latestSentModes(messages: Message[]): SentModes | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user' && message.settings)
      return { ...message.settings, sentAt: message.sentAt ?? 0 };
  }
  return undefined;
}

export type AgentModeChange = { permission: string; at: number };

/**
 * The permission mode that the agent took itself, as Happy Web applies it (sync.ts, PermissionFooter.tsx):
 * EnterPlanMode starts plan mode. An approved ExitPlanMode ends it with the approved mode, as the CLI applies it.
 */
export function latestAgentMode(messages: Message[], agentState: Json, metadata: Json): AgentModeChange | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const plan = messages[index].planMode;
    if (!plan) continue;
    const exit = record(record(agentState.completedRequests)[plan.call]);
    if (!plan.active && exit.status !== 'approved') continue;
    const permission = plan.active ? 'plan'
      : ['default', 'acceptEdits', 'bypassPermissions'].includes(exit.mode) ? exit.mode : 'default';
    return permissionOptions(metadata).some((option) => option.value === permission && !option.disabled)
      ? { permission, at: plan.at } : undefined;
  }
  return undefined;
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
  if (agentMode && (!picked || agentMode.at > picked.at!) && (!sent || agentMode.at > sent.sentAt))
    permission = agentMode.permission;
  return {
    modelCandidates: ordered as (Partial<ModelChoice> | undefined)[],
    legacy,
    /** undefined means that no pick and no sent message names a permission mode. */
    permission: typeof permission === 'string' || permission === null ? permission : undefined,
  };
}
