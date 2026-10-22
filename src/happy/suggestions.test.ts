import { describe, expect, it } from 'vitest';
import { applySuggestion, canSearchFiles, findActiveWord, parseRipgrepFiles, searchCommands, searchFiles, sessionCommands } from './suggestions';

const all = ['@', ':', '/'];

// Cases come from v1 `components/autocomplete/findActiveWord.test.ts` and `applySuggestion.test.ts`.
describe('Composer active word', () => {
  it.each([
    ['Hello @john', 11, '@john', '@john', 6, 11],
    ['Type /help for info', 10, '/help', '/help', 5, 10],
    ['Hello @', 7, '@', '@', 6, 7],
    ['Hello\n@user', 11, '@user', '@user', 6, 11],
    ['Hi, @user', 9, '@user', '@user', 4, 9],
    ['(@user)', 6, '@user', '@user', 1, 6],
    ['text;@user', 10, '@user', '@user', 5, 10],
    ['Hello  @user', 12, '@user', '@user', 7, 12],
    ['text @user name', 10, '@user', '@user', 5, 10],
    ['Hello @username!', 10, '@username', '@use', 6, 15],
    ['Hello @user, welcome', 9, '@user', '@us', 6, 11],
    ['Read @src/app/App.tsx now', 12, '@src/app/App.tsx', '@src/ap', 5, 21],
  ])('should find the word in %j at %d', (content, cursor, word, activeWord, offset, endOffset) => {
    // Act
    const result = findActiveWord(content, { start: cursor, end: cursor });
    // Assert
    expect(result).toEqual({ word, activeWord, offset, length: word.length, activeLength: activeWord.length, endOffset });
  });

  it('should find words with each v1 prefix in the same line', () => {
    // Arrange
    const content = 'Hey @john, use :smile: and /help';
    // Act / Assert
    expect(findActiveWord(content, { start: 9, end: 9 }, all)?.word).toBe('@john');
    expect(findActiveWord(content, { start: 22, end: 22 }, all)?.word).toBe(':smile:');
    expect(findActiveWord(content, { start: 32, end: 32 }, all)?.word).toBe('/help');
  });

  it.each([
    ['email@domain.com', 16, { start: 16, end: 16 }],
    ['@user', 0, { start: 0, end: 0 }],
    ['Hello @user', 11, { start: 6, end: 11 }],
    ['', 0, { start: 0, end: 0 }],
    ['Hello world', 8, { start: 8, end: 8 }],
    ['Hello $user', 11, { start: 11, end: 11 }],
    ['see src/app', 11, { start: 11, end: 11 }],
    ['Hello @user ', 12, { start: 12, end: 12 }],
  ])('should find no word in %j at %d', (content, _cursor, selection) => {
    // Act / Assert
    expect(findActiveWord(content, selection)).toBeUndefined();
  });

  it.each([
    ['Hello @joh', 10, '@john_smith', 'Hello @john_smith ', 18],
    ['Type /hel', 9, '/help', 'Type /help ', 11],
    ['Hello @username here', 10, '@john_smith', 'Hello @john_smith here', 17],
    ['Hello @username', 7, '@john_smith', 'Hello @john_smith ', 18],
    ['Hi', 2, '/compact', 'Hi/compact ', 11],
  ])('should apply %s at %d with %s', (content, cursor, suggestion, text, cursorPosition) => {
    // Act / Assert
    expect(applySuggestion(content, { start: cursor, end: cursor }, suggestion)).toEqual({ text, cursorPosition });
  });
});

describe('Composer suggestion sources', () => {
  it('should merge reported commands and skills after the v1 defaults without ignored or repeated names', () => {
    // Arrange
    const metadata = { slashCommands: ['compact', 'review', 'pr-review', 'help', 'debug'], skills: ['pr-review', 'deploy', 7] };
    // Act
    const commands = sessionCommands(metadata);
    // Assert
    expect(commands.map((item) => item.command)).toEqual(['compact', 'clear', 'goal', 'mcp', 'skills', 'pr-review', 'debug', 'deploy']);
    expect(commands.find((item) => item.command === 'debug')?.description).toBe('Show debug information');
    expect(sessionCommands({}).map((item) => item.command)).toEqual(['compact', 'clear', 'goal', 'mcp', 'skills']);
  });

  it('should rank exact, prefix, substring, and fuzzy command matches', () => {
    // Arrange
    const commands = sessionCommands({ slashCommands: ['compact-plus', 'my-compact', 'cmpct'] });
    // Act
    const names = searchCommands(commands, 'compact').map((item) => item.command);
    // Assert
    expect(names.slice(0, 3)).toEqual(['compact', 'compact-plus', 'my-compact']);
    expect(searchCommands(commands, 'mcp').map((item) => item.command)[0]).toBe('mcp');
    expect(searchCommands(commands, 'zzz')).toEqual([]);
    expect(searchCommands(commands, '')).toHaveLength(commands.length);
  });

  it('should index ripgrep files and their folders as v1 does', () => {
    // Arrange
    const stdout = 'src/app/App.tsx\nREADME.md\r\nsrc/app/app.module.css\n\n';
    // Act
    const files = parseRipgrepFiles(stdout);
    // Assert
    expect(files).toEqual([
      { fileName: 'App.tsx', filePath: 'src/app/', fullPath: 'src/app/App.tsx', fileType: 'file' },
      { fileName: 'README.md', filePath: '', fullPath: 'README.md', fileType: 'file' },
      { fileName: 'app.module.css', filePath: 'src/app/', fullPath: 'src/app/app.module.css', fileType: 'file' },
      { fileName: 'src/', filePath: '', fullPath: 'src/', fileType: 'folder' },
      { fileName: 'app/', filePath: 'src/', fullPath: 'src/app/', fileType: 'folder' },
    ]);
    expect(searchFiles(files, 'app.tsx').map((item) => item.fullPath)[0]).toBe('src/app/App.tsx');
    expect(searchFiles(files, 'src/app').map((item) => item.fullPath)).toContain('src/app/');
  });

  it.each([
    [{ flavor: 'claude' }, true],
    [{ client: { id: 'rig' }, rigMetadataVersion: 1, capabilities: { files: { search: true }, rpcMethods: ['ripgrep'] } }, true],
    [{ client: { id: 'rig' }, rigMetadataVersion: 1, capabilities: { files: { search: true }, rpcMethods: ['bash'] } }, false],
    [{ client: { id: 'rig' }, rigMetadataVersion: 1 }, false],
    [{ client: { id: 'rig' } }, true],
  ])('should gate file search for %j as %s', (metadata, expected) => {
    // Act / Assert
    expect(canSearchFiles(metadata)).toBe(expected);
  });
});
