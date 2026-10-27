// Official shadcn/Tailwind palette. Keep the upstream OKLCH values unchanged.
// https://ui.shadcn.com/colors
// https://github.com/tailwindlabs/tailwindcss/blob/8cc0551b1217d36dc565840b90920964d37cb46c/packages/tailwindcss/theme.css
// Light text and 950 backgrounds keep all selectable pairs readable in the dark chat.
const markdownPalette = [
  { value: 'neutral', label: 'Neutral', shade: 400, color: 'oklch(0.708 0 none)', background: 'oklch(0.145 0 none)' },
  { value: 'stone', label: 'Stone', shade: 400, color: 'oklch(0.709 0.01 56.259)', background: 'oklch(0.147 0.004 49.25)' },
  { value: 'zinc', label: 'Zinc', shade: 400, color: 'oklch(0.705 0.015 286.067)', background: 'oklch(0.141 0.005 285.823)' },
  { value: 'slate', label: 'Slate', shade: 400, color: 'oklch(0.704 0.04 256.788)', background: 'oklch(0.129 0.042 264.695)' },
  { value: 'gray', label: 'Gray', shade: 400, color: 'oklch(0.707 0.022 261.325)', background: 'oklch(0.13 0.028 261.692)' },
  { value: 'mauve', label: 'Mauve', shade: 400, color: 'oklch(0.711 0.019 323.02)', background: 'oklch(0.145 0.008 326)' },
  { value: 'olive', label: 'Olive', shade: 400, color: 'oklch(0.737 0.021 106.9)', background: 'oklch(0.153 0.006 107.1)' },
  { value: 'mist', label: 'Mist', shade: 400, color: 'oklch(0.723 0.014 214.4)', background: 'oklch(0.148 0.004 228.8)' },
  { value: 'taupe', label: 'Taupe', shade: 400, color: 'oklch(0.714 0.014 41.2)', background: 'oklch(0.147 0.004 49.3)' },
  { value: 'red', label: 'Red', shade: 300, color: 'oklch(0.808 0.114 19.571)', background: 'oklch(0.258 0.092 26.042)' },
  { value: 'orange', label: 'Orange', shade: 300, color: 'oklch(0.837 0.128 66.29)', background: 'oklch(0.266 0.079 36.259)' },
  { value: 'amber', label: 'Amber', shade: 300, color: 'oklch(0.879 0.169 91.605)', background: 'oklch(0.279 0.077 45.635)' },
  { value: 'yellow', label: 'Yellow', shade: 300, color: 'oklch(0.905 0.182 98.111)', background: 'oklch(0.286 0.066 53.813)' },
  { value: 'lime', label: 'Lime', shade: 300, color: 'oklch(0.897 0.196 126.665)', background: 'oklch(0.274 0.072 132.109)' },
  { value: 'green', label: 'Green', shade: 300, color: 'oklch(0.871 0.15 154.449)', background: 'oklch(0.266 0.065 152.934)' },
  { value: 'emerald', label: 'Emerald', shade: 300, color: 'oklch(0.845 0.143 164.978)', background: 'oklch(0.262 0.051 172.552)' },
  { value: 'teal', label: 'Teal', shade: 300, color: 'oklch(0.855 0.138 181.071)', background: 'oklch(0.277 0.046 192.524)' },
  { value: 'cyan', label: 'Cyan', shade: 300, color: 'oklch(0.865 0.127 207.078)', background: 'oklch(0.302 0.056 229.695)' },
  { value: 'sky', label: 'Sky', shade: 300, color: 'oklch(0.828 0.111 230.318)', background: 'oklch(0.293 0.066 243.157)' },
  { value: 'blue', label: 'Blue', shade: 300, color: 'oklch(0.809 0.105 251.813)', background: 'oklch(0.282 0.091 267.935)' },
  { value: 'indigo', label: 'Indigo', shade: 300, color: 'oklch(0.785 0.115 274.713)', background: 'oklch(0.257 0.09 281.288)' },
  { value: 'violet', label: 'Violet', shade: 300, color: 'oklch(0.811 0.111 293.571)', background: 'oklch(0.283 0.141 291.089)' },
  { value: 'purple', label: 'Purple', shade: 300, color: 'oklch(0.827 0.119 306.383)', background: 'oklch(0.291 0.149 302.717)' },
  { value: 'fuchsia', label: 'Fuchsia', shade: 300, color: 'oklch(0.833 0.145 321.434)', background: 'oklch(0.293 0.136 325.661)' },
  { value: 'pink', label: 'Pink', shade: 300, color: 'oklch(0.823 0.12 346.018)', background: 'oklch(0.284 0.109 3.907)' },
  { value: 'rose', label: 'Rose', shade: 300, color: 'oklch(0.81 0.117 11.638)', background: 'oklch(0.271 0.105 12.094)' },
] as const;

