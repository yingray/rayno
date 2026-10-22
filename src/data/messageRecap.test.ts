import { describe, expect, it } from 'vitest';
import { parseMessageRecap, RECAP_TEXT_LIMIT } from './messageRecap';
import { findRecapQuote, markdownText, normalizeQuote } from './recapQuote';
import { partsForMessage } from './messageOptions';

const block = (body: string) => `<rayno-recap>\n${body}\n</rayno-recap>`;

describe('Rayno reply recap', () => {
  it('should parse a valid block into text and numbered points', () => {
    // Arrange
    const content = block('<point quote="mergeAgentUsage keeps the session reading">The merge kept the older session reading</point>. <point quote="if (manual.capturedAt &gt; session.capturedAt)">A newer manual reading now wins</point>, and <point quote="12 tests pass">12 tests pass</point>.');
    // Act
    const parts = parseMessageRecap(content);
    // Assert
    expect(parts).toEqual([{ kind: 'recap', recap: {
      text: 'The merge kept the older session reading. A newer manual reading now wins, and 12 tests pass.',
      segments: [
        { kind: 'point', text: 'The merge kept the older session reading', quote: 'mergeAgentUsage keeps the session reading', index: 1 },
        { kind: 'text', text: '. ' },
        { kind: 'point', text: 'A newer manual reading now wins', quote: 'if (manual.capturedAt > session.capturedAt)', index: 2 },
        { kind: 'text', text: ', and ' },
        { kind: 'point', text: '12 tests pass', quote: '12 tests pass', index: 3 },
        { kind: 'text', text: '.' },
      ],
    } }]);
  });

  it('should keep text around points and the Markdown around the block', () => {
    // Arrange
    const before = '# Result\n\nThe fix is in.\n\n';
    const after = '\n\nMore **details**.';
    // Act
    const parts = parseMessageRecap(before + block('Fixed: the cache <point quote="clears &quot;stale&quot; rows">clears old rows</point> now &amp; tests pass.') + after);
    // Assert
    expect(parts).toEqual([
      { kind: 'markdown', content: before },
      { kind: 'recap', recap: {
        text: 'Fixed: the cache clears old rows now & tests pass.',
        segments: [
          { kind: 'text', text: 'Fixed: the cache ' },
          { kind: 'point', text: 'clears old rows', quote: 'clears "stale" rows', index: 1 },
          { kind: 'text', text: ' now & tests pass.' },
        ],
      } },
      { kind: 'markdown', content: after },
    ]);
  });

  it('should keep the words of points after the third as plain text', () => {
    // Arrange
    const content = block('<point quote="a1">One</point>, <point quote="a2">two</point>, <point quote="a3">three</point>, <point quote="a4">four</point> and <point quote="a5">five</point>.');
    // Act
    const [part] = parseMessageRecap(content);
    // Assert
    expect(part).toEqual({ kind: 'recap', recap: {
      text: 'One, two, three, four and five.',
      segments: [
        { kind: 'point', text: 'One', quote: 'a1', index: 1 },
        { kind: 'text', text: ', ' },
        { kind: 'point', text: 'two', quote: 'a2', index: 2 },
        { kind: 'text', text: ', ' },
        { kind: 'point', text: 'three', quote: 'a3', index: 3 },
        { kind: 'text', text: ', four and five.' },
      ],
    } });
  });

  it('should keep a point without a target when the reply does not hold its quote', () => {
    // Arrange
    const reply = 'The `mergeAgentUsage` function keeps the **session reading**.\n\n```ts\nif (manual.capturedAt > session.capturedAt) return manual;\n```\n\n';
    const content = reply + block('<point quote="mergeAgentUsage function keeps the session reading">Merge</point> and <point quote="not in the reply">a missing quote</point>.');
    // Act
    const parts = parseMessageRecap(content);
    const sources = parts.flatMap((part) => part.kind === 'markdown' ? [markdownText(part.content)] : []);
    const recap = parts.find((part) => part.kind === 'recap')!.recap;
    const points = recap.segments.flatMap((segment) => segment.kind === 'point' ? [segment] : []);
    // Assert
    expect(points.map((point) => point.index)).toEqual([1, 2]);
    expect(points.map((point) => findRecapQuote(point.quote, sources))).toEqual([true, false]);
    expect(findRecapQuote('`if (manual.capturedAt > session.capturedAt)`', sources)).toBe(true);
    expect(findRecapQuote('reading. if (manual', sources)).toBe(false);
    expect(findRecapQuote('  ', sources)).toBe(false);
    expect(normalizeQuote(' a \n `b` **c** ')).toBe('a b c');
  });

  it.each([
    '```xml\n<rayno-recap>\nExample <point quote="x">point</point>.\n</rayno-recap>\n```',
    '`<rayno-recap>Example</rayno-recap>`',
    '    <rayno-recap>\n    Example\n    </rayno-recap>',
    '> <rayno-recap>\n> Example\n> </rayno-recap>',
    '<rayno-recap>\nThe reply ends before the closing tag.',
    '<rayno-recap>\n  \n</rayno-recap>',
    '<rayno-recap>\n<point quote="x">  </point>\n</rayno-recap>',
    '<rayno-recap>\nUse <b>bold</b> text.\n</rayno-recap>',
    '<rayno-recap>\n<point>No quote</point>\n</rayno-recap>',
    '<rayno-recap>\n<point quote="x">Nested <point quote="y">point</point></point>\n</rayno-recap>',
  ])('should leave code, quotes, and incomplete or invalid blocks unchanged: %s', (content) => {
    // Act / Assert
    expect(parseMessageRecap(content)).toEqual([{ kind: 'markdown', content }]);
  });

  it('should parse a real block after a literal example', () => {
    // Arrange
    const before = 'Use `<rayno-recap>` at the end.\n\n```xml\n<rayno-recap>\nExample\n</rayno-recap>\n```\n\n';
    // Act
    const parts = parseMessageRecap(before + block('The real recap.'));
    // Assert
    expect(parts).toEqual([
      { kind: 'markdown', content: before },
      { kind: 'recap', recap: { text: 'The real recap.', segments: [{ kind: 'text', text: 'The real recap.' }] } },
    ]);
  });

  it('should return the recap and the options when options follow the recap', () => {
    // Arrange
    const message = {
      id: 'm1', role: 'assistant' as const,
      content: 'Done.\n\n' + block('All <point quote="Done.">done</point>.') + '\n\n<options>\n<option>Ship it</option>\n</options>',
    };
    // Act
    const parts = partsForMessage(message);
    // Assert
    expect(parts.map((part) => part.kind)).toEqual(['markdown', 'recap', 'markdown', 'options']);
    expect(parts[1]).toMatchObject({ recap: { text: 'All done.' } });
    expect(parts[3]).toEqual({ kind: 'options', items: ['Ship it'] });
    expect(partsForMessage(message)).toBe(parts);
  });

  it('should still parse a recap with more than 200 visible characters', () => {
    // Arrange
    const long = 'This recap is long. '.repeat(15).trim();
    // Act
    const [part] = parseMessageRecap(block(long));
    // Assert
    expect(long.length).toBeGreaterThan(RECAP_TEXT_LIMIT);
    expect(part).toEqual({ kind: 'recap', recap: { text: long, segments: [{ kind: 'text', text: long }] } });
  });
});
