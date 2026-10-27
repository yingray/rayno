import { describe, expect, it } from 'vitest';
import { defaultMarkdownAppearance, markdownBackgroundThemes, markdownElements, markdownTextThemes } from './markdownAppearance';
import { createInitialState } from './fixtures';
import { restoreState } from './reducer';

function luminance(color: string) {
  if (color.startsWith('#')) {
    const linear = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  // OKLCH -> OKLab -> linear sRGB, with the CSS Color 4 conversion matrices.
  const [lightness, chroma, hue] = color.slice(6, -1).split(' ').map(value => value === 'none' ? 0 : Number(value));
  const a = chroma * Math.cos(hue * Math.PI / 180), b = chroma * Math.sin(hue * Math.PI / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(channel => Math.min(1, Math.max(0, channel)));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Markdown appearance presets', () => {
  it('should keep each element readable on every preset background', () => {
    for (const background of markdownBackgroundThemes) for (const text of markdownTextThemes) {
      const surface = background.value === 'none' ? '#121214' : background.color;
      expect(contrast(text.color, surface), `${text.value} on ${background.value}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('should offer all 26 official families with fixed text and background shades', () => {
    expect(markdownTextThemes).toHaveLength(26);
    expect(new Set(markdownTextThemes.map(theme => theme.value)).size).toBe(26);
    const neutrals = new Set('neutral stone zinc slate gray mauve olive mist taupe'.split(' '));
    for (const theme of markdownTextThemes) expect(theme.shade).toBe(neutrals.has(theme.value) ? 400 : 300);
    expect(markdownBackgroundThemes.filter(theme => theme.value !== 'none').every(theme => theme.shade === 950)).toBe(true);
  });

  it.each([
    ['default', 'none', 'purple', 'none'], ['pearl', 'graphite', 'zinc', 'zinc'],
    ['sand', 'midnight', 'amber', 'blue'], ['mint', 'forest', 'emerald', 'green'],
    ['lavender', 'plum', 'violet', 'purple'], ['blue', 'sand', 'blue', 'stone'],
  ])('should migrate the old %s/%s presets to %s/%s', (text, background, expectedText, expectedBackground) => {
    const raw = JSON.parse(JSON.stringify(createInitialState(0)));
    raw.preferences.markdownBoldText = text;
    raw.preferences.markdownBoldBackground = background;
    raw.preferences.markdownQuoteText = 'default';
    raw.preferences.markdownLinkText = 'default';
    raw.preferences.bubble = 'rose';
    raw.drafts['floating-panels'] = 'Keep this saved draft';
    const restored = restoreState(JSON.stringify(raw), createInitialState(1));
    expect(restored.preferences.markdownBoldText).toBe(expectedText);
    expect(restored.preferences.markdownBoldBackground).toBe(expectedBackground);
    expect(restored.preferences.markdownQuoteText).toBe('zinc');
    expect(restored.preferences.markdownLinkText).toBe('violet');
    expect(restored.preferences.bubble).toBe('rose');
    expect(restored.drafts['floating-panels']).toBe('Keep this saved draft');
  });

  it.each(markdownTextThemes)('should restore the $value text preset without changing other preferences or drafts', theme => {
    // Arrange
    const state = createInitialState(0);
    for (const element of markdownElements) state.preferences[element.textKey] = theme.value;
    state.preferences.markdownQuoteBackground = 'green';
    state.preferences.bubble = 'rose';
    state.drafts['floating-panels'] = 'Keep this draft';
    // Act
    const restored = restoreState(JSON.stringify(state), createInitialState(1));
    // Assert
    for (const element of markdownElements) expect(restored.preferences[element.textKey]).toBe(theme.value);
    expect(restored.preferences.markdownQuoteBackground).toBe('green');
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

  it.each([undefined, '#ff0000', 'url(https://example.com)', 42, 'toString', '__proto__'])('should use the original appearance for unsupported saved values: %s', value => {
    const raw = JSON.parse(JSON.stringify(createInitialState(0)));
    for (const key of Object.keys(defaultMarkdownAppearance)) raw.preferences[key] = value;
    const restored = restoreState(JSON.stringify(raw), createInitialState(1));
    for (const [key, value] of Object.entries(defaultMarkdownAppearance))
      expect(restored.preferences[key as keyof typeof defaultMarkdownAppearance]).toBe(value);
  });
});
