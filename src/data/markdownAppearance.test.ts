import { describe, expect, it } from 'vitest';
import { defaultMarkdownAppearance, markdownBackgroundThemes, markdownElements, markdownTextThemes } from './markdownAppearance';
import { createInitialState } from './fixtures';
import { restoreState } from './reducer';

const channels = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
function luminance(color: number[]) {
  const linear = color.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground: number[], background: number[]) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Markdown appearance presets', () => {
  it('should keep each element readable on every preset background', () => {
    for (const background of markdownBackgroundThemes) for (const text of markdownTextThemes) for (const element of markdownElements) {
      const surface = channels(background.value === 'none' ? '#121214' : background.color);
      const foreground = text.color || element.originalColor;
      expect(contrast(channels(foreground), surface), `${element.value}: ${text.value} on ${background.value}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(markdownTextThemes)('should restore the $value text preset without changing other preferences or drafts', theme => {
    // Arrange
    const state = createInitialState(0);
    for (const element of markdownElements) state.preferences[element.textKey] = theme.value;
    state.preferences.markdownQuoteBackground = 'forest';
    state.preferences.bubble = 'rose';
    state.drafts['floating-panels'] = 'Keep this draft';
    // Act
    const restored = restoreState(JSON.stringify(state), createInitialState(1));
    // Assert
    for (const element of markdownElements) expect(restored.preferences[element.textKey]).toBe(theme.value);
    expect(restored.preferences.markdownQuoteBackground).toBe('forest');
    expect(restored.preferences.markdownBoldBackground).toBe('none');
    expect(restored.preferences.markdownLinkBackground).toBe('none');
    expect(restored.preferences.bubble).toBe('rose');
    expect(restored.drafts['floating-panels']).toBe('Keep this draft');
  });

  it.each(markdownBackgroundThemes)('should restore the $value background preset', theme => {
    const state = createInitialState(0);
    for (const element of markdownElements) state.preferences[element.backgroundKey] = theme.value;
    const restored = restoreState(JSON.stringify(state), createInitialState(1));
    for (const element of markdownElements) expect(restored.preferences[element.backgroundKey]).toBe(theme.value);
  });

  it.each([undefined, '#ff0000', 'url(https://example.com)', 42])('should use the original appearance for unsupported saved values: %s', value => {
    const raw = JSON.parse(JSON.stringify(createInitialState(0)));
    for (const key of Object.keys(defaultMarkdownAppearance)) raw.preferences[key] = value;
    const restored = restoreState(JSON.stringify(raw), createInitialState(1));
    for (const [key, value] of Object.entries(defaultMarkdownAppearance))
      expect(restored.preferences[key as keyof typeof defaultMarkdownAppearance]).toBe(value);
  });
});
