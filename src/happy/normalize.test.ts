import { describe, expect, it } from 'vitest';
import {
  markSubagents,
  restoreBoundsRange,
  restoreSubagentMarks,
  saveSubagentMarks,
  subagentOf,
  trustedSubagentMarks,
  contextUsage,
  messageMeta,
  normalizeMachine,
  normalizeSession,
  pendingPermissions,
  visibleMessages,
  planUsage,
} from './normalize';
import type { MessageRecord } from './normalize';
import { agentSubagentTurn, agentSubagentWork, codexCollabTurn, codexReasoningSection, taskSubagentTurn } from './subagentEnvelopes.fixture';
import { groupChatActivity } from '../data/chatBlocks';
import { claudeWindows, codexWindows } from './manualUsage';
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
      row('agent', 3, { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: notification } } }),
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
  it('should read the side chat parent link that happy-cli runClaude writes into metadata', () => {
    // Arrange: HAPPY_FORKED_FROM_SESSION_ID and HAPPY_SIDE_CHAT become these metadata fields.
    const source = {
      wire: { id: 'side', active: true, createdAt: 100, updatedAt: 200 },
      metadata: { path: '/real/project', flavor: 'claude', parentSessionId: 'parent', isSideChat: true },
      agentState: {}, key: null,
    };
    // Act
    const sideChat = normalizeSession(source, []);
    const titled = normalizeSession({ ...source, metadata: { ...source.metadata, summary: { text: 'Check the parser' } } }, []);
    const fork = normalizeSession({ ...source, metadata: { path: '/real/project', parentSessionId: 'parent' } }, []);
    // Assert
    expect(sideChat).toMatchObject({ isSideChat: true, parentSessionId: 'parent', title: 'Side chat' });
    expect(titled.title).toBe('Check the parser');
    expect(fork).toMatchObject({ isSideChat: false, parentSessionId: 'parent', title: 'project' });
  });
  it('should close a side chat only by its archived lifecycle and not by a lost connection', () => {
    // Arrange: the server sets active=false after missed keepalives (presence/timeout.ts); a close writes lifecycleState.
    const metadata = { path: '/real/project', flavor: 'claude', parentSessionId: 'parent', isSideChat: true, lifecycleState: 'running' };
    const ended = { wire: { id: 'side', active: false, createdAt: 100, updatedAt: 200 }, metadata, agentState: {}, key: null };
    // Act
    const open = normalizeSession(ended, []);
    const closed = normalizeSession({ ...ended, metadata: { ...metadata, lifecycleState: 'archived' } }, []);
    const fork = normalizeSession({ ...ended, metadata: { ...metadata, isSideChat: undefined, lifecycleState: 'archived' } }, []);
    // Assert
    expect(open).toMatchObject({ archived: true, sideChatClosed: false });
    expect(closed).toMatchObject({ archived: true, sideChatClosed: true });
    expect(fork).toMatchObject({ archived: true, sideChatClosed: false });
  });
  it('should order and deduplicate messages across legacy, Codex, and session envelopes', () => {
    // Arrange
    const rows = [
      row('c', 4, {
        role: 'session',
        content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'Modern reply' } },
      }),
      row('b', 3, {
        role: 'agent',
        content: { type: 'codex', data: { type: 'message', message: 'Codex reply' } },
      }),
      row('a', 1, { role: 'user', content: { type: 'text', text: 'Hello' } }, 'same-send'),
      row('duplicate', 5, { role: 'user', content: { type: 'text', text: 'Hello' } }, 'same-send'),
      // The receipt directly follows its message, so the message keeps its place.
      row('receipt', 2, {
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
    const usage = planUsage(
      'Claude',
      [{ id: 'seven_day', utilization: 30, resetsAt: reset }],
      now,
      now,
    );
    const expired = planUsage(
      'Claude',
      [{ id: 'seven_day', utilization: 30, resetsAt: now - 1 }],
      now,
      now,
    );
    // Assert
    expect(usage).toMatchObject({ week: { usedPercent: 30, pacePercent: 50 }, stale: false });
    expect(expired?.stale).toBe(true);
    expect(planUsage('Claude', [], now, now)).toBeNull();
  });
  it('should keep the 5-hour window next to the weekly window', () => {
    // Arrange
    const now = 7 * 86400000;
    const rateLimits = {
      five_hour: { utilization: 41.6, resets_at: new Date(now + 2.5 * 3600000).toISOString() },
      seven_day: { utilization: 30, resets_at: new Date(now + 3.5 * 86400000).toISOString() },
      seven_day_opus: null,
    };
    const codex = { rateLimits: {
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: (now + 4 * 3600000) / 1000 },
      secondary: { usedPercent: 64, windowDurationMins: 10080, resetsAt: (now + 86400000) / 1000 },
    } };
    // Act
    const claude = planUsage('Claude', claudeWindows(rateLimits), now, now);
    const codexReading = planUsage('Codex', codexWindows(codex), now, now);
    const weekOnly = planUsage('Claude', claudeWindows({ seven_day: rateLimits.seven_day }), now, now);
    // Assert
    expect(claude).toMatchObject({ week: { usedPercent: 30, pacePercent: 50 }, fiveHour: { usedPercent: 42, pacePercent: 50 } });
    expect(codexReading).toMatchObject({ week: { usedPercent: 64 }, fiveHour: { usedPercent: 12, pacePercent: 20, resetAt: now + 4 * 3600000 } });
    expect(weekOnly).not.toHaveProperty('fiveHour');
  });
  it('should keep a 5-hour window when the provider reports no weekly window', () => {
    // Arrange
    const now = 7 * 86400000;
    // A Claude get_usage reading with only the session window, and a Codex bucket with only its primary window.
    const rateLimits = {
      five_hour: { utilization: 41.6, resets_at: new Date(now + 2.5 * 3600000).toISOString() },
      seven_day: null,
    };
    const codex = { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: (now + 4 * 3600000) / 1000 }, secondary: null } };
    // Act
    const claude = planUsage('Claude', claudeWindows(rateLimits), now, now);
    const codexReading = planUsage('Codex', codexWindows(codex), now, now);
    const expired = planUsage('Claude', claudeWindows({ five_hour: { utilization: 80, resets_at: new Date(now - 1).toISOString() } }), now, now);
    // Assert
    expect(claude).toMatchObject({ agent: 'Claude', fiveHour: { usedPercent: 42, pacePercent: 50 }, stale: false });
    expect(claude).not.toHaveProperty('week');
    expect(codexReading).toMatchObject({ fiveHour: { usedPercent: 12, pacePercent: 20, resetAt: now + 4 * 3600000 } });
    expect(codexReading).not.toHaveProperty('week');
    expect(expired?.stale).toBe(true);
    expect(planUsage('Claude', claudeWindows({ seven_day: null, extra_usage: { utilization: 5 } }), now, now)).toBeNull();
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
      '', 'TURN1 final answer <options><option>Next</option></options>', 'TURN2 answer',
    ]);
    expect(messages[0]!.toolCalls).toMatchObject([{ id: 'toolu_agent', name: 'Find config' }]);
    expect(messages[0]!.toolCalls![0].children!.map((child) => child.content)).toEqual([
      'child result <options><option>Child</option></options>',
    ]);
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
  it('should prefer the stored Claude tool result and keep the model text of a structured result', () => {
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
    expect(calls.map((item) => item.result)).toEqual(['- /test-project/\n  - readme.md\n',
      { content: [{ type: 'text', text: 'Summary' }], totalDurationMs: 51327, totalTokens: 20915, totalToolUseCount: 2 }]);
    expect(calls.map((item) => item.resultText)).toEqual([expect.stringContaining('NOTE: do any of the files'), 'Summary']);
  });
});

