import { describe, expect, it } from 'vitest';
import { visibleMessages, type MessageRecord } from './normalize';
import { completedForms, completedPermissions, mergedPermission, permissionSummary, resultPermission } from './toolDecisions';
import type { ToolCall } from '../data/types';

const row = (seq: number, raw: object): MessageRecord => ({ id: String(seq), seq, raw, createdAt: seq });
const output = (data: object) => ({ role: 'agent', content: { type: 'output', data } });
const label = (mode: string) => ({ acceptEdits: 'Edits', bypassPermissions: 'Yolo' })[mode] || mode;

describe('tool decisions', () => {
  it('should pass the permissions field of a Claude tool result to its call', () => {
    // Arrange: claudeRemoteLauncher.ts adds `permissions` to each answered tool_result.
    const rows = [row(1, output({ type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm test' } }] } })),
    row(2, output({ type: 'user', uuid: 'b', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_bash', content: 'ok',
        permissions: { date: 1700000000000, result: 'approved', allowedTools: ['Bash(npm test)'] } }] },
      toolUseResult: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }))];
    // Act
    const [message] = visibleMessages(rows);
    // Assert
    expect(message.toolCalls?.[0]).toMatchObject({ result: { stdout: 'ok' }, resultText: 'ok',
      permission: { status: 'approved', allowedTools: ['Bash(npm test)'] } });
    expect(resultPermission({ date: 1, result: 'later' })).toBeUndefined();
  });

  it('should keep the agent-state reason when the tool result also has a reply', () => {
    // Arrange: permissionHandler.ts stores `reason` in completedRequests, and claudeRemoteLauncher.ts does not copy it.
    const fromResult = resultPermission({ date: 1, result: 'denied' });
    const fromState = completedPermissions({ completedRequests: {
      toolu_rm: { tool: 'Bash', arguments: {}, createdAt: 1, completedAt: 2, status: 'denied', reason: 'Not now', decision: 'denied' } } }).get('toolu_rm');
    // Act
    const merged = mergedPermission(fromResult, fromState);
    // Assert
    expect(merged).toEqual({ status: 'denied', reason: 'Not now', decision: 'denied' });
    expect(mergedPermission(undefined, fromState)).toBe(fromState);
    expect(mergedPermission(fromResult, undefined)).toBe(fromResult);
  });

  it('should join completed agent-state requests by the raw tool call ID', () => {
    // Arrange: claude/utils/permissionHandler.ts writes both tool list names and a subagent-scoped key.
    const state = { completedRequests: {
      'agent-1:toolu_edit': { tool: 'Edit', arguments: {}, createdAt: 1, completedAt: 2, status: 'approved', mode: 'acceptEdits',
        allowTools: ['Edit'], toolUseId: 'toolu_edit' },
      toolu_rm: { tool: 'Bash', arguments: { command: 'rm -rf dist' }, createdAt: 1, completedAt: 2, status: 'denied', reason: 'Not now' },
      call_codex: { tool: 'CodexBash', arguments: {}, createdAt: 1, completedAt: 2, status: 'approved', decision: 'approved_for_session' },
      toolu_old: { tool: 'Read', arguments: {}, createdAt: 1, completedAt: 2, status: 'canceled', reason: 'Session reset' },
    } };
    // Act
    const permissions = completedPermissions(state);
    // Assert
    expect([...permissions.keys()]).toEqual(['toolu_edit', 'toolu_rm', 'call_codex', 'toolu_old']);
    expect(permissions.get('toolu_edit')).toEqual({ status: 'approved', mode: 'acceptEdits', allowedTools: ['Edit'] });
    expect(permissions.get('toolu_rm')).toEqual({ status: 'denied', reason: 'Not now' });
  });

  it('should name the reply that the user chose, as the v1 permission footer does', () => {
    // Arrange
    const bash: ToolCall = { id: 'b', name: 'Bash', input: { command: 'npm test' } };
    const plan: ToolCall = { id: 'p', name: 'ExitPlanMode', input: { plan: 'Plan' } };
    const question: ToolCall = { id: 'q', name: 'AskUserQuestion', input: {} };
    // Act
    const summaries = [
      permissionSummary(bash, { status: 'approved' }, label),
      permissionSummary(bash, { status: 'approved', allowedTools: ['Bash(npm test)'] }, label),
      permissionSummary(bash, { status: 'approved', allowedTools: ['Bash(npm run build)'] }, label),
      permissionSummary({ ...bash, name: 'CodexBash' }, { status: 'approved', decision: 'approved_for_session' }, label),
      permissionSummary(plan, { status: 'approved', mode: 'acceptEdits' }, label),
      permissionSummary(bash, { status: 'denied', reason: 'Not now' }, label),
      permissionSummary(bash, { status: 'denied', decision: 'abort' }, label),
      permissionSummary(bash, { status: 'canceled' }, label),
      permissionSummary(question, { status: 'denied' }, label),
      permissionSummary(question, { status: 'approved' }, label),
    ];
    // Assert
    expect(summaries.map((summary) => summary.label)).toEqual(['Allowed once', 'Allowed for session', 'Allowed once',
      'Allowed for session', 'Allowed · Edits', 'Denied', 'Aborted', 'Canceled', 'Dismissed', 'Answered']);
    expect(summaries[1].detail).toBe('Allowed for this session. Allowed tools: Bash(npm test).');
    expect(summaries[4].detail).toBe('Allowed. The session mode changed to Edits.');
    expect(summaries[5]).toEqual({ label: 'Denied', detail: 'Denied: Not now', tone: 'denied' });
  });

  it('should read answered agent forms by their tool call', () => {
    // Arrange: the v1 sync/agentCommunications.ts form shape.
    const state = { completedCommunications: {
      form1: { kind: 'form', toolUseId: 'call_input', status: 'answered', completedAt: 2, form: { questions: [
        { id: 'scope', header: 'Scope', question: 'Which tickets?', options: [{ label: 'All' }, { label: 'Some' }] },
        { id: 'note', header: 'Note', question: 'Anything else?', options: [] }] },
      answers: { scope: { options: ['Some'], custom: 'Only ACE' } } },
      form2: { kind: 'form', status: 'cancelled', form: { questions: [{ id: 'a', header: 'A', question: 'Go?', options: [] }] } },
      notice: { kind: 'notice', status: 'answered' },
    } };
    // Act
    const forms = completedForms(state);
    // Assert
    expect(forms.get('call_input')).toEqual({ status: 'answered', items: [
      { question: 'Which tickets?', answer: 'Some, Only ACE' }, { question: 'Anything else?', answer: '—' }] });
    expect(forms.get('form2')?.status).toBe('cancelled');
    expect(forms.has('notice')).toBe(false);
  });
});
