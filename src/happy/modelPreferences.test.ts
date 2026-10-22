import { describe, expect, it } from 'vitest';
import { createInitialState } from '../data/fixtures';
import { demoReducer, restoreState } from '../data/reducer';
import { isConcreteModel, modelOptions } from './modelOptions';
import { latestAgentMode, latestSentModes, modeBeforePlan, modelChoiceKey, rankSessionModes, recentModelChoice, resolveModelChoice } from './modelPreferences';
import { visibleMessages, type MessageRecord } from './normalize';

describe('Concrete model preferences', () => {
  it('should replace legacy defaults with a concrete model and supported effort', () => {
    // Arrange / Act
    const choices = modelOptions({ flavor: 'codex', models: [{ id: 'default', name: 'Agent default' }] });
    const resolved = resolveModelChoice({ flavor: 'codex' }, [{ model: 'Agent default', effort: null }]);
    // Assert
    expect(choices.every((choice) => isConcreteModel(choice.value))).toBe(true);
    expect(choices.some((choice) => choice.label === 'Agent default')).toBe(false);
    expect(resolved).toMatchObject({ effort: 'high' });
    expect(isConcreteModel(resolved.model)).toBe(true);
  });

  it('should reuse the last valid choice and replace a removed model or unsupported effort', () => {
    // Arrange
    const metadata = { flavor: 'claude', models: [{ id: 'one', name: 'One', thinkingLevels: ['low', 'high'] }] };
    // Act / Assert
    expect(resolveModelChoice(metadata, [{ model: 'one', effort: 'low' }])).toEqual({ model: 'one', effort: 'low' });
    expect(resolveModelChoice(metadata, [{ model: 'removed', effort: 'max' }])).toEqual({ model: 'one', effort: 'high' });
    expect(resolveModelChoice(metadata, [{ model: 'one', effort: 'ultra' }])).toEqual({ model: 'one', effort: 'high' });
  });

  it('should keep provider and computer scopes distinct and read the most recent matching session', () => {
    // Arrange
    const base = createInitialState(1000000).sessions[0];
    const sessions = [
      { ...base, id: 'old', model: 'claude-opus-5', lastActivityAt: 10 },
      { ...base, id: 'new', model: 'claude-fable-5', effort: 'max', lastActivityAt: 20 },
      { ...base, id: 'codex', agent: 'Codex' as const, model: 'gpt-6-astra', lastActivityAt: 30 },
    ];
    // Act / Assert
    expect(recentModelChoice(sessions, 'Claude', 'mbp')).toEqual({ model: 'claude-fable-5', effort: 'max' });
    expect(modelChoiceKey('Claude', 'one')).not.toBe(modelChoiceKey('Codex', 'one'));
    expect(modelChoiceKey('Happy Agent', 'one')).not.toBe(modelChoiceKey('Happy Agent', 'two'));
    expect(modelChoiceKey('Codex', 'one')).toBe(modelChoiceKey('Codex', 'two'));
  });

  it('should not invent a model for an empty catalog or override a locked reported model', () => {
    // Arrange / Act / Assert
    expect(resolveModelChoice({ flavor: 'rig', client: { id: 'rig' } })).toEqual({ model: '', effort: null });
    expect(resolveModelChoice({ flavor: 'claude', currentModelCode: 'locked', session: { modelLocked: true }, capabilities: { reasoningSelection: false } },
      [{ model: 'claude-opus-5', effort: 'high' }])).toEqual({ model: 'locked', effort: null });
  });

  it('should restore per-agent choices and the last CLI agent without sharing invalid entries', () => {
    // Arrange
    const state = createInitialState(1000000);
    const selected = demoReducer(state, { type: 'rememberModel', key: 'Codex', value: { model: 'gpt-6-astra', effort: 'max' } });
    // Act
    const restored = restoreState(JSON.stringify({ ...selected, modelChoices: { ...selected.modelChoices, invalid: { model: 5 } } }), state);
    // Assert
    expect(restored.modelChoices).toEqual({ Codex: { model: 'gpt-6-astra', effort: 'max' } });
    expect(restored.lastAgent).toBe('Codex');
  });
});

