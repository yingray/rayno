import { describe, expect, it } from 'vitest';
import { modelOptions, effortOptions, defaultEffort, canSelectModel } from './modelOptions';
import { messageMeta } from './normalize';

describe('Model and effort selection', () => {
  it('should offer the v1 CLI fallback catalog when the daemon publishes no models', () => {
    // Act / Assert
    expect(modelOptions({ flavor: 'claude' }).map((model) => model.value)).toContain('claude-opus-5');
    expect(modelOptions({ flavor: 'codex' }).map((model) => model.value)).toContain('gpt-6-astra');
  });
  it('should take Codex efforts from the per-model table and keep unknown models at the shared set', () => {
    // Act / Assert
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-5.6-terra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-5.6-luna')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortOptions({ flavor: 'codex' }, 'gpt-6.1-sol')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortOptions({ flavor: 'codex' }, 'workspace-model')).toEqual(['low', 'medium', 'high', 'xhigh']);
  });
  it('should prefer the thinking levels that a computer publishes over the Codex table', () => {
    // Arrange
    const metadata = { flavor: 'codex', models: [
      { code: 'gpt-6-astra', value: 'GPT-6 Astra', thinkingLevels: ['low', 'high'] },
      { code: 'gpt-6.1-sol', value: 'GPT-6.1 Sol', thinkingLevels: ['medium', 'xhigh', 'max', 'ultra'] },
    ] };
    // Act / Assert
    expect(effortOptions(metadata, 'gpt-6-astra')).toEqual(['low', 'high']);
    expect(effortOptions(metadata, 'gpt-6.1-sol')).toEqual(['medium', 'xhigh', 'max', 'ultra']);
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
