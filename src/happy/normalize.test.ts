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
    expect(auto.appendSystemPrompt).toContain('When your reply is long');
    expect(auto.appendSystemPrompt).toContain('Skip the recap for short replies');
    expect(manual.appendSystemPrompt).not.toContain('When your reply is long');
    expect(manual.appendSystemPrompt).not.toContain('Skip the recap for short replies');
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
