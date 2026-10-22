import { record, type Json } from './normalize';

// Adapted from Happy Web components/agentGoalStatus.ts and sync/storageTypes.ts (AgentGoalStatusSchema).
export type GoalAction = 'edit' | 'clear';
export type GoalStep = { text: string; status: 'pending' | 'in_progress' | 'completed' };
export type AgentGoal = {
  source: 'claude' | 'codex';
  text: string;
  sourceSessionId: string;
  actions: GoalAction[];
  progress?: { currentStep?: number; totalSteps?: number; steps?: GoalStep[] };
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const stepStatuses = new Set(['pending', 'in_progress', 'completed']);

function progressOf(value: unknown): AgentGoal['progress'] | undefined {
  if (value === undefined) return undefined;
  const progress = record(value);
  const steps = Array.isArray(progress.steps) && progress.steps.every(step =>
    nonEmpty(record(step).text) && stepStatuses.has(record(step).status))
    ? progress.steps.map(step => ({ text: record(step).text.trim(), status: record(step).status }))
    : undefined;
  const result: NonNullable<AgentGoal['progress']> = {
    ...(positive(progress.currentStep) ? { currentStep: progress.currentStep } : {}),
    ...(positive(progress.totalSteps) ? { totalSteps: progress.totalSteps } : {}),
    ...(steps?.length ? { steps } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

// Happy Web shows an active goal only while the session is online and the goal belongs to the current
// Claude session or Codex thread. The CLIs (claude/claudeGoalStatus.ts, codex/codexGoalStatus.ts) report
// only clear and edit. Their goal-action handlers reject stop, and Happy Web ignores it, so Rayno omits it.
export function visibleGoal(agentState: Json | undefined, metadata: Json | undefined, online: boolean): AgentGoal | null {
  const goal = record(record(agentState).agentGoalStatus);
  if (!online || goal.status !== 'active' || !nonEmpty(goal.text) || !nonEmpty(goal.sourceSessionId)) return null;
  if (goal.source !== 'claude' && goal.source !== 'codex') return null;
  const meta = record(metadata);
  const expected = goal.source === 'claude' ? meta.claudeSessionId : meta.codexThreadId;
  if (!nonEmpty(expected) || goal.sourceSessionId !== expected) return null;
  const capabilities = record(goal.capabilities);
  const progress = progressOf(goal.progress);
  return {
    source: goal.source,
    text: goal.text.trim(),
    sourceSessionId: goal.sourceSessionId,
    actions: (['edit', 'clear'] as const).filter(action => capabilities[action] === true),
    ...(progress ? { progress } : {}),
  };
}

export function goalProgressLabel(progress: AgentGoal['progress']): string {
  if (!progress) return '';
  if (progress.currentStep && progress.totalSteps) return `Step ${progress.currentStep} of ${progress.totalSteps}`;
  if (progress.steps) return `${progress.steps.filter(step => step.status === 'completed').length} of ${progress.steps.length} steps done`;
  return progress.totalSteps ? `${progress.totalSteps} steps` : `Step ${progress.currentStep}`;
}

// The `goal-action` RPC parameters (Happy Web sync/ops.ts sessionGoalAction), or null when nothing changes.
// As in Happy Web -session/agentGoalActionHandler.ts, an edit sends only a new, non-empty objective.
export function goalActionParams(action: GoalAction, current: string, next?: string): { action: GoalAction; objective?: string } | null {
  if (action === 'clear') return { action };
  const objective = next?.trim();
  return objective && objective !== current.trim() ? { action, objective } : null;
}
