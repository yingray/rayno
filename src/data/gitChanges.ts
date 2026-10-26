export type GitSide = 'working' | 'staged';
export type GitStat = { added: number; removed: number; binary: boolean };
export type GitFile = {
  path: string; oldPath?: string; index: string; working: string; conflict: boolean;
  stagedStat?: GitStat; workingStat?: GitStat;
};
export type GitSnapshot = { root: string; branch: string; upstream?: string; ahead: number; behind: number; files: GitFile[] };
export type PatchLine = { kind: 'add' | 'remove' | 'context' | 'hunk' | 'note'; text: string; old?: number; next?: number };
export type GitPatch = { text: string; lines: PatchLine[]; metadata: string[]; binary: boolean; truncated?: boolean; source?: boolean };
const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

// Porcelain v1 with -z keeps paths verbatim. Rename records carry the destination before the source.
export function parseGitStatus(text: string): Omit<GitSnapshot, 'root'> {
  const records = text.split('\0'), files: GitFile[] = [];
  let branch = '', upstream: string | undefined, ahead = 0, behind = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('## ')) {
      const header = record.slice(3).replace(/^(?:No commits yet on |Initial commit on )/, '');
      const tracking = /^(.*?)\.\.\.([^\s]+)(?: \[(.*?)\])?$/.exec(header);
      branch = tracking?.[1] ?? header;
      upstream = tracking?.[2];
      ahead = Number(/ahead (\d+)/.exec(tracking?.[3] ?? '')?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(tracking?.[3] ?? '')?.[1] ?? 0);
      continue;
    }
    if (record.length < 4 || record[2] !== ' ') continue;
    const index = record[0], working = record[1], path = record.slice(3);
    const oldPath = /[RC]/.test(index + working) ? records[++i] : undefined;
    if (index === '!' && working === '!') continue;
    files.push({ path, ...(oldPath ? { oldPath } : {}), index, working, conflict: conflicts.has(index + working) });
  }
  return { branch, upstream, ahead, behind, files };
}

export function parseGitNumstat(text: string): Map<string, GitStat> {
  const records = text.split('\0'), stats = new Map<string, GitStat>();
  for (let i = 0; i < records.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[i]);
    if (!match) continue;
    let path = match[3];
    if (!path) { i++; path = records[++i]; }
    if (path !== undefined) stats.set(path, { added: Number(match[1]) || 0, removed: Number(match[2]) || 0, binary: match[1] === '-' });
  }
  return stats;
}
export const isUntracked = (file: GitFile) => file.index === '?' && file.working === '?';
export const hasGitSide = (file: GitFile, side: GitSide) => side === 'working'
  ? file.working !== ' ' : !file.conflict && file.index !== ' ' && file.index !== '?';
export const preferredGitSide = (file: GitFile): GitSide => hasGitSide(file, 'working') ? 'working' : 'staged';
export function gitStatusLabel(file: GitFile, side?: GitSide): string {
  if (file.conflict) return 'Conflict';
  if (isUntracked(file)) return 'Untracked';
  const status = side === 'staged' ? file.index : side === 'working' ? file.working : file.working !== ' ' ? file.working : file.index;
  return ({ A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed' } as Record<string, string>)[status] ?? 'Changed';
}

export function parseGitPatch(text: string): GitPatch {
  const lines: PatchLine[] = [], metadata: string[] = [];
  let old = 0, next = 0, inHunk = false;
  const source = text.split('\n');
  if (source.at(-1) === '') source.pop();
  for (const line of source) {
    if (line.startsWith('diff --git ')) inHunk = false;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); inHunk = true; lines.push({ kind: 'hunk', text: line }); }
    else if (!inHunk) metadata.push(line);
    else if (line[0] === '+') lines.push({ kind: 'add', text: line.slice(1), next: next++ });
    else if (line[0] === '-') lines.push({ kind: 'remove', text: line.slice(1), old: old++ });
    else if (line[0] === ' ') lines.push({ kind: 'context', text: line.slice(1), old: old++, next: next++ });
    else lines.push({ kind: 'note', text: line });
  }
  return { text, lines, metadata, binary: metadata.some(line => /^Binary files |^GIT binary patch/.test(line)) };
}
export function sourcePatch(text: string, added: boolean): GitPatch {
  const content = text.split('\n');
  if (content.at(-1) === '') content.pop();
  return { text, metadata: [], binary: false, source: true,
    lines: content.map((line, index) => ({ kind: added ? 'add' : 'context', text: line, next: index + 1 })) };
}
export type SplitLine = { old?: PatchLine; next?: PatchLine; marker?: PatchLine };
export function splitGitLines(lines: PatchLine[]): SplitLine[] {
  const output: SplitLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'remove' || line.kind === 'add') {
      const removed: PatchLine[] = [], added: PatchLine[] = [];
      while (i < lines.length && (lines[i].kind === 'remove' || lines[i].kind === 'add')) {
        (lines[i].kind === 'remove' ? removed : added).push(lines[i++]);
      }
      i--;
      for (let j = 0; j < Math.max(removed.length, added.length); j++) output.push({ old: removed[j], next: added[j] });
    } else if (line.kind === 'context') output.push({ old: line.old === undefined ? undefined : line, next: line });
    else output.push({ marker: line });
  }
  return output;
}
