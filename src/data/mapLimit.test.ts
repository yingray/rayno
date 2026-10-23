import { describe, expect, it } from 'vitest';
import { mapLimit } from './mapLimit';

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapLimit', () => {
  it('should run at most the limit at the same time and keep the order', async () => {
    // Arrange
    let running = 0, peak = 0;
    // Act
    const result = await mapLimit([30, 5, 20, 10, 1, 15, 2, 8, 12, 3], 4, async (ms, index) => {
      peak = Math.max(peak, ++running);
      await later(ms);
      running--;
      return index;
    });
    // Assert
    expect(peak).toBe(4);
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('should start no new call after a failure and reject with the first error', async () => {
    // Arrange
    const started: number[] = [];
    // Act
    const result = mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 2, async (_, index) => {
      started.push(index);
      await later(1);
      if (index === 1) throw new Error('upload failed');
      return index;
    });
    // Assert
    await expect(result).rejects.toThrow('upload failed');
    expect(started).toEqual([0, 1, 2]);
  });
  it('should return an empty list for no items', async () => {
    // Act / Assert
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
