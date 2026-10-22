import { describe, expect, it } from 'vitest';
import { estimateSeconds, formatSeconds, pickVoice, pointAt, recapLanguage } from './recapSpeech';

const voice = (lang: string, isDefault = false) => ({ lang, default: isDefault, name: lang }) as SpeechSynthesisVoice;

describe('Recap speech', () => {
  it('should pick Traditional Chinese unless Simplified characters are more frequent', () => {
    // Arrange
    const traditional = '合併邏輯保留了舊的讀數，現在新的手動讀數會優先。';
    const simplified = '合并逻辑保留了旧的读数，这个问题现在已经解决。';
    const english = 'The merge kept the older session reading.';
    const fixedSimplified = '已修复登录跳转错误，缓存失效已解决。';
    const fixedTraditional = '已修復登錄跳轉錯誤，緩存失效已解決。';
    // Act
    const languages = [traditional, simplified, english, fixedSimplified, fixedTraditional].map(recapLanguage);
    // Assert
    expect(languages).toEqual(['zh-TW', 'zh-CN', 'en', 'zh-CN', 'zh-TW']);
  });

  it('should prefer an exact voice, then the language prefix, then the default voice', () => {
    // Arrange
    const voices = [voice('en-US', true), voice('zh_HK'), voice('zh-TW')];
    // Act
    const picks = [pickVoice(voices, 'zh-TW'), pickVoice(voices, 'zh-CN'), pickVoice([voice('fr-FR', true)], 'en')];
    // Assert
    expect(picks.map((item) => item?.lang)).toEqual(['zh-TW', 'zh_HK', 'fr-FR']);
  });

  it('should estimate the reading time from Latin and CJK characters and the rate', () => {
    // Arrange
    const latin = 'a'.repeat(140);
    const cjk = '讀'.repeat(50);
    // Act
    const times = [estimateSeconds(latin, 1), estimateSeconds(cjk, 1), estimateSeconds(latin, 1.25)];
    // Assert
    expect(times).toEqual([10, 10, 8]);
    expect(formatSeconds(74.4)).toBe('1:14');
  });

  it('should map a boundary character to the point that holds it', () => {
    // Arrange
    const segments = [
      { kind: 'point' as const, text: 'First', index: 1 },
      { kind: 'text' as const, text: ', then ' },
      { kind: 'point' as const, text: 'second', index: 2 },
    ];
    // Act
    const points = [0, 5, 12, 40].map((index) => pointAt(segments, index));
    // Assert
    expect(points).toEqual([1, null, 2, null]);
  });
});
