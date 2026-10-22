import type { Json } from './normalize';

// Adapted from v1 `components/autocomplete/findActiveWord.ts` and `applySuggestion.ts`.
export type Selection = { start: number; end: number };
export type ActiveWord = { word: string; activeWord: string; offset: number; length: number; activeLength: number; endOffset: number };
export const suggestionPrefixes = ['@', '/'];
const stopCharacters = ['\n', ',', '(', ')', '[', ']', '{', '}', '<', '>', ';', '!', '?', '.'];

function activeWordStart(content: string, selection: Selection, prefixes: string[]) {
  let index = selection.start - 1;
  let spaceIndex = -1;
  while (index >= 0) {
    const char = content.charAt(index);
    if (char === ' ') {
      if (spaceIndex >= 0) return spaceIndex + 1;
      spaceIndex = index--;
    } else if (prefixes.includes(char) && (index === 0 || content.charAt(index - 1) === ' ' || content.charAt(index - 1) === '\n')) {
      return index;
    } else if (stopCharacters.includes(char)) {
      return index + 1;
    } else index--;
  }
  return (spaceIndex >= 0 ? spaceIndex : index) + 1;
}

function activeWordEnd(content: string, cursor: number, start: number) {
  const filePath = content.charAt(start) === '@';
  let index = cursor;
  while (index < content.length) {
    const char = content.charAt(index);
    if (filePath && (char === '/' || char === '.')) { index++; continue; }
    if (char === ' ' || stopCharacters.includes(char)) break;
    index++;
  }
  return index;
}

export function findActiveWord(content: string, selection: Selection, prefixes = suggestionPrefixes): ActiveWord | undefined {
  if (selection.start !== selection.end || selection.start === 0) return undefined;
  const offset = activeWordStart(content, selection, prefixes);
  const activeWord = content.substring(offset, selection.end);
  if (!activeWord || activeWord.endsWith(' ') || !prefixes.includes(activeWord.charAt(0))) return undefined;
  const endOffset = activeWordEnd(content, selection.end, offset);
  const word = content.substring(offset, endOffset);
  return { word, activeWord, offset, length: word.length, activeLength: activeWord.length, endOffset };
}

export function applySuggestion(content: string, selection: Selection, suggestion: string, prefixes = suggestionPrefixes) {
  const active = findActiveWord(content, selection, prefixes);
  if (!active) {
    const inserted = suggestion + ' ';
    return { text: content.substring(0, selection.start) + inserted + content.substring(selection.end), cursorPosition: selection.start + inserted.length };
  }
  const after = content.substring(active.endOffset);
  const inserted = after.length === 0 || after[0] !== ' ' ? suggestion + ' ' : suggestion;
  return { text: content.substring(0, active.offset) + inserted + after, cursorPosition: active.offset + inserted.length };
}

// Adapted from v1 `sync/suggestionCommands.ts`.
export type CommandItem = { command: string; description?: string };
export const ignoredCommands = new Set(['add-dir', 'agents', 'config', 'statusline', 'bashes', 'settings', 'cost', 'doctor', 'exit',
  'help', 'ide', 'init', 'install-github-app', 'memory', 'migrate-installer', 'model', 'pr-comments', 'release-notes', 'resume',
  'status', 'bug', 'review', 'security-review', 'terminal-setup', 'upgrade', 'vim', 'permissions', 'hooks', 'export', 'logout', 'login']);
const defaultCommands: CommandItem[] = [
  { command: 'compact', description: 'Compact the conversation history' },
  { command: 'clear', description: 'Clear the conversation' },
  { command: 'goal', description: 'Set a session goal' },
  { command: 'mcp', description: 'Show connected MCP servers' },
  { command: 'skills', description: 'Show available skills' },
];
const commandDescriptions: Record<string, string> = {
  compact: 'Compact the conversation history', goal: 'Set a session goal', help: 'Show available commands',
  clear: 'Clear the conversation', reset: 'Reset the session', export: 'Export conversation', debug: 'Show debug information',
  status: 'Show connection status', stop: 'Stop current operation', abort: 'Abort current operation', cancel: 'Cancel current operation',
};

