import { describe, expect, it } from 'vitest';
import { visibleMessages, type MessageRecord } from './normalize';
import { completedForms, completedPermissions, mergedPermission, permissionSummary, resultPermission } from './toolDecisions';
import type { ToolCall } from '../data/types';

const row = (seq: number, raw: object): MessageRecord => ({ id: String(seq), seq, raw, createdAt: seq });
const output = (data: object) => ({ role: 'agent', content: { type: 'output', data } });
const label = (mode: string) => ({ acceptEdits: 'Edits', bypassPermissions: 'Yolo' })[mode] || mode;

describe('tool decisions', () => {
  it('should read the legacy Claude output records of local and remote mode', () => {
    // Arrange: older CLIs sent output records. Local mode copied the JSONL record with `toolUseResult`.
    // Remote mode (claudeRemoteLauncher.ts) added `permissions`, and sdkToLogConverter.ts sent no `toolUseResult`.
    const use = (seq: number, id: string) => row(seq, output({ type: 'assistant', uuid: `a${seq}`, message: { role: 'assistant', content: [
      { type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } }));
    const rows = [use(1, 'toolu_local'),
      row(2, output({ type: 'user', uuid: 'b2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_local', content: 'ok' }] },
        toolUseResult: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } })),
      use(3, 'toolu_remote'),
      row(4, output({ type: 'user', uuid: 'b4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_remote', content: 'ok',
        permissions: { date: 1700000000000, result: 'approved', allowedTools: ['Bash(npm test)'] } }] } }))];
    // Act
    const [local, remote] = visibleMessages(rows).map((message) => message.toolCalls?.[0]);
    // Assert
    expect(local).toMatchObject({ result: { stdout: 'ok' }, resultText: 'ok' });
    expect(local?.permission).toBeUndefined();
    expect(remote).toMatchObject({ result: 'ok', permission: { status: 'approved', allowedTools: ['Bash(npm test)'] } });
    expect(resultPermission({ date: 1, result: 'later' })).toBeUndefined();
  });

  it('should show the agent-state reply on a current session-protocol tool call', () => {
    // Arrange: the current CLI maps Claude records to session envelopes (claude/utils/sessionProtocolMapper.ts).
    // Its tool-call-end carries only `call`, so the reply exists only in agentState.completedRequests.
    const envelope = (seq: number, ev: object) => row(seq, { role: 'session', content: { id: `cmh${seq}`, time: seq, role: 'agent',
      turn: 'turn-1', ev }, meta: { sentFrom: 'cli' } });
    const rows = [
      envelope(1, { t: 'tool-call-start', call: 'toolu_bash', name: 'Bash', title: 'Run tests', description: 'Run tests',
        args: { command: 'npm test', description: 'Run tests' } }),
      envelope(2, { t: 'tool-call-end', call: 'toolu_bash' }),
      envelope(3, { t: 'tool-call-start', call: 'toolu_question', name: 'AskUserQuestion', title: 'AskUserQuestion call',
        description: 'AskUserQuestion call', args: { questions: [{ question: 'Go?', header: 'Go', multiSelect: false, options: [] }] } }),
      envelope(4, { t: 'tool-call-end', call: 'toolu_question' })];
    const state = { completedRequests: {
      toolu_bash: { tool: 'Bash', arguments: { command: 'npm test' }, createdAt: 1, completedAt: 2, status: 'approved',
        allowTools: ['Bash(npm test)'], allowedTools: ['Bash(npm test)'] },
      toolu_question: { tool: 'AskUserQuestion', arguments: {}, createdAt: 3, completedAt: 4, status: 'denied' },
    } };
    // Act
    const calls = visibleMessages(rows).map((message) => message.toolCalls![0]);
    const permissions = completedPermissions(state);
    const summaries = calls.map((call) => permissionSummary(call, permissions.get(call.id)!, label));
    // Assert
    expect(calls[0]).toMatchObject({ id: 'toolu_bash', name: 'Run tests', tool: 'Bash', result: null });
    expect(summaries.map((summary) => summary.label)).toEqual(['Allowed for session', 'Dismissed']);
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
