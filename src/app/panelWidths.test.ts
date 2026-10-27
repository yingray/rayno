import { describe, expect, it } from 'vitest';
import { clampPanelWidth, defaultPanelWidth, panelWidthBounds, savedPanelWidth } from './panelWidths';

describe('panel width limits', () => {
  it('should let either chat use 70 percent while the info panel keeps its reading limit', () => {
    expect(panelWidthBounds('side', 1800)).toEqual({ min: 540, max: 1260 });
    expect(panelWidthBounds('info', 1800)).toEqual({ min: 320, max: 560 });
  });
  it('should use the available chat space after the navigation or session list changes', () => {
    const bounds = panelWidthBounds('side', 1010);
    expect(clampPanelWidth(1000, bounds)).toBe(707);
    expect(clampPanelWidth(100, bounds)).toBe(303);
    expect(panelWidthBounds('info', 1010)).toEqual({ min: 320, max: 490 });
  });
  it('should reject invalid saved values instead of hiding a panel or overflowing the viewport', () => {
    for (const raw of [null, '', 'NaN', 'Infinity', '-1', '0', '319', '2000', '{}']) expect(savedPanelWidth(raw, 'info')).toBeNull();
    expect(savedPanelWidth('480', 'info')).toBe(480);
    expect(savedPanelWidth('1260', 'side')).toBe(1260);
    expect(savedPanelWidth('720', 'side')).toBe(720);
    for (const raw of [null, '', 'NaN', 'Infinity', '-1', '0', '{}']) expect(savedPanelWidth(raw, 'side')).toBeNull();
  });
  it('should keep distinct default widths for details and a conversation', () => {
    expect(defaultPanelWidth('info', 1920)).toBe(380);
    expect(defaultPanelWidth('side', 1920)).toBe(520);
    expect(defaultPanelWidth('side', 1280)).toBe(435);
    expect(defaultPanelWidth('sessions', 1920)).toBe(360);
    expect(defaultPanelWidth('sessions', 1024)).toBe(320);
  });
  it('should reserve chat space when the session list grows on a smaller desktop', () => {
    expect(panelWidthBounds('sessions', 1600)).toEqual({ min: 280, max: 520 });
    expect(panelWidthBounds('sessions', 910)).toEqual({ min: 280, max: 390 });
    expect(clampPanelWidth(520, panelWidthBounds('sessions', 910))).toBe(390);
    expect(savedPanelWidth('480', 'sessions')).toBe(480);
    for (const raw of [null, '', 'NaN', 'Infinity', '279', '521', '-1', '0', '{}'])
      expect(savedPanelWidth(raw, 'sessions')).toBeNull();
  });
});
