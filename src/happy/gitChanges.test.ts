import { describe, expect, it, vi } from 'vitest';
import { shellQuote, type HappyClient } from './client';
import { gitPatchCommand, gitPatchScript, gitStatCommand, GIT_PATCH_LIMIT, GIT_ROOT_COMMAND, GIT_STATUS_COMMAND, readGitPatch, readGitSnapshot } from './gitChanges';
import type { GitFile } from '../data/gitChanges';

describe('Git workspace reads', () => {
  it('should retain the allowed session cwd and root-relative paths for a nested session folder', async () => {
    // Arrange
    const bash = vi.fn(async (_id: string, command: string, _cwd?: string) => ({ stdout: command === GIT_ROOT_COMMAND ? '/repo with spaces\n'
      : command === GIT_STATUS_COMMAND ? '## main\0MM src/a.ts\0' : command === gitStatCommand('staged') ? '2\t1\tsrc/a.ts\0' : '3\t2\tsrc/a.ts\0' }));
    // Act
    const snapshot = await readGitSnapshot({ bash } as unknown as HappyClient, 'session', '/repo with spaces/subfolder');
    // Assert
    expect(snapshot.root).toBe('/repo with spaces');
    expect(snapshot.files[0]).toMatchObject({ stagedStat: { added: 2, removed: 1 }, workingStat: { added: 3, removed: 2 } });
    expect(bash.mock.calls.every(call => call[2] === '/repo with spaces/subfolder')).toBe(true);
  });
  it('should quote literal paths and disable external diff execution for per-file reads', () => {
    // Arrange
    const file: GitFile = { path: "a'$(echo injected) [x].ts", oldPath: ':(glob)*', index: 'R', working: ' ', conflict: false };
    // Act
    const command = gitPatchScript(file, 'staged');
    // Assert
    expect(command).toContain(':(top,literal)');
    expect(command).toContain('--no-ext-diff --no-textconv --no-color');
    expect(command).toContain("-- ':(top,literal)a'\\''$(echo injected) [x].ts' ':(top,literal):(glob)*'");
    expect(command).toContain('--cached');
    expect(command).toContain(`head -c ${GIT_PATCH_LIMIT + 1}`);
    expect(gitPatchCommand(file, 'staged')).toBe('bash -o pipefail -c ' + shellQuote(command));
  });
  it('should read untracked files through the file RPC and keep binary bytes out of text diffs', async () => {
    // Arrange
    const file: GitFile = { path: 'new file.ts', index: '?', working: '?', conflict: false };
    const rpc = vi.fn().mockResolvedValueOnce({ success: true, content: btoa('new content\n') }).mockResolvedValueOnce({ success: true, content: btoa('\0data') });
    const bash = vi.fn(), client = { rpc, bash } as unknown as HappyClient;
    // Act / Assert
    expect((await readGitPatch(client, 'session', '/repo', file, 'working')).lines).toEqual([{ kind: 'add', text: 'new content', next: 1 }]);
    expect((await readGitPatch(client, 'session', '/repo', file, 'working')).binary).toBe(true);
    expect(rpc).toHaveBeenCalledWith('session', 'readFile', { path: '/repo/new file.ts' });
    expect(bash).not.toHaveBeenCalled();
  });
});
