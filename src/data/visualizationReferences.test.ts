import { expect, it } from 'vitest';
import { visualizationParts, visualizationReference } from './visualizationReferences';

it('should keep examples literal and render only a complete standalone visualization reference', () => {
  // Arrange
  const value = { path: '/project/.performance/cost_vs_score.html', title: 'Cost vs. score', mode: 'wide' } as const;
  const marker = visualizationReference(value);
  const examples = ['```text\n' + marker + '\n```', '> ' + marker, '`' + marker + '`', marker.slice(0, -1)].join('\n\n');
  const before = examples + '\n\n';
  // Act
  const parts = visualizationParts(before + marker + '\n\nAfter');
  // Assert
  expect(parts).toEqual([{ text: before }, { reference: value }, { text: '\n\nAfter' }]);
});
