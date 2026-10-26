import { describe, expect, it } from 'vitest';
import { hasGitSide, parseGitNumstat, parseGitPatch, parseGitStatus, sourcePatch, splitGitLines } from './gitChanges';

describe('Git change records', () => {
  it('should preserve exact paths, rename sources and simultaneous staged and working changes', () => {
    // Arrange
    const status = '## feat/diff...origin/feat/diff [ahead 2, behind 3]\0MM src/a.ts\0R  新檔 "name".ts\0old\tname.ts\0?? notes/line\nbreak.md\0UU conflict.ts\0';
    // Act
    const result = parseGitStatus(status);
    // Assert
    expect(result).toMatchObject({ branch: 'feat/diff', upstream: 'origin/feat/diff', ahead: 2, behind: 3 });
    expect(result.files.map(file => [file.path, file.oldPath])).toEqual([
      ['src/a.ts', undefined], ['新檔 "name".ts', 'old\tname.ts'], ['notes/line\nbreak.md', undefined], ['conflict.ts', undefined],
    ]);
    expect(hasGitSide(result.files[0], 'staged')).toBe(true);
    expect(hasGitSide(result.files[0], 'working')).toBe(true);
    expect(hasGitSide(result.files[2], 'staged')).toBe(false);
    expect(hasGitSide(result.files[3], 'staged')).toBe(false);
    expect(result.files[3].conflict).toBe(true);
  });
  it('should recognize unborn and detached branches without inventing tracking data', () => {
    // Act / Assert
    expect(parseGitStatus('## No commits yet on main\0')).toMatchObject({ branch: 'main', files: [], ahead: 0, behind: 0 });
    expect(parseGitStatus('## HEAD (no branch)\0').branch).toBe('HEAD (no branch)');
  });
  it('should parse numstat binary and rename records without splitting path tabs or newlines', () => {
    // Arrange
    const input = '3\t2\tpath\tname.ts\0-\t-\tpicture.png\0' + '0\t0\t\0old.ts\0new\nname.ts\0';
    // Act
    const result = parseGitNumstat(input);
    // Assert
    expect(result.get('path\tname.ts')).toEqual({ added: 3, removed: 2, binary: false });
    expect(result.get('picture.png')).toEqual({ added: 0, removed: 0, binary: true });
    expect(result.get('new\nname.ts')).toEqual({ added: 0, removed: 0, binary: false });
  });
});
describe('Git patch lines', () => {
  it('should preserve old and new line numbers across multiple hunks and no-newline markers', () => {
    // Arrange
    const text = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -5,2 +5,3 @@ fn\n same\n-old\n+new\n+---content\n\\ No newline at end of file\n@@ -20 +21 @@\n-last\n+next\n';
    // Act
    const patch = parseGitPatch(text);
    // Assert
    expect(patch.lines).toContainEqual({ kind: 'context', text: 'same', old: 5, next: 5 });
    expect(patch.lines).toContainEqual({ kind: 'remove', text: 'old', old: 6 });
    expect(patch.lines).toContainEqual({ kind: 'add', text: '---content', next: 7 });
    expect(patch.lines).toContainEqual({ kind: 'note', text: '\\ No newline at end of file' });
    expect(patch.lines.at(-1)).toEqual({ kind: 'add', text: 'next', next: 21 });
  });
  it('should align unequal replacements and retain additions for a new file', () => {
    // Arrange
    const patch = parseGitPatch('@@ -1,2 +1,3 @@\n-a\n-b\n+x\n+y\n+z\n');
    // Act
    const rows = splitGitLines(patch.lines);
    // Assert
    expect(rows.slice(1).map(row => [row.old?.text, row.next?.text])).toEqual([['a', 'x'], ['b', 'y'], [undefined, 'z']]);
    expect(sourcePatch('', true).lines).toEqual([]);
    expect(sourcePatch('hello\n', true).lines).toEqual([{ kind: 'add', text: 'hello', next: 1 }]);
    expect(parseGitPatch('Binary files a/a.png and b/a.png differ\n').binary).toBe(true);
  });
});
