import { describe, expect, it } from 'vitest';
import { railPinTops } from './RecapRail';

describe('Recap rail layout', () => {
  it('should keep close pins inside the rail when their targets are near the end', () => {
    // Arrange
    const height = 600;
    // Act
    const tops = railPinTops([590, 595, 599], height, 22);
    // Assert
    expect(tops).toEqual([536, 558, 580]);
  });

  it('should keep the touch gap between pins so that a hit area does not cover the pin above', () => {
    // Arrange
    const positions = [120, 130, 140];
    // Act
    const tops = railPinTops(positions, 600, 46);
    // Assert
    expect(tops).toEqual([110, 156, 202]);
  });

  it('should share the height equally when the pins do not fit with the gap', () => {
    // Act
    const tops = railPinTops([10, 20, 30], 60, 46);
    // Assert
    expect(tops).toEqual([0, 20, 40]);
  });
});
