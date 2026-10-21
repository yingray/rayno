import { describe, expect, it } from 'vitest';
import { createInitialState } from '../data/fixtures';
import { demoReducer, restoreState } from '../data/reducer';
import { isConcreteModel, modelOptions } from './modelOptions';
import { latestSentModes, modelChoiceKey, rankSessionModes, recentModelChoice, resolveModelChoice } from './modelPreferences';

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
