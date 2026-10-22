import { describe, expect, it } from 'vitest';
import { contextStatus, formatTokens } from './ContextMeter';

describe('Context meter', () => {
  it('should format token counts like Happy', () => {
    // Act / Assert
    expect([999, 1000, 123958, 999499, 999500, 1250000, 12500000].map(formatTokens))
      .toEqual(['999', '1k', '124k', '999k', '1M', '1.3M', '13M']);
  });
  it('should show nothing without a window and warn when little context remains', () => {
    // Act / Assert
    expect(contextStatus({ size: 50000 })).toBeNull();
    expect(contextStatus(undefined)).toBeNull();
    expect(contextStatus({ size: 123958, window: 258400 })).toEqual({ percent: 48, used: '124k', total: '258k', tone: undefined });
    expect(contextStatus({ size: 182000, window: 200000 })?.tone).toBe('warning');
    expect(contextStatus({ size: 192000, window: 200000 })?.tone).toBe('critical');
    expect(contextStatus({ size: 300000, window: 200000 })?.percent).toBe(100);
  });
});
