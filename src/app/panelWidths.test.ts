import { describe, expect, it } from 'vitest';
import { clampPanelWidth, defaultPanelWidth, panelWidthBounds, savedPanelWidth } from './panelWidths';

describe('panel width limits', () => {
  it('should cap wide side chats and info panels at their reading limits', () => {
    expect(panelWidthBounds('side', 1800)).toEqual({ min: 360, max: 720 });
    expect(panelWidthBounds('info', 1800)).toEqual({ min: 320, max: 560 });
  });
  it('should retain 520 pixels for the main conversation when the navigation expands', () => {
    const bounds = panelWidthBounds('side', 1010);
    expect(clampPanelWidth(720, bounds)).toBe(490);
    expect(clampPanelWidth(100, bounds)).toBe(360);
  });
  it('should reject invalid saved values instead of hiding a panel or overflowing the viewport', () => {
    for (const raw of [null, '', 'NaN', 'Infinity', '-1', '0', '319', '2000', '{}']) expect(savedPanelWidth(raw, 'info')).toBeNull();
    expect(savedPanelWidth('480', 'info')).toBe(480);
  });
  it('should keep distinct default widths for details and a conversation', () => {
    expect(defaultPanelWidth('info', 1920)).toBe(380);
    expect(defaultPanelWidth('side', 1920)).toBe(520);
    expect(defaultPanelWidth('side', 1280)).toBe(435);
  });
});
