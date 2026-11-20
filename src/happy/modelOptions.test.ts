import { describe, expect, it } from 'vitest';
import { modelOptions, effortOptions, defaultEffort, canSelectModel } from './modelOptions';
import { messageMeta } from './normalize';

describe('Model and effort selection', () => {
  it('should offer the v1 CLI fallback catalog when the daemon publishes no models', () => {
    // Act / Assert
    expect(modelOptions({ flavor: 'claude' })).toEqual([
      { value: 'claude-fable-5-2', label: 'Fable 5.2' }, { value: 'claude-opus-5-5', label: 'Opus 5.5' },
      { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    ]);
    expect(modelOptions({ flavor: 'codex' })).toEqual([
      { value: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' }, { value: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
      { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' }, { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ]);
  });
  it('should keep a retired model that the session reports or used', () => {
    // Act / Assert
    expect(modelOptions({ currentModelCode: 'claude-opus-5' })).toContainEqual({ value: 'claude-opus-5', label: 'Opus 5' });
    expect(modelOptions({ flavor: 'claude' }, undefined, ['claude-fable-5-1']).map((model) => model.label))
      .toEqual(['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.1']);
    expect(modelOptions({ flavor: 'codex', currentModelCode: 'gpt-6.1-sol' }))
      .toContainEqual({ value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' });
    expect(modelOptions({ flavor: 'codex' }, undefined, ['gpt-6-astra']).map((model) => model.label))
      .toEqual(['GPT-6.2 Sol', 'GPT-6.2 Astra', 'GPT-6.1 Terra', 'GPT-6 Luna', 'GPT-6 Astra']);
  });
  it('should take Codex efforts from the per-model table and keep unknown models at the shared set', () => {
    // Act / Assert
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6.2-sol')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6.2-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-5.6-terra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-5.6-luna')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6.1-sol')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6.1-terra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6-sol')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6-luna')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortOptions({ flavor: 'codex' }, 'workspace-model')).toEqual(['low', 'medium', 'high', 'xhigh']);
  });
  it('should prefer the thinking levels that a computer publishes over the Codex table', () => {
    // Arrange
    const metadata = { flavor: 'codex', models: [
      { code: 'gpt-6-astra', value: 'GPT-6 Astra', thinkingLevels: ['low', 'high'] },
      { code: 'gpt-6.1-sol', value: 'GPT-6.1 Sol', thinkingLevels: ['medium', 'xhigh', 'max', 'ultra'] },
      { code: 'gpt-6.2-sol', value: 'GPT-6.2 Sol', thinkingLevels: ['medium', 'high'], defaultThinkingLevel: 'medium' },
    ] };
    // Act / Assert
    expect(effortOptions(metadata, 'gpt-6-astra')).toEqual(['low', 'high']);
    expect(effortOptions(metadata, 'gpt-6.1-sol')).toEqual(['medium', 'xhigh', 'max', 'ultra']);
    expect(effortOptions(metadata, 'gpt-6.2-sol')).toEqual(['medium', 'high']);
    expect(defaultEffort(metadata, 'gpt-6.2-sol')).toBe('medium');
    expect(modelOptions(metadata).map(model => model.value)).not.toContain('gpt-6.2-astra');
  });
  it('should use the reported catalog and keep identical model IDs distinct by provider', () => {
    // Arrange
    const metadata = { client: { id: 'rig' }, models: [
      { id: 'same', providerId: 'one', name: 'Model', thinkingLevels: ['low', 'high'] },
      { id: 'same', providerId: 'two', name: 'Model', thinkingLevels: ['medium'], defaultThinkingLevel: 'medium' },
    ] };
    // Act / Assert
    expect(modelOptions(metadata).map((model) => model.value)).toEqual(['one:same', 'two:same']);
    expect(effortOptions(metadata, 'two:same')).toEqual(['medium']);
    expect(defaultEffort(metadata, 'two:same')).toBe('medium');
  });
  it('should respect explicit model locks and an empty model effort catalog', () => {
    // Arrange
    const metadata = { client: { id: 'rig' }, session: { modelLocked: true },
      reasoning: { levels: ['high'] }, models: [{ id: 'plain', providerId: 'one', thinkingLevels: [] }] };
    // Act / Assert
    expect(canSelectModel(metadata)).toBe(false);
    expect(effortOptions(metadata, 'one:plain')).toEqual([]);
    expect(effortOptions({ ...metadata, capabilities: { reasoningSelection: false } }, 'other')).toEqual([]);
  });
  it('should send explicit effort changes and null resets instead of the previous effort', () => {
    // Arrange
    const metadata = { flavor: 'claude', effortLevel: 'high' };
    // Act / Assert
    expect(messageMeta(metadata, { effort: 'low' }).effort).toBe('low');
    expect(messageMeta(metadata, { effort: null }).effort).toBeNull();
    expect(messageMeta(metadata, {}).effort).toBe('high');
  });
});