describe('Session composer modes', () => {
  const sent = { model: 'gpt-6.1-sol', effort: 'xhigh', permissionMode: 'yolo', sentAt: 2000 };

  it('should read the modes of the last user message that carries them', () => {
    // Arrange
    const messages = [
      { id: 'a', role: 'user' as const, content: 'one', settings: { model: 'old' }, sentAt: 1000 },
      { id: 'b', role: 'user' as const, content: 'two', settings: { model: 'gpt-6.1-sol', effort: 'xhigh' }, sentAt: 2000 },
      { id: 'c', role: 'user' as const, content: 'three' },
      { id: 'd', role: 'assistant' as const, content: 'done' },
    ];
    // Act / Assert
    expect(latestSentModes(messages)).toEqual({ model: 'gpt-6.1-sol', effort: 'xhigh', sentAt: 2000 });
    expect(latestSentModes([])).toBeUndefined();
  });

  it('should show the sent modes when metadata reports none and an older build saved other values', () => {
    // Arrange
    const metadata = { flavor: 'codex' };
    const legacy = { model: 'gpt-5.6-sol', effort: 'medium', permission: 'default' };
    // Act
    const ranked = rankSessionModes(legacy, sent);
    const choice = resolveModelChoice(metadata, [...ranked.modelCandidates, ranked.legacy]);
    // Assert
    expect(choice).toEqual({ model: 'gpt-6.1-sol', effort: 'xhigh' });
    expect(ranked.permission).toBe('yolo');
    expect(ranked.legacy).toBe(legacy);
  });

  it('should keep a pick that is newer than the last sent message', () => {
    // Act
    const ranked = rankSessionModes({ model: 'gpt-5.6-sol', effort: 'low', permission: null, at: 3000 }, sent);
    // Assert
    expect(ranked.modelCandidates[0]).toMatchObject({ model: 'gpt-5.6-sol', effort: 'low' });
    expect(ranked.permission).toBeNull();
  });

  it('should prefer a message that is newer than the pick, for example one sent from another device', () => {
    // Act
    const ranked = rankSessionModes({ model: 'gpt-5.6-sol', effort: 'low', permission: 'default', at: 1000 }, sent);
    // Assert
    expect(ranked.modelCandidates[0]).toEqual({ model: 'gpt-6.1-sol', effort: 'xhigh' });
    expect(ranked.permission).toBe('yolo');
  });

  it('should keep a pick for agent mode after a message repeats the inherited mode', () => {
    // Arrange
    const picked = { model: 'gpt-6.1-sol', effort: 'xhigh', permission: null, at: 1000 };
    // Act
    const ranked = rankSessionModes(picked, sent, 'yolo');
    // Assert
    expect(ranked.permission).toBeNull();
    expect(rankSessionModes(picked, sent, 'default').permission).toBe('yolo');
  });

  it('should report no permission when no pick and no message names one', () => {
    // Act / Assert
    expect(rankSessionModes({ permission: 'default' }, undefined).permission).toBeUndefined();
    expect(rankSessionModes(null, { model: 'one', sentAt: 1 }).permission).toBeUndefined();
  });
});

