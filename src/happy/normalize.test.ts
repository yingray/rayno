import { describe, expect, it } from 'vitest';
import {
  messageMeta,
  normalizeMachine,
  normalizeSession,
  pendingPermissions,
  visibleMessages,
  weeklyUsage,
} from './normalize';
import type { MessageRecord } from './normalize';
import { agentSubagentTurn } from './subagentEnvelopes.fixture';
import { DEFAULT_RECAP_STYLE, RECAP_REQUEST, RECAP_STYLE_LIMIT, recapPrompt, systemPrompt } from './systemPrompt';

const row = (id: string, seq: number, raw: object, localId?: string): MessageRecord => ({
  id,
  seq,
  raw,
  localId,
  createdAt: 1000,
});
describe('Happy record normalization', () => {
  it('should hide stored task notifications and preserve following user text across wire formats', () => {
    // Arrange
    const notification = '<task-notification>\n<task-id>agent-1</task-id>\n<status>completed</status>\n'
      + '<summary>Agent "Review round 10 takes" finished</summary>\n<note>A task can notify more than once.</note>\n</task-notification>';
    const rows = [
      row('legacy', 1, { role: 'user', content: { type: 'text', text: notification } }),
      row('user', 2, { role: 'session', content: { role: 'user', ev: { t: 'text', text: notification } } }),
      row('agent', 3, { role: 'session', content: { role: 'agent', ev: { t: 'text', text: notification } } }),
      row('codex', 4, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: notification } } }),
      row('followup', 5, { role: 'session', content: { type: 'session', data: {
        role: 'user', ev: { t: 'text', text: `${notification}\nContinue with the fix` },
      } } }),
      row('example', 6, { role: 'user', content: { type: 'text', text: `Explain this:\n${notification}` } }),
    ];
    // Act / Assert
    expect(visibleMessages(rows).map((message) => message.content)).toEqual([
      'Continue with the fix', `Explain this:\n${notification}`,
    ]);
  });
  it('should use the latest activity event when a stored agent state still reports work', () => {
    // Arrange
    const source = {
      wire: { id: 'session', active: true }, metadata: {}, key: null,
      agentState: { thinking: true },
    };
    // Act
    const initial = normalizeSession(source, []);
    const stopped = normalizeSession({ ...source, thinking: false }, []);
    const resumed = normalizeSession({ ...source, agentState: {}, thinking: true }, []);
    // Assert
    expect(initial.status).toBe('running');
    expect(stopped.status).toBe('idle');
    expect(resumed.status).toBe('running');
  });
  it('should use published activity or creation time without a metadata update bump', () => {
    // Arrange
    const source = {
      wire: { id: 'session', active: false, createdAt: 100, updatedAt: 9999 },
      metadata: { path: '/real/project', lastMeaningfulMessageAt: 200 },
      agentState: {}, key: null,
    };
    // Act
    const published = normalizeSession(source, []);
    const fallback = normalizeSession({ ...source, metadata: { path: '/real/project' } }, []);
    // Assert
    expect(published.lastActivityAt).toBe(200);
    expect(fallback.lastActivityAt).toBe(100);
    expect(fallback.machineOffline).toBe(false);
    expect(fallback.archived).toBe(true);
  });
  it.each([
    [{ flavor: 'claude' }, false, true],
    [{ flavor: 'codex', lifecycleState: 'running' }, false, true],
    [{ flavor: 'claude' }, true, false],
    [{ flavor: 'claude', lifecycleState: 'archived' }, true, true],
    [{ client: { id: 'rig' } }, false, false],
    [{ flavor: 'rig' }, false, false],
    [{ flavor: 'rig', lifecycleState: 'archived' }, false, true],
  ])('should classify metadata %j and presence %s with the v1 archive rule', (metadata, active, archived) => {
    // Arrange
    const source = { wire: { id: 'session', active }, metadata, agentState: {}, key: null };
    // Act
    const session = normalizeSession(source, []);
    // Assert
    expect(session.archived).toBe(archived);
  });
  it('should name a primary checkout and a nested worktree like v1', () => {
    // Arrange
    const source = {
      wire: { id: 'session', active: true, createdAt: 100, updatedAt: 200 },
      metadata: { path: '/real/project/.dev/worktree/feature/nested', gitBranch: 'branch-name' },
      agentState: {}, key: null,
    };
    // Act
    const worktree = normalizeSession(source, []);
    const primary = normalizeSession({ ...source, metadata: { path: '/real/project' } }, []);
    const named = normalizeSession({ ...source, metadata: {
      ...source.metadata, project: { name: 'Native project' }, workspace: { name: 'Named workspace' },
      isSideChat: true,
    } }, [], false, { wire: { active: false }, metadata: {}, key: null });
    // Assert
    expect(worktree).toMatchObject({ project: 'project', workspace: 'feature/nested', branch: 'branch-name' });
    expect(primary).toMatchObject({ project: 'project', workspace: 'project' });
    expect(named).toMatchObject({ project: 'Native project', workspace: 'Named workspace', isSideChat: true, machineOffline: true });
  });
  it('should order and deduplicate messages across legacy, Codex, and session envelopes', () => {
    // Arrange
    const rows = [
      row('c', 4, {
        role: 'session',
        content: { role: 'agent', ev: { t: 'text', text: 'Modern reply' } },
      }),
      row('b', 3, {
        role: 'agent',
        content: { type: 'codex', data: { type: 'message', message: 'Codex reply' } },
      }),
      row('a', 1, { role: 'user', content: { type: 'text', text: 'Hello' } }, 'same-send'),
      row('duplicate', 2, { role: 'user', content: { type: 'text', text: 'Hello' } }, 'same-send'),
      row('receipt', 5, {
        role: 'session',
        content: { role: 'agent', ev: { t: 'user-message-accepted', ref: 'a' } },
      }),
      row('tool', 6, {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Claude reply' },
                { type: 'tool_use', name: 'Read' },
              ],
            },
          },
        },
      }),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => message.content)).toEqual([
      'Hello',
      'Codex reply',
      'Modern reply',
      'Claude reply',
    ]);
    expect(messages[3].tools).toEqual(['Read']);
  });
  it('should preserve the Rig provider, model, permission, and effort for a real send', () => {
    // Arrange
    const metadata = {
      client: { id: 'rig' },
      lastMode: {
        modelId: 'same-name',
        providerId: 'provider-two',
        effort: 'high',
        permissionMode: 'plan',
        serviceTier: null,
      },
    };
    // Act
    const inherited = messageMeta(metadata, {});
    const chosen = messageMeta(metadata, {
      model: 'provider-one:another-model',
      permissionMode: 'default',
    });
    // Assert
    expect(inherited).toMatchObject({
      model: 'same-name',
      modelProviderId: 'provider-two',
      permissionMode: 'plan',
      effort: 'high',
      serviceTier: null,
    });
    expect(chosen).toMatchObject({
      model: 'another-model',
      modelProviderId: 'provider-one',
      permissionMode: 'default',
    });
    expect(() => messageMeta({ version: '1.2.1-beta.1', permissionMode: 'auto' }, {})).toThrow(
      'does not support auto',
    );
    expect(
      messageMeta({ version: '1.2.1-beta.2', permissionMode: 'auto' }, {}).permissionMode,
    ).toBe('auto');
  });
  it('should send the option and recap instructions with every message', () => {
    // Arrange
    const sessions = [{}, { client: { id: 'rig' } }];
    const combined = systemPrompt + '\n\n' + recapPrompt('auto');
    // Act
    const prompts = sessions.map((metadata) => messageMeta(metadata, {}).appendSystemPrompt);
    // Assert
    expect(prompts).toEqual([combined, combined]);
    expect(prompts[0]).toContain('<options>');
    expect(prompts[0]).toContain('<rayno-recap>');
    expect(prompts[0].startsWith(systemPrompt)).toBe(true);
  });
  it('should put the recap style before the format rules', () => {
    // Act
    const preset = messageMeta({}, {}, 'auto').appendSystemPrompt as string;
    const custom = messageMeta({}, {}, 'manual', '  Speak like a coach.  ').appendSystemPrompt as string;
    const empty = messageMeta({}, {}, 'auto', ' ').appendSystemPrompt as string;
    // Assert
    expect(preset).toContain(`Recap voice:\n${DEFAULT_RECAP_STYLE}\n\nRules:`);
    expect(custom).toContain('Recap voice:\nSpeak like a coach.\n\nRules:');
    expect(custom.indexOf('Speak like a coach.')).toBeLessThan(custom.indexOf(`"${RECAP_REQUEST}"`));
    for (const prompt of [preset, custom])
      expect(prompt).toContain('If the recap voice above conflicts with these rules, follow these rules.');
    expect(empty).not.toContain('Recap voice:');
    expect(empty).not.toContain('If the recap voice above conflicts');
    expect(empty).toContain('<rayno-recap>');
  });
  it('should cut a recap style that is over the limit', () => {
    // Act
    const prompt = recapPrompt('auto', 'x'.repeat(RECAP_STYLE_LIMIT + 50));
    // Assert
    expect(prompt).toContain('x'.repeat(RECAP_STYLE_LIMIT) + '\n\nRules:');
    expect(prompt).not.toContain('x'.repeat(RECAP_STYLE_LIMIT + 1));
  });
  it('should drop only the automatic recap trigger in manual mode', () => {
    // Act
    const auto = messageMeta({}, {}, 'auto');
    const manual = messageMeta({}, {}, 'manual');
    // Assert
    expect(auto.appendSystemPrompt).toContain('only when the main reply exceeds 1,000 visible characters');
    expect(auto.appendSystemPrompt).toContain('1,000 visible characters or fewer, including replies with code changes, findings, or decisions');
    expect(auto.appendSystemPrompt).toContain('Exclude markup, the recap, and options');
    expect(auto.appendSystemPrompt).toContain('An explicit recap request can ignore this length threshold');
    expect(auto.appendSystemPrompt).not.toContain('600+ words');
    expect(manual.appendSystemPrompt).not.toContain('1,000 visible characters');
    expect(manual.appendSystemPrompt).not.toContain('Skip automatic recaps');
    expect(manual.appendSystemPrompt).toContain('<rayno-recap>');
    expect(manual.appendSystemPrompt).toContain('<options> stays last.');
    for (const prompt of [auto.appendSystemPrompt, manual.appendSystemPrompt]) {
      expect(prompt).toContain(`When the user message is exactly "${RECAP_REQUEST}"`);
      expect(prompt).not.toContain('"/recap"');
    }
    expect({ ...manual, appendSystemPrompt: '' }).toEqual({ ...auto, appendSystemPrompt: '' });
  });
  it('should report unknown health without sample battery or latency values', () => {
    // Arrange
    const source = {
      wire: { id: 'machine', active: true },
      metadata: { host: 'Real computer', platform: 'darwin' },
      key: null,
    };
    // Act
    const machine = normalizeMachine(source);
    // Assert
    expect(machine).toMatchObject({
      name: 'Real computer',
      online: true,
      battery: null,
      latency: null,
      network: 'Not read',
    });
  });
  it('should retain an offline agent state while excluding completed permission requests', () => {
    // Arrange
    const agentState = {
      requests: { open: { tool: 'Bash', arguments: { command: 'pwd' } }, done: { tool: 'Read' } },
      completedRequests: { done: {} },
    };
    // Act
    const permissions = pendingPermissions(agentState);
    const session = normalizeSession(
      {
        wire: { id: 'session', active: false },
        metadata: { path: '/real/project', lifecycleState: 'archived' },
        agentState,
        key: null,
      },
      [],
    );
    // Assert
    expect(permissions.map((request) => request.id)).toEqual(['open']);
    expect(session.status).toBe('offline');
    expect(session.archived).toBe(true);
    expect(session.gitReported).toBe(false);
  });
  it('should calculate weekly pace from the reset time and mark an expired window stale', () => {
    // Arrange
    const now = 7 * 86400000;
    const reset = now + 3.5 * 86400000;
    // Act
    const usage = weeklyUsage(
      'Claude',
      [{ id: 'seven_day', utilization: 30, resetsAt: reset }],
      now,
      now,
    );
    const expired = weeklyUsage(
      'Claude',
      [{ id: 'seven_day', utilization: 30, resetsAt: now - 1 }],
      now,
      now,
    );
    // Assert
    expect(usage).toMatchObject({ usedPercent: 30, pacePercent: 50, stale: false });
    expect(expired?.stale).toBe(true);
    expect(weeklyUsage('Claude', [], now, now)).toBeNull();
  });
});