const rowsOf = (raws: { content: { id: string } }[], first = 1) => raws.map((raw, index) => row(raw.content.id, first + index, raw));
describe('Subagent work in session envelopes', () => {
  it('should put subagent text and tools under the parent Agent call and keep the main answer', () => {
    // Arrange
    const rows = rowsOf(agentSubagentWork);
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => [message.role, message.content, message.thinking, message.tools])).toEqual([
      ['user', 'Check the config', undefined, undefined],
      ['assistant', '', 'I should delegate the search.', undefined],
      ['assistant', '', undefined, ['Find config']],
      ['assistant', '', 'Now answer the user.', undefined],
      ['assistant', 'The config is config.json. <options><option>Open it</option></options>', undefined, undefined],
    ]);
    const [agent] = messages[2]!.toolCalls!;
    expect(agent).toMatchObject({ id: 'toolu_agent', input: { sessionSubagent: 'c744020fe7d250cca47a5ae1' } });
    expect(agent.children!.map((child) => [child.thinking ?? child.content, child.toolCalls?.map((call) => call.name)])).toEqual([
      ['Look in the root first.', undefined],
      ['', ['Glob call']],
      ['Subagent found config.json <options><option>Child option</option></options>', undefined],
    ]);
  });
  it('should keep the work of a running subagent out of the main thread', () => {
    // Arrange
    const stop = agentSubagentWork.findIndex((raw) => raw.content.ev.t === 'stop');
    // Act
    const messages = visibleMessages(rowsOf(agentSubagentWork.slice(0, stop)));
    // Assert
    expect(messages.map((message) => message.content)).toEqual(['Check the config', '', '']);
    expect(messages[2]!.toolCalls![0].children!.at(-1)!.content).toContain('Subagent found config.json');
  });
  it('should show Task work without a parent call on its own row', () => {
    // Act
    const messages = visibleMessages(rowsOf(taskSubagentTurn));
    // Assert
    expect(messages.map((message) => [message.content, message.tools])).toEqual([
      ['Search the docs', undefined], ['', ['Search docs']], ['TypeScript 5.6 adds iterator helpers.', undefined],
    ]);
    expect(messages[1]!.toolCalls![0].children!.map((child) => child.content)).toEqual([
      'Search the docs for TypeScript 5.6.', 'TypeScript 5.6 adds iterator helpers. <options><option>Task option</option></options>',
    ]);
  });
  it('should drop a prompt echo only when it is the first subagent row', () => {
    // Arrange
    const rows = rowsOf(agentSubagentWork);
    const echo = rows.findIndex((item) => item.raw.content.subagent && item.raw.content.ev.text === 'Find the config file.');
    const swapped = [...rows.slice(0, echo), rows[echo + 1]!, rows[echo]!, ...rows.slice(echo + 2)]
      .map((item, index) => ({ ...item, seq: index + 1 }));
    // Act
    const children = (list: typeof swapped) => visibleMessages(list)[2]!.toolCalls![0].children!
      .map((child) => child.thinking ?? child.tools?.[0] ?? child.content);
    // Assert
    expect(children(rows).slice(0, 2)).toEqual(['Look in the root first.', 'Glob call']);
    expect(children(swapped).slice(0, 2)).toEqual(['Look in the root first.', 'Find the config file.']);
  });
  it('should show each Codex subagent row once, under the latest collab call before it', () => {
    // Act
    const messages = visibleMessages(rowsOf(codexCollabTurn));
    // Assert
    expect(messages.map((message) => [message.content, message.thinking, message.tools])).toEqual([
      ['', 'Delegate the auth review.', undefined],
      ['', undefined, ['Inspect auth flow']],
      ['', undefined, ['Wait for Codex subagent']],
      ['The auth handler is in src/auth.ts. <options><option>Open it</option></options>', undefined, undefined],
    ]);
    const [spawn, wait] = [messages[1]!.toolCalls![0], messages[2]!.toolCalls![0]];
    expect(spawn.children!.map((child) => child.thinking ?? child.tools?.[0] ?? child.content)).toEqual([
      'Read the login handler.', 'Run `rg login`', 'Found the auth handler. <options><option>Child option</option></options>',
    ]);
    expect(wait.children!.map((child) => child.content)).toEqual(['Codex subagent completed: found auth handler']);
  });
  it('should give subagent rows that come before every parent call to the first call', () => {
    // Arrange
    const rows = rowsOf(codexCollabTurn);
    const spawn = rows.findIndex((item) => item.raw.content.ev.call === 'call_spawn');
    const child = rows.findIndex((item) => item.raw.content.ev.t === 'tool-call-start' && item.raw.content.ev.call === 'call_rg');
    // Act
    const messages = visibleMessages([...rows.slice(0, spawn), ...rows.slice(spawn + 1, child + 1), rows[spawn]!,
      ...rows.slice(child + 1)].map((item, index) => ({ ...item, seq: index + 1 })));
    // Assert
    const calls = messages.flatMap((message) => message.toolCalls || []);
    expect(calls.map((call) => [call.name, call.children?.map((item) => item.thinking ?? item.tools?.[0] ?? item.content)])).toEqual([
      ['Inspect auth flow', ['Read the login handler.', 'Run `rg login`', 'Found the auth handler. <options><option>Child option</option></options>']],
      ['Wait for Codex subagent', ['Codex subagent completed: found auth handler']],
    ]);
  });
  it('should place tagged rows from the bounds on the loaded pages', () => {
    // Arrange
    const rows = rowsOf(agentSubagentWork);
    const stop = rows.findIndex((item) => item.raw.content.ev.t === 'stop');
    // Act
    const newest = visibleMessages(rows.slice(stop + 1));
    const withStop = visibleMessages(rows.slice(stop - 1));
    // Assert
    expect(newest.map((message) => message.tools?.[0] ?? message.thinking ?? message.content)).toEqual([
      'Earlier tool call', 'Now answer the user.', 'The config is config.json. <options><option>Open it</option></options>',
    ]);
    expect(withStop.map((message) => message.tools?.[0] ?? message.thinking ?? message.content)).toEqual([
      'Subagent', 'Earlier tool call', 'Now answer the user.', 'The config is config.json. <options><option>Open it</option></options>',
    ]);
    expect(withStop[0]!.toolCalls![0].children!.map((child) => child.content)).toEqual([
      'Subagent found config.json <options><option>Child option</option></options>',
    ]);
    expect(markSubagents(new Map(), rows).get('c744020fe7d250cca47a5ae1')).toEqual({
      title: 'Find config', bounds: new Map([[rows[4].seq, true], [rows[stop].seq, false]]),
    });
  });
  it('should restore saved bounds so rows of a running subagent stay out of the main thread on a later page', () => {
    // Arrange
    const rows = rowsOf(agentSubagentWork);
    const stop = rows.findIndex((item) => item.raw.content.ev.t === 'stop');
    const saved = JSON.parse(JSON.stringify(saveSubagentMarks(markSubagents(new Map(), rows.slice(0, stop - 1)))));
    // Act
    const restored = restoreSubagentMarks([...saved, { id: 'damaged', bounds: [[-1, true], ['5', false]] }, { bounds: [[1, true]] }, 'broken']);
    // Assert
    expect(saved).toEqual([{ id: 'c744020fe7d250cca47a5ae1', title: 'Find config', bounds: [[rows[4].seq, true]] }]);
    expect([...restored.keys()]).toEqual(['c744020fe7d250cca47a5ae1']);
    expect(subagentOf(rows[stop - 1], restored)).toBe('c744020fe7d250cca47a5ae1');
    expect(subagentOf(rows[stop - 1], new Map())).toBeUndefined();
    expect(subagentOf(rows[stop + 3], markSubagents(restored, rows.slice(stop + 3)))).toBe('c744020fe7d250cca47a5ae1');
    expect(subagentOf(rows[stop + 3], markSubagents(restored, rows.slice(stop)))).toBeUndefined();
  });
  it('should drop an open start below the read range so a tagged main answer after an unread stop stays main', () => {
    // Arrange
    const rows = rowsOf(agentSubagentWork);
    const start = rows.findIndex((item) => item.raw.content.ev.t === 'start');
    const stop = rows.findIndex((item) => item.raw.content.ev.t === 'stop');
    const answer = rows.findIndex((item) => item.raw.content.ev.text?.startsWith('The config is config.json.'));
    const open = markSubagents(new Map(), rows.slice(0, stop));
    const closed = markSubagents(new Map(), rows);
    // Act
    const unread = trustedSubagentMarks(open, rows[stop + 1].seq);
    const read = trustedSubagentMarks(open, rows[start].seq);
    // Assert
    expect(subagentOf(rows[answer], open)).toBe('c744020fe7d250cca47a5ae1');
    expect(subagentOf(rows[answer], unread)).toBeUndefined();
    expect(subagentOf(rows[stop - 1], read)).toBe('c744020fe7d250cca47a5ae1');
    expect(read).toBe(open);
    // A known stop closes the range, so the bounds count from any read range.
    expect(trustedSubagentMarks(closed, rows[answer].seq)).toBe(closed);
    expect(subagentOf(rows[answer], closed)).toBeUndefined();
    expect([restoreBoundsRange([0, 9]), restoreBoundsRange([9, 3]), restoreBoundsRange([-1, 3]), restoreBoundsRange('0-9')])
      .toEqual([{ from: 0, to: 9 }, undefined, undefined, undefined]);
  });
});
describe('Agent envelopes without a turn', () => {
  it('should drop agent rows without a turn and keep user rows, receipts, and usage-only events out of the chat', () => {
    // Arrange
    const rows = [
      row('user', 1, { role: 'session', content: { id: 'cmh1user000000000000000000', time: 1000, role: 'user', ev: { t: 'text', text: 'Hello' } } }),
      row('stray', 2, { role: 'session', content: { id: 'cmh1stray00000000000000000', time: 1000, role: 'agent', ev: { t: 'text', text: 'Stray reply' } } }),
      row('tool', 3, { role: 'agent', content: { type: 'session', data: { id: 'cmh1tool000000000000000000', time: 1000, role: 'agent',
        ev: { t: 'tool-call-start', call: 'c1', name: 'Read', title: 'Read', description: 'Read', args: {} } } } }),
      row('receipt', 4, { role: 'session', content: { id: 'cmh1receipt000000000000000', time: 1000, role: 'agent',
        ev: { t: 'user-message-accepted', id: 'cmh1receipt000000000000000', ref: 'user', runId: 'run-1' } } }),
      row('reply', 5, envelope({ t: 'text', text: 'Turn reply' })),
    ];
    // Act / Assert
    expect(visibleMessages(rows).map((message) => message.content)).toEqual(['Hello', 'Turn reply']);
  });
});
describe('Thinking records', () => {
  it('should keep thinking apart from the reply text across Claude, session, Codex, and ACP records', () => {
    // Arrange
    const rows = [
      row('claude', 1, output({ ...claude, type: 'assistant', uuid: 'claude-thinking-1', message: { role: 'assistant', model: 'claude-opus-4-20250514',
        content: [{ type: 'thinking', thinking: 'Check the README first.', signature: 'sig' }, { type: 'text', text: 'The README is current.' }] } })),
      row('session', 2, envelope({ t: 'text', text: 'Plan the next step.', thinking: true })),
      row('codex', 3, { role: 'agent', content: { type: 'codex', data: { type: 'reasoning', message: 'Compare the two files.' } } }),
      row('answer', 4, envelope({ t: 'text', text: 'Both files match. <options><option>Done</option></options>' })),
      row('acp-reasoning', 5, acp({ type: 'reasoning', message: 'Read the log.' })),
      row('acp-1', 6, acp({ type: 'thinking', text: 'The log shows ' })),
      row('acp-2', 7, acp({ type: 'thinking', text: 'a timeout.' })),
      row('acp-answer', 8, acp({ type: 'message', message: 'The request timed out.' })),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => [message.content, message.thinking])).toEqual([
      ['The README is current.', 'Check the README first.'],
      ['', 'Plan the next step.\n\nCompare the two files.'],
      ['Both files match. <options><option>Done</option></options>', undefined],
      ['', 'Read the log.\n\nThe log shows a timeout.'],
      ['The request timed out.', undefined],
    ]);
  });
  it('should hide titled reasoning calls and keep their text as thinking, not as a tool', () => {
    // Arrange
    const call = { type: 'tool-call', name: 'GeminiReasoning', callId: 'b3c1d2e4-5f60-4718-9a2b-3c4d5e6f7a80',
      input: { title: 'Checking the log' }, id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' };
    const result = { type: 'tool-call-result', callId: call.callId, output: { content: 'The log shows a timeout.', status: 'completed' },
      id: 'c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f' };
    const rows = [
      ...rowsOf(codexReasoningSection),
      row('answer', 4, envelope({ t: 'text', text: 'The parser is fine.' })),
      row('gemini-call', 5, acp(call)),
      row('gemini-result', 6, acp(result)),
      row('gemini-answer', 7, acp({ type: 'message', message: 'The request timed out.' })),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.map((message) => [message.content, message.thinking, message.tools])).toEqual([
      ['', 'Check the parser first.', undefined],
      ['The parser is fine.', undefined, undefined],
      ['', 'The log shows a timeout.', undefined],
      ['The request timed out.', undefined, undefined],
    ]);
    expect(groupChatActivity(messages).map((block) => block.kind)).toEqual(['thinking', 'message', 'thinking', 'message']);
  });
});

