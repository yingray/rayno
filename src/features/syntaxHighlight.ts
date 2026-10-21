import { common, createLowlight } from 'lowlight';

const highlighter = createLowlight(common);
highlighter.registerAlias({ javascript: ['jsx'], typescript: ['tsx'], bash: ['zsh', 'console'] });

export function highlightCode(source: string, language: string) {
  if (!highlighter.registered(language)) return undefined;
  return highlighter.highlight(language, source).children;
}
