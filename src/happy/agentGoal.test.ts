import { describe, expect, it } from 'vitest';
import { goalActionParams, goalProgressLabel, visibleGoal } from './agentGoal';

const metadata = { path: '/tmp/project', host: 'local', claudeSessionId: 'claude-session-1', codexThreadId: 'codex-thread-1' };
// happy-cli claude/claudeGoalStatus.ts: an unmet goal_status attachment with both confirmed actions.
const claudeGoal = {
  source: 'claude', observedAt: 11_000, sourceSessionId: 'claude-session-1', sourceRevision: 'a3f1c2d4-0b7e-4c55-9a3e-2f8f1d1f0b01',
  status: 'active', text: 'finish the branch', capabilities: { clear: true, edit: true },
};
// happy-cli codex/codexGoalStatus.ts: a thread_goal_updated event in the paused state.
const codexGoal = {
  source: 'codex', observedAt: 11_000, sourceSessionId: 'codex-thread-1', sourceRevision: 1710000000,
  status: 'active', text: 'review the branch', capabilities: { clear: true, edit: true },
};

describe('agent goal status', () => {
  it('should show an active goal for the current Claude session and Codex thread', () => {
    // Act
    const claude = visibleGoal({ agentGoalStatus: claudeGoal }, metadata, true);
    const codex = visibleGoal({ agentGoalStatus: codexGoal }, metadata, true);
    // Assert
    expect(claude).toEqual({ source: 'claude', text: 'finish the branch', sourceSessionId: 'claude-session-1', actions: ['edit', 'clear'] });
    expect(codex?.text).toBe('review the branch');
  });

  it('should hide inactive, unavailable, missing, and disconnected goals', () => {
    // Arrange
    const inactive = { source: 'claude', observedAt: 11_000, sourceSessionId: 'claude-session-1', status: 'inactive', reason: 'completed' };
    const unavailable = { source: 'codex', observedAt: 11_000, status: 'unavailable', reason: 'unsupported' };
    // Act / Assert
    expect(visibleGoal({ agentGoalStatus: inactive }, metadata, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: unavailable }, metadata, true)).toBeNull();
    expect(visibleGoal({}, metadata, true)).toBeNull();
    expect(visibleGoal(undefined, metadata, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: claudeGoal }, metadata, false)).toBeNull();
  });

  it('should hide a goal whose source identity does not match the session metadata', () => {
    // Act / Assert
    expect(visibleGoal({ agentGoalStatus: { ...codexGoal, sourceSessionId: 'different-thread' } }, metadata, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: claudeGoal }, { path: '/tmp/project' }, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: { ...claudeGoal, sourceSessionId: '' } }, metadata, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: { ...claudeGoal, sourceSessionId: undefined } }, metadata, true)).toBeNull();
    expect(visibleGoal({ agentGoalStatus: { ...claudeGoal, text: '   ' } }, metadata, true)).toBeNull();
  });

  it('should offer only the actions that the agent reports, and never stop', () => {
    // Act
    const edit = visibleGoal({ agentGoalStatus: { ...claudeGoal, capabilities: { edit: true } } }, metadata, true);
    const stop = visibleGoal({ agentGoalStatus: { ...claudeGoal, capabilities: { stop: true, clear: false } } }, metadata, true);
    const none = visibleGoal({ agentGoalStatus: { ...claudeGoal, capabilities: undefined } }, metadata, true);
    // Assert
    expect(edit?.actions).toEqual(['edit']);
    expect(stop?.actions).toEqual([]);
    expect(none?.actions).toEqual([]);
  });

  it('should read goal progress from the storage schema shape', () => {
    // Arrange
    const progress = { currentStep: 1, totalSteps: 2, steps: [
      { text: 'inspect source', status: 'completed' }, { text: 'write fix', status: 'in_progress' },
    ] };
    // Act
    const goal = visibleGoal({ agentGoalStatus: { ...claudeGoal, progress } }, metadata, true);
    // Assert
    expect(goal?.progress).toEqual(progress);
    expect(goalProgressLabel(goal?.progress)).toBe('Step 1 of 2');
    expect(goalProgressLabel({ steps: progress.steps as never })).toBe('1 of 2 steps done');
    expect(goalProgressLabel(undefined)).toBe('');
  });

  it('should send clear directly and an edit only with a new, trimmed objective', () => {
    // Act / Assert
    expect(goalActionParams('clear', 'finish the branch')).toEqual({ action: 'clear' });
    expect(goalActionParams('edit', 'finish the branch', '  ship the parity fix  ')).toEqual({ action: 'edit', objective: 'ship the parity fix' });
    expect(goalActionParams('edit', 'finish the branch', undefined)).toBeNull();
    expect(goalActionParams('edit', 'finish the branch', '   ')).toBeNull();
    expect(goalActionParams('edit', 'finish the branch', '  finish the branch  ')).toBeNull();
  });
});
