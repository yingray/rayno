import type { HappyClient } from './client';
import { shellQuote } from './client';
import { hasGitSide, isUntracked, parseGitNumstat, parseGitPatch, parseGitStatus, sourcePatch, type GitFile, type GitPatch, type GitSide, type GitSnapshot } from '../data/gitChanges';
import { unbase64 } from './encoding';

export const GIT_PATCH_LIMIT = 512 * 1024;
export const GIT_STATUS_COMMAND = 'git --no-optional-locks status --porcelain=v1 -z --branch --untracked-files=all';
export const GIT_ROOT_COMMAND = 'git rev-parse --show-toplevel';
export const gitStatCommand = (side: GitSide) => `git --no-pager diff ${side === 'staged' ? '--cached ' : ''}--no-relative --numstat -z --find-renames --no-ext-diff --no-textconv --`;

export async function readGitSnapshot(client: HappyClient, id: string, cwd: string): Promise<GitSnapshot> {
  const rootResult = await client.bash(id, GIT_ROOT_COMMAND, cwd);
  const root = String(rootResult.stdout ?? '').replace(/\r?\n$/, '');
  if (!root.startsWith('/') && !/^[A-Za-z]:[/\\]/.test(root)) throw new Error('The agent did not report an absolute repository path.');
  const [status, working, staged] = await Promise.all([
    client.bash(id, GIT_STATUS_COMMAND, cwd), client.bash(id, gitStatCommand('working'), cwd), client.bash(id, gitStatCommand('staged'), cwd),
  ]);
  const snapshot = parseGitStatus(String(status.stdout ?? ''));
  const workingStats = parseGitNumstat(String(working.stdout ?? '')), stagedStats = parseGitNumstat(String(staged.stdout ?? ''));
  return { ...snapshot, root, files: snapshot.files.map(file => ({ ...file, workingStat: workingStats.get(file.path), stagedStat: stagedStats.get(file.path) })) };
}
export function gitPatchScript(file: GitFile, side: GitSide) {
  const paths = [file.path, ...(file.oldPath ? [file.oldPath] : [])].map(path => shellQuote(':(top,literal)' + path)).join(' ');
  // Consume the rest of stdout so the pipeline retains Git's exit status without a SIGPIPE from head.
  return `git --no-pager -c core.quotePath=false diff ${side === 'staged' ? '--cached ' : ''}--no-relative --no-ext-diff --no-textconv --no-color --find-renames -- ${paths} | (head -c ${GIT_PATCH_LIMIT + 1}; cat >/dev/null)`;
}
// The CLI uses the system shell. Select Bash explicitly because /bin/sh can lack pipefail.
export const gitPatchCommand = (file: GitFile, side: GitSide) => 'bash -o pipefail -c ' + shellQuote(gitPatchScript(file, side));
export async function readGitPatch(client: HappyClient, id: string, root: string, file: GitFile, side: GitSide, cwd = root): Promise<GitPatch> {
  if (!hasGitSide(file, side)) throw new Error('This file has no changes in the selected view.');
  if (isUntracked(file) || file.conflict) {
    // Symlinks can lead outside the workspace. The file RPC keeps the CLI's normal path checks.
    const result = await client.rpc(id, 'readFile', { path: root.replace(/\/$/, '') + '/' + file.path });
    if (!result.success || typeof result.content !== 'string') throw new Error(result.error || 'The agent cannot read this file.');
    if (result.content.length > Math.ceil(GIT_PATCH_LIMIT * 4 / 3) + 4) throw new Error('This file is too large to preview.');
    const bytes = unbase64(result.content);
    if (bytes.length > GIT_PATCH_LIMIT) throw new Error('This file is too large to preview.');
    if (bytes.includes(0)) return { text: '', lines: [], metadata: [], binary: true };
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { text: '', lines: [], metadata: [], binary: true }; }
    return sourcePatch(text, isUntracked(file));
  }
  const result = await client.bash(id, gitPatchCommand(file, side), cwd);
  const text = String(result.stdout ?? '');
  const truncated = new TextEncoder().encode(text).length > GIT_PATCH_LIMIT;
  return { ...parseGitPatch(text), truncated };
}
