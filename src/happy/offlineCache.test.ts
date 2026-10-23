import { describe, expect, it } from 'vitest';
import { HISTORY_PAGE_ROWS, historyPages } from './offlineCache';
import type { MessageRecord } from './normalize';

const rows = (from: number, count: number): MessageRecord[] =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${from + index}`, seq: from + index, createdAt: 1700000000000 + index, raw: { n: from + index } }));

describe('historyPages', () => {
  it('should rewrite only the last page when 3 rows arrive in a 1,000-row history', () => {
    // Arrange
    const history = rows(1, 1000);
    const saved = historyPages(history).pages;
    // Act
    const next = historyPages([...history, ...rows(1001, 3)], saved);
    // Assert
    const written = next.changed.reduce((total, page) => total + next.pages.get(page)!.length, 0);
    expect(next.changed).toEqual([10]);
    expect(written).toBeLessThanOrEqual(HISTORY_PAGE_ROWS);
    expect([...next.pages.values()].flat()).toHaveLength(1003);
  });
  it('should write every page on the first save and no page when nothing changed', () => {
    // Arrange
    const history = rows(1, 250);
    // Act
    const first = historyPages(history);
    const again = historyPages(history, first.pages);
    // Assert
    expect(first.changed).toEqual([0, 1, 2]);
    expect(again.changed).toEqual([]);
  });
  it('should rewrite a page when older rows load into it or a row object is new', () => {
    // Arrange
    const history = rows(150, 100);
    const saved = historyPages(history).pages;
    const replaced = history.map((row) => row.seq === 230 ? { ...row } : row);
    // Act
    const older = historyPages([...rows(120, 30), ...history], saved);
    const changedRow = historyPages(replaced, saved);
    // Assert
    expect(older.changed).toEqual([1]);
    expect(changedRow.changed).toEqual([2]);
  });
});