export const markdownTextThemes = markdownPalette.map(({ value, label, shade, color }) => ({ value, label, shade, color }));
export const markdownBackgroundThemes = [
  { value: 'none', label: 'No background', shade: null, color: 'transparent' },
  ...markdownPalette.map(({ value, label, background }) => ({ value, label, shade: 950, color: background })),
] as const;

export const markdownElements = [
  { value: 'bold', label: 'Bold', textLabel: 'Bold text color', backgroundLabel: 'Bold background', textKey: 'markdownBoldText', backgroundKey: 'markdownBoldBackground', defaultText: 'purple' },
  { value: 'quote', label: 'Quote', textLabel: 'Quote text color', backgroundLabel: 'Quote background', textKey: 'markdownQuoteText', backgroundKey: 'markdownQuoteBackground', defaultText: 'zinc' },
  { value: 'link', label: 'Link', textLabel: 'Link text color', backgroundLabel: 'Link background', textKey: 'markdownLinkText', backgroundKey: 'markdownLinkBackground', defaultText: 'violet' },
] as const;

export type MarkdownTextTheme = typeof markdownTextThemes[number]['value'];
export type MarkdownBackgroundTheme = typeof markdownBackgroundThemes[number]['value'];
export type MarkdownAppearancePreferences = {
  [Key in typeof markdownElements[number]['textKey']]: MarkdownTextTheme;
} & {
  [Key in typeof markdownElements[number]['backgroundKey']]: MarkdownBackgroundTheme;
};

export const defaultMarkdownAppearance: MarkdownAppearancePreferences = {
  markdownBoldText: 'purple', markdownBoldBackground: 'none',
  markdownQuoteText: 'zinc', markdownQuoteBackground: 'none',
  markdownLinkText: 'violet', markdownLinkBackground: 'none',
};

export function markdownThemeStyle(preferences: MarkdownAppearancePreferences): Record<`--markdown-${string}`, string> {
  const variables: Record<`--markdown-${string}`, string> = {};
  for (const element of markdownElements) {
    const text = markdownTextThemes.find(theme => theme.value === preferences[element.textKey]) || markdownTextThemes.find(theme => theme.value === element.defaultText)!;
    const background = markdownBackgroundThemes.find(theme => theme.value === preferences[element.backgroundKey]) || markdownBackgroundThemes[0];
    variables[`--markdown-${element.value}-color`] = text.color;
    variables[`--markdown-${element.value}-background`] = background.color;
    variables[`--markdown-${element.value}-padding`] = background.value === 'none' ? '0' : '0 3px';
  }
  return variables;
}

const legacyTextThemes: Readonly<Record<string, MarkdownTextTheme>> = {
  pearl: 'zinc', sand: 'amber', mint: 'emerald', lavender: 'violet',
};
const legacyBackgroundThemes: Readonly<Record<string, MarkdownBackgroundTheme>> = {
  graphite: 'zinc', midnight: 'blue', forest: 'green', plum: 'purple', sand: 'stone',
};

export function restoreMarkdownTextTheme(value: unknown, fallback: MarkdownTextTheme): MarkdownTextTheme {
  const current = markdownTextThemes.find(theme => theme.value === value);
  if (current) return current.value;
  return typeof value === 'string' && Object.hasOwn(legacyTextThemes, value) ? legacyTextThemes[value] : fallback;
}

export function restoreMarkdownBackgroundTheme(value: unknown): MarkdownBackgroundTheme {
  const current = markdownBackgroundThemes.find(theme => theme.value === value);
  if (current) return current.value;
  return typeof value === 'string' && Object.hasOwn(legacyBackgroundThemes, value) ? legacyBackgroundThemes[value] : 'none';
}
