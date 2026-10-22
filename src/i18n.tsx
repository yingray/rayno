import { createContext, useCallback, useContext } from 'react';
import zh from './locales/zh-TW.json';

export type Language = 'en' | 'zh-TW';
export const LanguageContext = createContext<Language>('en');
export function translate(language: Language, text: string, values?: Record<string, string>): string {
  const result = language === 'zh-TW' ? (zh as Record<string, string>)[text] ?? text : text;
  return values ? result.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match) : result;
}
export function useText() {
  const language = useContext(LanguageContext);
  return useCallback((text: string, values?: Record<string, string>) => translate(language, text, values), [language]);
}
