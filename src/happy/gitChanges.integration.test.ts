import { afterEach, describe, expect, it } from 'vitest';
import { exec, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { HappyClient } from './client';
import { GIT_PATCH_LIMIT, readGitPatch, readGitSnapshot } from './gitChanges';

const run = promisify(exec), runFile = promisify(execFile), temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

describe('Git diff with a real repository', () => {
  it('should retain exact root-relative paths, separate Git layers, and cap patches through the CLI system shell', async () => {
    // Arrange: create an isolated repository, never the user's checkout.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'rayno-git-diff-'))); temporary.push(root);
    const cwd = join(root, 'src'), path = "src/中文 ' $(touch injected) [1].ts";
    const git = async (...args: string[]) => runFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Rayno test', '-c', 'user.email=rayno-test@example.invalid', ...args], { cwd: root });
    await git('init', '--initial-branch=main'); await mkdir(cwd);
    await writeFile(join(root, path), 'old\n'); await writeFile(join(cwd, 'large.ts'), 'base\n');
    await writeFile(join(cwd, 'old name.txt'), 'rename me\n'); await git('add', '.'); await git('commit', '-m', 'test fixture');
    await writeFile(join(root, path), 'staged\n'); await git('--literal-pathspecs', 'add', '--', path);
    await writeFile(join(root, path), 'working\n'); await git('mv', 'src/old name.txt', 'src/new name.txt');
    await writeFile(join(cwd, 'new file.ts'), 'untracked\n');
    await writeFile(join(cwd, 'large.ts'), ('a'.repeat(1000) + '\n').repeat(1100));
    const client = {
      bash: async (_id: string, command: string, directory: string) => {
        if (directory !== cwd) throw new Error('The CLI refuses a cwd outside this session.');
        return { success: true, ...(await run(command, { cwd: directory, timeout: 10000 })) };
      },
      rpc: async (_id: string, _method: string, params: { path: string }) => ({ success: true, content: (await readFile(params.path)).toString('base64') }),
    } as unknown as HappyClient;
    // Act
    const snapshot = await readGitSnapshot(client, 'test', cwd);
    const file = snapshot.files.find(file => file.path === path)!;
    const working = await readGitPatch(client, 'test', snapshot.root, file, 'working', cwd);
    const staged = await readGitPatch(client, 'test', snapshot.root, file, 'staged', cwd);
    const renamed = await readGitPatch(client, 'test', snapshot.root, snapshot.files.find(file => file.oldPath)!, 'staged', cwd);
    const large = await readGitPatch(client, 'test', snapshot.root, snapshot.files.find(file => file.path === 'src/large.ts')!, 'working', cwd);
    // Assert
    expect(snapshot.root).toBe(root);
    expect(file.stagedStat).toMatchObject({ added: 1, removed: 1 });
    expect(working.lines).toContainEqual({ kind: 'add', text: 'working', next: 1 });
    expect(staged.lines).toContainEqual({ kind: 'add', text: 'staged', next: 1 });
    expect(renamed.metadata.join('\n')).toContain('rename from src/old name.txt');
    expect(large.truncated).toBe(true);
    expect(new TextEncoder().encode(large.text).length).toBeLessThanOrEqual(GIT_PATCH_LIMIT + 1);
    await expect(readFile(join(cwd, 'injected'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