describe('Agent plan mode', () => {
  const claude = { flavor: 'claude' };
  // claude/utils/sessionProtocolMapper.ts sends { role: 'session', content: envelope }; toolTitle() gives '<name> call'.
  const toolCall = (seq: number, createdAt: number, call: string, name: string): MessageRecord => ({
    id: `m${seq}`, seq, createdAt, raw: { role: 'session', content: {
      id: `e${seq}`, time: createdAt, role: 'agent', turn: 't1',
      ev: { t: 'tool-call-start', call, name, title: `${name} call`, description: `${name} call`, args: {} },
    } },
  });
  const userText = (seq: number, createdAt: number, permissionMode: string): MessageRecord => ({
    id: `m${seq}`, seq, createdAt,
    raw: { role: 'user', content: { type: 'text', text: 'Go' }, meta: { sentFrom: 'web', permissionMode } },
  });
  // claude/utils/permissionHandler.ts moves an answered request to completedRequests[id] with its status and mode.
  const completed = (id: string, status: string, mode?: string, tool = 'ExitPlanMode') =>
    ({ completedRequests: { [id]: { tool, arguments: {}, createdAt: 1, completedAt: 2, status, mode } } });

  it('should read EnterPlanMode from the session protocol and from legacy Claude output', () => {
    // Arrange
    const legacy: MessageRecord = { id: 'm2', seq: 2, createdAt: 3000, raw: { role: 'agent', content: { type: 'output', data: {
      type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'EnterPlanMode', input: {} }] } } } } };
    // Act
    const session = latestAgentMode(visibleMessages([userText(1, 1000, 'bypassPermissions'), toolCall(2, 3000, 'toolu_1', 'EnterPlanMode')]), {}, claude);
    const output = latestAgentMode(visibleMessages([legacy]), {}, claude);
    // Assert
    expect(session).toEqual({ permission: 'plan', at: 3000, call: 'toolu_1' });
    expect(output).toEqual({ permission: 'plan', at: 3000, call: 'toolu_2' });
    expect(latestAgentMode(visibleMessages([userText(1, 1000, 'default')]), {}, claude)).toBeUndefined();
  });

  it('should let EnterPlanMode replace an older pick and an older sent message', () => {
    // Arrange
    const messages = visibleMessages([userText(1, 2000, 'bypassPermissions'), toolCall(2, 3000, 'toolu_1', 'EnterPlanMode')]);
    const agentMode = latestAgentMode(messages, {}, claude);
    const picked = { model: 'claude-opus-4-8', effort: 'high', permission: 'bypassPermissions', at: 1000 };
    // Act
    const ranked = rankSessionModes(picked, latestSentModes(messages), undefined, agentMode);
    // Assert
    expect(ranked.permission).toBe('plan');
    // The agent changes only the permission mode; the model pick still leads.
    expect(ranked.modelCandidates[0]).toMatchObject({ model: 'claude-opus-4-8', effort: 'high' });
  });

  it('should keep a pick or a sent message that is newer than EnterPlanMode', () => {
    // Arrange
    const agentMode = { permission: 'plan', at: 3000, call: 'toolu_1' };
    const sent = { permissionMode: 'acceptEdits', sentAt: 2000 };
    // Act / Assert
    expect(rankSessionModes({ permission: 'default', at: 4000 }, sent, undefined, agentMode).permission).toBe('default');
    expect(rankSessionModes({ permission: 'default', at: 1000 }, { ...sent, sentAt: 4000 }, undefined, agentMode).permission).toBe('acceptEdits');
  });

  it('should keep plan mode until the user approves ExitPlanMode, then use the approved mode', () => {
    // Arrange: the user sends feedback in plan mode, and Claude asks to exit plan mode again.
    const rows = [userText(1, 1000, 'bypassPermissions'), toolCall(2, 2000, 'toolu_1', 'EnterPlanMode'),
      userText(3, 3000, 'plan'), toolCall(4, 4000, 'toolu_2', 'ExitPlanMode')];
    const messages = visibleMessages(rows);
    const sent = latestSentModes(messages);
    // Act / Assert
    expect(latestAgentMode(messages, {}, claude)).toEqual({ permission: 'plan', at: 2000, call: 'toolu_1' });
    expect(rankSessionModes(null, sent, undefined, latestAgentMode(messages, completed('toolu_2', 'denied'), claude)).permission).toBe('plan');
    const approved = latestAgentMode(messages, completed('toolu_2', 'approved'), claude);
    expect(approved).toEqual({ permission: 'default', at: 4000, call: 'toolu_2' });
    expect(rankSessionModes(null, sent, undefined, approved).permission).toBe('default');
    expect(latestAgentMode(messages, completed('toolu_2', 'approved', 'acceptEdits'), claude)?.permission).toBe('acceptEdits');
  });

  it.each([
    ['denied', completed('toolu_1', 'denied', undefined, 'EnterPlanMode')],
    ['canceled', completed('toolu_1', 'canceled', undefined, 'EnterPlanMode')],
    ['pending', { requests: { toolu_1: { tool: 'EnterPlanMode', arguments: {}, createdAt: 1 } } }],
  ])('should not enter plan mode when the user has %s EnterPlanMode', (_status, agentState) => {
    // Arrange: claude/utils/permissionHandler.ts asks before EnterPlanMode in default and acceptEdits modes.
    const messages = visibleMessages([userText(1, 1000, 'default'), toolCall(2, 2000, 'toolu_1', 'EnterPlanMode')]);
    // Act / Assert
    expect(latestAgentMode(messages, agentState, claude)).toBeUndefined();
    expect(latestAgentMode(messages, completed('toolu_1', 'approved', undefined, 'EnterPlanMode'), claude)?.permission).toBe('plan');
  });

  it('should keep a pick that saw the plan call when the browser clock is behind the server', () => {
    // Arrange: EnterPlanMode has server time 3000; the user picks Default at browser time 2000.
    const agentMode = { permission: 'plan', at: 3000, call: 'toolu_1' };
    const sent = { permissionMode: 'bypassPermissions', sentAt: 1000 };
    // Act / Assert
    expect(rankSessionModes({ permission: 'default', at: 2000, agentCall: 'toolu_1' }, sent, undefined, agentMode).permission).toBe('default');
    expect(rankSessionModes({ permission: 'default', at: 2000, agentCall: 'toolu_0' }, sent, undefined, agentMode).permission).toBe('plan');
    expect(rankSessionModes({ permission: 'default', at: 2000 }, sent, undefined, agentMode).permission).toBe('plan');
  });

  it('should return to yolo after a plan approval that carries the mode from before plan', () => {
    // Arrange: Claude enters plan mode in a yolo session, Rayno sends plan feedback, and the user approves the plan.
    const rows = [userText(1, 1000, 'bypassPermissions'), toolCall(2, 2000, 'toolu_1', 'EnterPlanMode'),
      userText(3, 3000, 'plan'), toolCall(4, 4000, 'toolu_2', 'ExitPlanMode')];
    const messages = visibleMessages(rows);
    const mode = modeBeforePlan(null, messages, undefined, claude);
    // Act
    const ranked = rankSessionModes(null, latestSentModes(messages), undefined,
      latestAgentMode(messages, completed('toolu_2', 'approved', mode), claude));
    // Assert
    expect(mode).toBe('bypassPermissions');
    expect(ranked.permission).toBe('bypassPermissions');
  });

  it('should find the newest picked or sent mode other than plan', () => {
    // Arrange
    const messages = visibleMessages([userText(1, 1000, 'acceptEdits'), userText(2, 2000, 'plan')]);
    // Act / Assert
    expect(modeBeforePlan(null, messages, 'default', claude)).toBe('acceptEdits');
    expect(modeBeforePlan({ permission: 'bypassPermissions', at: 1500 }, messages, 'default', claude)).toBe('bypassPermissions');
    expect(modeBeforePlan({ permission: 'bypassPermissions', at: 500 }, messages, 'default', claude)).toBe('acceptEdits');
    expect(modeBeforePlan({ permission: 'plan', at: 3000 }, messages, 'default', claude)).toBe('acceptEdits');
    expect(modeBeforePlan(null, visibleMessages([userText(1, 1000, 'plan')]), 'default', claude)).toBe('default');
    expect(modeBeforePlan(null, [], 'plan', claude)).toBeUndefined();
    // A sent message from an older history page counts after the loaded messages.
    const older = { permissionMode: 'bypassPermissions', sentAt: 1000 };
    expect(modeBeforePlan(null, [], 'plan', claude, older)).toBe('bypassPermissions');
    expect(modeBeforePlan({ permission: 'acceptEdits', at: 2000 }, [], 'plan', claude, older)).toBe('acceptEdits');
    expect(modeBeforePlan({ permission: 'acceptEdits', at: 500 }, [], 'plan', claude, older)).toBe('bypassPermissions');
    expect(modeBeforePlan(null, [], 'default', claude, { permissionMode: 'plan', sentAt: 1000 })).toBe('default');
  });

  it('should ignore plan tool calls for an agent without plan mode', () => {
    // Act / Assert
    expect(latestAgentMode(visibleMessages([toolCall(1, 1000, 'call-1', 'enter_plan_mode')]), {}, { flavor: 'codex' })).toBeUndefined();
  });
});
