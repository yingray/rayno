import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(flag: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'rayno.perf' ? flag : null) });
  return import('./perf');
}

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
  vi.unstubAllGlobals();
});

describe('performance marks', () => {
  it('should keep only the latest entry for each recovery mark', async () => {
    // Arrange
    const { markRecovery } = await load(null);
    // Act
    markRecovery('transport-connected');
    markRecovery('transport-connected');
    // Assert
    expect(performance.getEntriesByName('rayno:transport-connected', 'mark')).toHaveLength(1);
  });
  it('should run a stage without timing data when the flag is off', async () => {
    // Arrange
    const { timeStage, stageStats } = await load(null);
    // Act
    const result = timeStage('publish', () => 42);
    // Assert
    expect(result).toBe(42);
    expect(stageStats()).toEqual({});
    expect('__raynoPerf' in globalThis).toBe(false);
  });
  it('should count stages, keep errors, and reset only its own measures when the flag is on', async () => {
    // Arrange
    const { timeStage, timeStageAsync, stageStats, resetStageStats } = await load('1');
    performance.measure('other-measure');
    // Act
    timeStage('publish', () => undefined);
    expect(() => timeStage('publish', () => { throw new Error('failed'); })).toThrow('failed');
    await timeStageAsync('cache-save', async () => true);
    // Assert
    expect(stageStats()).toMatchObject({ publish: { count: 2 }, 'cache-save': { count: 1 } });
    expect(typeof (globalThis as any).__raynoPerf.stats).toBe('function');
    // Act
    resetStageStats();
    // Assert
    expect(stageStats()).toEqual({});
    expect(performance.getEntriesByName('other-measure', 'measure')).toHaveLength(1);
    delete (globalThis as any).__raynoPerf;
  });
});
