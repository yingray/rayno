export const markdownTextThemes = [
  { value: 'default', label: 'Original', color: null },
  { value: 'pearl', label: 'Pearl', color: '#ededf2' },
  { value: 'sand', label: 'Warm sand', color: '#f0cd88' },
  { value: 'blue', label: 'Cool blue', color: '#abd4ff' },
  { value: 'mint', label: 'Mint', color: '#a0e5cd' },
  { value: 'lavender', label: 'Lavender', color: '#cbb5ff' },
] as const;

export const markdownBackgroundThemes = [
  { value: 'none', label: 'No background', color: 'transparent' },
  { value: 'graphite', label: 'Graphite', color: '#18181d' },
  { value: 'midnight', label: 'Midnight blue', color: '#131e2e' },
  { value: 'forest', label: 'Forest', color: '#14251f' },
  { value: 'plum', label: 'Plum', color: '#261c2b' },
  { value: 'sand', label: 'Warm sand', color: '#29231c' },
] as const;

export const markdownElements = [
  { value: 'bold', label: 'Bold', textLabel: 'Bold text color', backgroundLabel: 'Bold background', textKey: 'markdownBoldText', backgroundKey: 'markdownBoldBackground', originalColor: '#c084fc' },
  { value: 'quote', label: 'Quote', textLabel: 'Quote text color', backgroundLabel: 'Quote background', textKey: 'markdownQuoteText', backgroundKey: 'markdownQuoteBackground', originalColor: '#a1a1aa' },
  { value: 'link', label: 'Link', textLabel: 'Link text color', backgroundLabel: 'Link background', textKey: 'markdownLinkText', backgroundKey: 'markdownLinkBackground', originalColor: '#a78bfa' },
] as const;

export type MarkdownTextTheme = typeof markdownTextThemes[number]['value'];
export type MarkdownBackgroundTheme = typeof markdownBackgroundThemes[number]['value'];
export type MarkdownAppearancePreferences = {
  [Key in typeof markdownElements[number]['textKey']]: MarkdownTextTheme;
} & {
  [Key in typeof markdownElements[number]['backgroundKey']]: MarkdownBackgroundTheme;
};

export const defaultMarkdownAppearance: MarkdownAppearancePreferences = {
  markdownBoldText: 'default', markdownBoldBackground: 'none',
  markdownQuoteText: 'default', markdownQuoteBackground: 'none',
  markdownLinkText: 'default', markdownLinkBackground: 'none',
};

export function markdownThemeStyle(preferences: MarkdownAppearancePreferences): Record<`--markdown-${string}`, string> {
  const variables: Record<`--markdown-${string}`, string> = {};
  for (const element of markdownElements) {
    const text = markdownTextThemes.find(theme => theme.value === preferences[element.textKey]) || markdownTextThemes[0];
    const background = markdownBackgroundThemes.find(theme => theme.value === preferences[element.backgroundKey]) || markdownBackgroundThemes[0];
    variables[`--markdown-${element.value}-color`] = text.color || element.originalColor;
    variables[`--markdown-${element.value}-background`] = background.color;
    variables[`--markdown-${element.value}-padding`] = background.value === 'none' ? '0' : '0 3px';
  }
  return variables;
}
