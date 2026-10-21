import { describe, expect, it } from 'vitest';
import { parseMessageOptions } from './messageOptions';

describe('Happy reply options', () => {
  it.each([
    '<options> <option>已按下全部 7 個 ✓</option> <option>我找不到 ✓ 按鈕</option> </options>',
    '<options>\n  <option>已按下全部 7 個 ✓</option>\n  <option>我找不到 ✓ 按鈕</option>\n</options>',
  ])('should parse inline and multiline options without losing the exact labels: %s', (content) => {
    // Act / Assert
    expect(parseMessageOptions(content)).toEqual([
      { kind: 'options', items: ['已按下全部 7 個 ✓', '我找不到 ✓ 按鈕'] },
    ]);
  });

  it.each([
    '```xml\n<options><option>Example</option></options>\n```',
    '`<options><option>Example</option></options>`',
    '    <options><option>Example</option></options>',
    '> <options><option>Example</option></options>',
    '<options><option>Unfinished',
    '<options><option> </option></options>',
    '<options>Unexpected text<option>Choice</option></options>',
  ])('should leave code, quotes, and incomplete or invalid blocks unchanged: %s', (content) => {
    // Act / Assert
    expect(parseMessageOptions(content)).toEqual([{ kind: 'markdown', content }]);
  });

  it('should keep surrounding Markdown and skip a code example before real choices', () => {
    // Arrange
    const before = '# Question\n\n```xml\n<options><option>Example</option></options>\n```\n\n';
    const after = '\n\nMore **details**.';
    // Act
    const parts = parseMessageOptions(before + '<options><option>Continue</option></options>' + after);
    // Assert
    expect(parts).toEqual([
      { kind: 'markdown', content: before },
      { kind: 'options', items: ['Continue'] },
      { kind: 'markdown', content: after },
    ]);
  });
});
