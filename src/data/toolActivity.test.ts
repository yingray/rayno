import { describe, expect, it } from 'vitest';
import { activitySteps, activityTiming, elapsedClock, elapsedDuration } from './toolActivity';
import type { ToolActivityBlock } from './chatBlocks';

describe('Tool activity timing', () => {
  it('should exclude thinking and measure concurrent tools through the last reported end', () => {
    // Arrange
    const block: ToolActivityBlock = { kind: 'tools', id: 'group', tools: ['Read', 'Thinking', 'Grep'],
      thinking: [undefined, 'Plan', undefined], details: [
        { id: 'read', name: 'Read', startedAt: 1000, ended: true, endedAt: 5000 }, undefined,
        { id: 'grep', name: 'Grep', startedAt: 2000, result: null, endedAt: 7000 },
      ] };
    // Act / Assert
    expect(activitySteps(block).map(step => step.label)).toEqual(['Read', 'Grep']);
    expect(activityTiming(block)).toEqual({ start: 1000, end: 7000 });
  });
  it('should keep missing results and interrupted steps unfinished without inventing an end time', () => {
    // Arrange
    const block: ToolActivityBlock = { kind: 'tools', id: 'group', tools: ['Read', 'Grep'], startedAt: 1000,
      details: [{ id: 'read', name: 'Read', ended: true, endedAt: 3000 }, { id: 'grep', name: 'Grep' }] };
    // Act / Assert
    expect(activityTiming(block)).toEqual({ start: 1000, end: undefined });
    expect(activityTiming({ kind: 'tools', id: 'legacy', tools: ['Read'] })).toEqual({ start: undefined, end: undefined });
  });
  it('should show clock and completed durations consistently at minute boundaries', () => {
    // Act / Assert
    expect(elapsedClock(42000)).toBe('0:42');
    expect(elapsedClock(72000)).toBe('1:12');
    expect(elapsedDuration(72000)).toBe('1m 12s');
    expect(elapsedDuration(-1000)).toBe('0s');
  });
});
