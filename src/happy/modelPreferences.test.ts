import { describe, expect, it } from 'vitest';
import { createInitialState } from '../data/fixtures';
import { demoReducer, restoreState } from '../data/reducer';
import { isConcreteModel, modelOptions } from './modelOptions';
import { modelChoiceKey, recentModelChoice, resolveModelChoice } from './modelPreferences';

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