describe('Context usage', () => {
  // Shapes from happy-cli SDKToLogConverter (Claude output), the Claude session mapper, and the Codex token_count mapper.
  const at = (record: MessageRecord, createdAt: number) => ({ ...record, createdAt });
  const claudeOutput = (id: string, seq: number, usage: object, isSidechain = false) => row(id, seq, {
    role: 'agent', content: { type: 'output', data: {
      type: 'assistant', uuid: `${id}-uuid`, parentUuid: null, isSidechain,
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Done' }], usage },
    } },
  });
  const envelope = (id: string, seq: number, time: number, fields: object) => row(id, seq, {
    role: 'session', content: { id, time, role: 'agent', ...fields }, meta: { sentFrom: 'cli' },
  });
  const event = (id: string, seq: number, message: string) =>
    row(id, seq, { role: 'agent', content: { id, type: 'event', data: { type: 'message', message } } });

  it('should count input, cache creation, and cache reads against the reported window', () => {
    // Arrange
    const rows = [
      at(claudeOutput('a', 1, { input_tokens: 1200, cache_creation_input_tokens: 40, cache_read_input_tokens: 500, output_tokens: 80 }), 1000),
      at(claudeOutput('b', 2, { input_tokens: 10422, cache_read_input_tokens: 113536, output_tokens: 2140, context_window: 258400 }), 2000),
    ];
    // Act / Assert
    expect(contextUsage(rows.slice(0, 1))).toEqual({ size: 1740 });
    expect(contextUsage(rows)).toEqual({ size: 123958, window: 258400 });
    expect(contextUsage(rows.map((record) => at(record, 1000)))).toEqual({ size: 123958, window: 258400 });
    expect(contextUsage([at(claudeOutput('c', 3, { input_tokens: 5 }), 3000)])).toBeUndefined();
  });
  it('should read usage-only Codex envelopes and ignore subagent usage and older readings', () => {
    // Arrange
    const usage = { input_tokens: 9000, output_tokens: 300, cache_read_input_tokens: 1000, context_window: 272000 };
    const subagent = 'c744020fe7d250cca47a5ae1';
    const rows = [
      envelope('main', 1, 5000, { turn: 't1', usage, ev: { t: 'text', text: 'Main reply' } }),
      envelope('start', 2, 5500, { turn: 't1', subagent, ev: { t: 'start', title: 'Find config' } }),
      envelope('child', 3, 6000, { turn: 't1', subagent, usage: { ...usage, input_tokens: 90000 }, ev: { t: 'text', text: 'Child' } }),
      envelope('stop', 4, 6100, { turn: 't1', subagent, ev: { t: 'stop' } }),
      envelope('late', 5, 4000, { usage: { ...usage, input_tokens: 1 }, ev: { t: 'service', text: '' } }),
    ];
    // The mapper tags the main answer after the stop with the subagent id too.
    const answer = envelope('answer', 6, 7000, { turn: 't1', subagent, usage: { ...usage, input_tokens: 20000 }, ev: { t: 'text', text: 'Answer' } });
    // Act / Assert
    expect(contextUsage(rows)).toEqual({ size: 10000, window: 272000 });
    expect(contextUsage([...rows, answer])).toEqual({ size: 21000, window: 272000 });
    expect(visibleMessages(rows).map((message) => message.content)).toEqual(['Main reply', '']);
  });
  it('should clear the context after a reset or a compaction until the next reply', () => {
    // Arrange
    const reply = at(claudeOutput('a', 1, { input_tokens: 50000, output_tokens: 10, context_window: 200000 }), 1000);
    // Act / Assert
    expect(contextUsage([reply, at(event('reset', 2, 'Context was reset'), 2000)])).toEqual({ size: 0 });
    expect(contextUsage([reply, at(event('compact', 2, 'Compaction completed'), 2000),
      at(claudeOutput('b', 3, { input_tokens: 3000, output_tokens: 10, context_window: 200000 }), 3000)])).toEqual({ size: 3000, window: 200000 });
    expect(contextUsage([at(claudeOutput('c', 1, { input_tokens: 9, output_tokens: 1 }, true), 1000)])).toBeUndefined();
  });
});