export function sessionCommands(metadata: Json): CommandItem[] {
  const commands = [...defaultCommands];
  const reported = [...(Array.isArray(metadata.slashCommands) ? metadata.slashCommands : []), ...(Array.isArray(metadata.skills) ? metadata.skills : [])];
  for (const command of reported)
    if (typeof command === 'string' && command && !ignoredCommands.has(command) && !commands.some((item) => item.command === command))
      commands.push({ command, description: Object.hasOwn(commandDescriptions, command) ? commandDescriptions[command] : undefined });
  return commands;
}

// Adapted from v1 `sync/suggestionFile.ts`, which reads `rg --files --follow` through the session `ripgrep` RPC.
export type FileItem = { fileName: string; filePath: string; fullPath: string; fileType: 'file' | 'folder' };
export const maxIndexedFiles = 50000;

export function parseRipgrepFiles(stdout: string): FileItem[] {
  const paths = stdout.split('\n').map((path) => path.replace(/\r$/, '')).filter((path) => path.trim()).slice(0, maxIndexedFiles);
  const files: FileItem[] = paths.map((path) => {
    const parts = path.split('/');
    const parent = parts.slice(0, -1).join('/');
    return { fileName: parts[parts.length - 1] || path, filePath: parent ? parent + '/' : '', fullPath: path, fileType: 'file' };
  });
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) if (parts.slice(0, index).join('/')) folders.add(parts.slice(0, index).join('/'));
  }
  for (const folder of folders) {
    const parts = folder.split('/');
    const parent = parts.slice(0, -1).join('/');
    files.push({ fileName: parts[parts.length - 1] + '/', filePath: parent ? parent + '/' : '', fullPath: folder + '/', fileType: 'folder' });
  }
  return files;
}

// As v1 `sync/rig.ts` `rigCanSearchFiles`: a Rig v1 session must advertise file search and the RPC.
export const canSearchFiles = (metadata: Json) => !(metadata.client?.id === 'rig' && (metadata.rigMetadataVersion ?? 0) >= 1)
  || (metadata.capabilities?.files?.search === true && Array.isArray(metadata.capabilities?.rpcMethods) && metadata.capabilities.rpcMethods.includes('ripgrep'));

// Rayno ranks with its own small matcher instead of Fuse.js. Lower scores sort first.
function matchScore(value: string | undefined, query: string) {
  if (!value) return Infinity;
  const text = value.toLowerCase();
  if (text === query) return 0;
  if (text.startsWith(query)) return 1 + text.length / 1e4;
  const index = text.indexOf(query);
  if (index >= 0) return 2 + index / 1e3 + text.length / 1e6;
  let position = -1, gaps = 0;
  for (const char of query) {
    const next = text.indexOf(char, position + 1);
    if (next < 0) return Infinity;
    if (position >= 0) gaps += next - position - 1;
    position = next;
  }
  return gaps <= Math.max(3, query.length * 2) ? 3 + gaps / 100 : Infinity;
}

export function rankItems<T>(items: T[], query: string, primary: (item: T) => string | undefined, secondary: (item: T) => string | undefined, limit = 50) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.slice(0, limit);
  return items.map((item, index) => ({ item, index, score: Math.min(matchScore(primary(item), needle), matchScore(secondary(item), needle) + 0.5) }))
    .filter((entry) => entry.score < Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit).map((entry) => entry.item);
}

export const searchCommands = (commands: CommandItem[], query: string) =>
  rankItems(commands, query, (item) => item.command, (item) => item.description);
export const searchFiles = (files: FileItem[], query: string) =>
  rankItems(files, query, (item) => item.fileName, (item) => item.fullPath);