describe('Sent message modes', () => {
  it('should keep the modes from the meta of a user message', () => {
    // Arrange
    const rows = [
      row('m1', 1, {
        role: 'user',
        content: { type: 'text', text: 'Fix the bug' },
        meta: { sentFrom: 'web', permissionMode: 'yolo', model: 'gpt-6.1-sol', effort: 'xhigh' },
      }),
      row('m2', 2, {
        role: 'user',
        content: { type: 'text', text: 'Use the provider model' },
        meta: { sentFrom: 'web', modelProviderId: 'anthropic', model: 'claude-opus-5-5', effort: null },
      }),
      row('m3', 3, { role: 'user', content: { type: 'text', text: 'No modes' }, meta: { sentFrom: 'web', model: null } }),
    ];
    // Act
    const [first, second, third] = visibleMessages(rows);
    // Assert
    expect(first).toMatchObject({
      settings: { permissionMode: 'yolo', model: 'gpt-6.1-sol', effort: 'xhigh' },
      sentAt: 1000,
    });
    expect(second.settings).toEqual({ model: 'anthropic:claude-opus-5-5', effort: null });
    expect(third.settings).toBeUndefined();
  });
});

describe('Hidden recap requests', () => {
  it('should mark a request from the Rayno meta or the exact request text', () => {
    // Arrange
    const rows = [
      row('m1', 1, {
        role: 'user',
        content: { type: 'text', text: RECAP_REQUEST },
        meta: { sentFrom: 'web', raynoRecap: true, displayText: 'Recap', model: 'claude-opus-5' },
      }),
      row('m2', 2, { role: 'user', content: { type: 'text', text: ` ${RECAP_REQUEST}\n` } }),
      row('m3', 3, { role: 'session', content: { role: 'user', ev: { t: 'text', text: RECAP_REQUEST } } }),
      row('m4', 4, { role: 'user', content: { type: 'text', text: 'Recap your previous reply.' } }),
      row('m5', 5, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: RECAP_REQUEST } } }),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Recap', recapRequest: true, settings: { model: 'claude-opus-5' } });
    expect(messages[1]).toMatchObject({ role: 'user', recapRequest: true });
    expect(messages[2]).toMatchObject({ role: 'user', recapRequest: true });
    expect(messages[3].recapRequest).toBeUndefined();
    expect(messages[4]).toMatchObject({ role: 'assistant' });
    expect(messages[4].recapRequest).toBeUndefined();
  });
});
// Records from the Happy CLI: Claude JSONL in the legacy output wrapper, session envelopes, and ACP data.
const output = (data: object) => ({ role: 'agent', content: { type: 'output', data }, meta: { sentFrom: 'cli' } });
const claude = { userType: 'external', cwd: '/Users/kirilldubovitskiy/projects/happy/handy-cli/notes/test-project',
  sessionId: '789e105f-ae33-486d-9271-0696266f072d', version: '1.0.56', gitBranch: 'main' };