describe('Agent event rows', () => {
  // happy-cli api/apiSession.ts sendSessionEvent: { role: 'agent', content: { id, type: 'event', data } }.
  const sessionEvent = (id: string, seq: number, data: object) =>
    row(id, seq, { role: 'agent', content: { id: `event-${id}`, type: 'event', data } });
  it('should keep the events that Happy Web shows as rows without content', () => {
    // Arrange
    const rows = [
      row('user', 1, { role: 'user', content: { type: 'text', text: 'Start' } }),
      sessionEvent('local', 2, { type: 'switch', mode: 'local' }),
      sessionEvent('remote', 3, { type: 'switch', mode: 'remote' }),
      sessionEvent('abort', 4, { type: 'message', message: 'Aborted by user' }),
      sessionEvent('reset', 5, { type: 'message', message: 'Context was reset' }),
      sessionEvent('limit', 6, { type: 'limit-reached', endsAt: 1760000000 }),
    ];
    // Act
    const messages = visibleMessages(rows);
    // Assert
    expect(messages.slice(1)).toEqual([
      { id: 'local', role: 'assistant', content: '', event: { type: 'switch', mode: 'local' } },
      { id: 'remote', role: 'assistant', content: '', event: { type: 'switch', mode: 'remote' } },
      { id: 'abort', role: 'assistant', content: '', event: { type: 'message', message: 'Aborted by user' } },
      { id: 'reset', role: 'assistant', content: '', contextReset: true, event: { type: 'message', message: 'Context was reset' } },
      { id: 'limit', role: 'assistant', content: '', event: { type: 'limit-reached', endsAt: 1760000000 } },
    ]);
  });
  it('should show no row for ready, turn start, unknown, or malformed events', () => {
    // Arrange
    const rows = [
      sessionEvent('ready', 1, { type: 'ready' }),
      sessionEvent('turn', 2, { type: 'message', message: 'Turn started' }),
      sessionEvent('mode', 3, { type: 'permission-mode-changed', mode: 'plan' }),
      sessionEvent('bad-switch', 4, { type: 'switch', mode: 'cloud' }),
      sessionEvent('empty', 5, { type: 'message', message: '  ' }),
    ];
    // Act / Assert
    expect(visibleMessages(rows)).toEqual([]);
  });
  it('should turn the Claude usage limit text into a limit event row', () => {
    // Arrange
    const limit = row('limit', 1, { role: 'agent', content: { type: 'output', data: {
      type: 'assistant', uuid: 'u1', parentUuid: null, isSidechain: false,
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Claude AI usage limit reached|1760000000' }] },
    } } });
    const quoted = row('quoted', 2, { role: 'agent', content: { type: 'output', data: {
      type: 'assistant', uuid: 'u2', parentUuid: 'u1', isSidechain: false,
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'It said: Claude AI usage limit reached|1760000000' }] },
    } } });
    // Act
    const messages = visibleMessages([limit, quoted]);
    // Assert
    expect(messages[0]).toEqual({ id: 'limit', role: 'assistant', content: '', event: { type: 'limit-reached', endsAt: 1760000000 } });
    expect(messages[1]).toMatchObject({ content: 'It said: Claude AI usage limit reached|1760000000' });
    expect(messages[1]).not.toHaveProperty('event');
  });
});
