import { describe, expect, it } from 'vitest';
import { questionCallIds, questionForTool } from './Requests';

describe('questionCallIds', () => {
  it('should list only the calls with an open question, like questionForTool', () => {
    // Arrange: 200 tool calls. One has a permission question, one has a form, and one has a closed question.
    const state = {
      requests: {
        'perm-1': { tool: 'AskUserQuestion', toolUseId: 'call-3', arguments: {} },
        'perm-2': { tool: 'Bash', toolUseId: 'call-4', arguments: {} },
        'perm-3': { tool: 'AskUserQuestion', toolUseId: 'call-5', arguments: {} },
      },
      completedRequests: { 'perm-3': { status: 'approved' } },
      communications: { 'form-1': { kind: 'form', toolUseId: 'call-7', createdAt: 1, form: { questions: [{ id: 'q', options: [{ label: 'A' }] }] } } },
    };
    const calls = Array.from({ length: 200 }, (_, index) => `call-${index}`);
    // Act
    const ids = questionCallIds(state);
    // Assert
    const withQuestion = calls.filter((id) => { const request = questionForTool(state, id); return !!request.permission || !!request.form; });
    expect(withQuestion).toEqual(['call-3', 'call-7']);
    expect(calls.filter((id) => ids.has(id))).toEqual(withQuestion);
  });
  it('should return an empty set without an agent state', () => {
    // Act / Assert
    expect(questionCallIds(undefined).size).toBe(0);
  });
});