const envelope = (ev: object, extra: object = {}) => ({ role: 'session', content: {
  id: 'cmh1envelope0000000000000', time: 1000, role: 'agent', turn: 'cmh1turn00000000000000000', ...extra, ev,
}, meta: { sentFrom: 'cli' } });
const acp = (data: object) => ({ role: 'agent', content: { type: 'acp', provider: 'gemini', data }, meta: { sentFrom: 'cli' } });
describe('CLI record formats', () => {
  it('should show a prompt typed in the terminal as a user message', () => {
    // Arrange
    const rows = [row('typed', 1, output({ ...claude, parentUuid: 'deae7c10-1e9a-466a-bbd0-1cd31b43d823', isSidechain: false,
      type: 'user', message: { role: 'user', content: 'run ls tool ' }, uuid: 'ddf5d729-6843-4230-b696-3f671a2603c7',
      timestamp: '2025-07-19T22:32:45.364Z' }))];
    // Act / Assert
    expect(visibleMessages(rows)).toEqual([{ id: 'typed', role: 'user', content: 'run ls tool ' }]);
  });
  it('should skip Claude meta prompts and compact summaries', () => {
    // Arrange
    const rows = [
      row('skill', 1, output({ ...claude, type: 'user', isSidechain: false, isMeta: true, uuid: 'meta-user-1',
        message: { role: 'user', content: 'Base directory for this skill: /skills/review\n\n# Review' } })),
      row('meta', 2, output({ ...claude, type: 'assistant', isMeta: true, uuid: 'meta-assistant-1',
        message: { role: 'assistant', model: 'claude-opus-4-20250514', content: [{ type: 'text', text: 'Hidden note' }] } })),
      row('compact', 3, output({ type: 'assistant', uuid: 'compact-summary-1', isCompactSummary: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Long compaction summary' }] } })),
    ];
    // Act / Assert
    expect(visibleMessages(rows)).toEqual([]);
  });
  it('should keep Claude sidechain records out of the main thread', () => {
    // Arrange
    const sidechain = { ...claude, sessionId: 'a4e5b271-6948-4581-893b-4595c9ec41ea', version: '1.0.71', isSidechain: true };
    const rows = [
      row('task', 1, output({ ...claude, isSidechain: false, type: 'assistant', uuid: '5d5f20fb-8a18-4c39-8651-561b34ed3e4b',
        message: { role: 'assistant', model: 'claude-opus-4-1-20250805', content: [{ type: 'tool_use', id: 'toolu_01EmKA8FJ7B2Ah9seGxK1Wct',
          name: 'Task', input: { description: 'Search TypeScript 5.6 features', prompt: 'Search the web for TypeScript 5.6.' } }] } })),
      row('prompt', 2, output({ ...sidechain, parentUuid: null, type: 'user', uuid: '7e733248-6fc5-4581-b3d3-db3741158fdd',
        message: { role: 'user', content: 'Search the web for TypeScript 5.6.' } })),
      row('reply', 3, output({ ...sidechain, parentUuid: '7e733248-6fc5-4581-b3d3-db3741158fdd', type: 'assistant',
        uuid: '317a6037-41ef-4625-8d61-df44e398f533', message: { role: 'assistant', model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: '<options><option>Search more</option></options>' }] } })),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => message.id)).toEqual(['task']);
    expect(messages[0]!.tools).toEqual(['Task']);
  });
  it('should keep main replies that the CLI tags with the id of a finished subagent', () => {
    // Arrange
    const rows = agentSubagentTurn.map((raw, index) => row(raw.content.id, index + 1, raw));
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => message.content)).toEqual([
      '', 'Find the config file.', 'child result <options><option>Child</option></options>',
      'TURN1 final answer <options><option>Next</option></options>', 'TURN2 answer',
    ]);
    expect(messages[0]!.toolCalls).toMatchObject([{ id: 'toolu_agent', name: 'Find config' }]);
  });
  it('should show agent service text and skip a usage-only service event', () => {
    // Arrange
    const rows = [
      row('error', 1, envelope({ t: 'service', text: 'Error: The agent stopped because of an unknown error.' })),
      row('usage', 2, { role: 'session', content: { id: 'cmh1usage00000000000000000', time: 1000, role: 'agent',
        usage: { input_tokens: 1200, output_tokens: 80 }, ev: { t: 'service', text: '' } } }),
    ];
    // Act / Assert
    expect(visibleMessages(rows)).toEqual([
      { id: 'error', role: 'assistant', content: 'Error: The agent stopped because of an unknown error.' },
    ]);
  });
  it('should map ACP file edits to tool calls and drop terminal output that matches no call', () => {
    // Arrange
    const rows = [
      row('edit', 1, acp({ type: 'file-edit', description: 'Update the greeting', diff: '-hi\n+hello', filePath: 'src/app.ts',
        id: '0b6f3c1e-5d1a-4c55-9a3e-2f8f1d1f0b01' })),
      row('call', 2, acp({ type: 'tool-call', callId: 'call-ls', name: 'run_shell_command', input: { command: 'ls' }, id: 'tool-1' })),
      row('result', 3, acp({ type: 'tool-result', callId: 'call-ls', output: 'README.md\nsrc\n', id: 'tool-2' })),
      row('terminal', 4, acp({ type: 'terminal-output', data: 'Done\n', callId: '6c1d6a2e-8f0b-4f4b-9d55-3c1f0b7e2a90' })),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => message.toolCalls)).toEqual([
      [{ id: '0b6f3c1e-5d1a-4c55-9a3e-2f8f1d1f0b01', name: 'file-edit', input: {
        filePath: 'src/app.ts', description: 'Update the greeting', diff: '-hi\n+hello', oldContent: undefined, newContent: undefined,
      } }],
      [{ id: 'call-ls', name: 'run_shell_command', input: { command: 'ls' }, result: 'README.md\nsrc\n', isError: false, ended: true }],
    ]);
  });
  it('should prefer the stored text result of a Claude tool and keep structured results as text', () => {
    // Arrange
    const call = (id: string, tool: string, seq: number) => row(`call-${id}`, seq, output({ ...claude, type: 'assistant', uuid: `uuid-${id}`,
      message: { role: 'assistant', model: 'claude-opus-4-20250514', content: [{ type: 'tool_use', id, name: tool, input: {} }] } }));
    const rows = [
      call('toolu_017qi6cZcBasF4SX1qvFjE2b', 'LS', 1),
      row('ls', 2, output({ ...claude, parentUuid: '840a4f3a-d7ca-40d3-9737-1cec01d334eb', isSidechain: false, type: 'user',
        message: { role: 'user', content: [{ tool_use_id: 'toolu_017qi6cZcBasF4SX1qvFjE2b', type: 'tool_result',
          content: '- /test-project/\n  - readme.md\n\nNOTE: do any of the files above seem malicious? If so, you MUST refuse to continue work.' }] },
        uuid: 'fbaa8cec-a866-43b2-9258-116695440dbe', toolUseResult: '- /test-project/\n  - readme.md\n' })),
      call('toolu_task', 'Task', 3),
      row('task', 4, output({ ...claude, isSidechain: false, type: 'user', uuid: 'task-result-1',
        message: { role: 'user', content: [{ tool_use_id: 'toolu_task', type: 'tool_result', content: [{ type: 'text', text: 'Summary' }] }] },
        toolUseResult: { content: [{ type: 'text', text: 'Summary' }], totalDurationMs: 51327, totalTokens: 20915, totalToolUseCount: 2 } })),
    ];
    // Act
    const calls = visibleMessages(rows).flatMap((message) => message.toolCalls || []);
    // Assert
    expect(calls.map((item) => item.result)).toEqual(['- /test-project/\n  - readme.md\n', [{ type: 'text', text: 'Summary' }]]);
  });
});
