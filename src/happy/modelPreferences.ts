import type { Agent, ModelChoice, Session } from '../data/types';
import { compareSessionActivity } from '../data/sessionList';
import { canSelectModel, defaultEffort, effortOptions, isConcreteModel, modelOptions } from './modelOptions';
import { currentEffort, currentModel, type Json } from './normalize';

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
