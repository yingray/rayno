import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { SessionOperationsPage } from './pages/SessionOperationsPage';

const worktree = '/real/project/.dev/worktree/feature-check';
const phoneSizes = [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]];
const desktopSizes = [[1440, 900], [1024, 768]];

test('archive should offer to delete a clean worktree, cancel on close, and continue after the answer', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.gitStatus = '';
  await server.install(page);
  await server.updateMetadata({ path: worktree });
  const workspace = new SessionOperationsPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await workspace.openSession();
  // Act / Assert
  for (const [width, height] of touch ? phoneSizes : desktopSizes) {
    await page.setViewportSize({ width, height });
    await workspace.openActions(); await workspace.chooseAction('Archive session');
    await workspace.expectPromptUsable(workspace.worktreeDialog(), worktree, ['Close Delete this worktree?', 'Keep files', 'Delete worktree']);
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-worktree-${width}`);
    await workspace.press(workspace.worktreeDialog(), 'Close Delete this worktree?', touch);
    await expect(workspace.worktreeDialog()).toBeHidden();
    await expect(page).toHaveURL(/\/session\/real-session$/);
  }
  expect(server.mutations.filter((method) => !method.endsWith(':bash'))).toEqual([]);
  expect(server.bashCommands.every((command) => command.command === 'git status --porcelain' && command.cwd === worktree)).toBe(true);
  // Act
  await workspace.openActions(); await workspace.chooseAction('Archive session');
  await workspace.press(workspace.worktreeDialog(), 'Delete worktree', touch);
  // Assert
  await expect(page).toHaveURL(/\/sessions$/);
  expect(server.bashCommands.at(-1)).toMatchObject({ command: `git worktree remove '${worktree}' --force`, cwd: '/real/project' });
  const removal = server.mutations.lastIndexOf('computer:bash');
  expect(server.mutations.slice(removal + 1)).toEqual(['real-session:killSession']);
  expect(server.mutations).not.toContain('archive');
});

test('delete should replace its confirmation with the worktree offer and keep the files after Keep files', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.gitStatus = '';
  await server.install(page);
  await server.updateMetadata({ path: worktree });
  const workspace = new SessionOperationsPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await workspace.openSession();
  // Act
  await workspace.deleteFromInfo();
  await workspace.expectPromptUsable(workspace.worktreeDialog(), worktree, ['Keep files', 'Delete worktree']);
  await expect(page.getByRole('dialog', { name: 'Delete this session?' })).toHaveCount(0);
  await workspace.press(workspace.worktreeDialog(), 'Keep files', touch);
  // Assert
  await expect(page).toHaveURL(/\/sessions$/);
  expect(server.mutations).toContain('delete');
  expect(server.bashCommands.map((command) => command.command)).toEqual(['git status --porcelain']);
  expect(server.sessions.some((session) => session.id === 'real-session')).toBe(false);
});

test('a bot should archive through its agent only and offer no delete action', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.gitStatus = '';
  await server.install(page);
  await server.updateMetadata({ path: worktree, bot: { id: 'bot-1', username: 'helper' } });
  const workspace = new SessionOperationsPage(page);
  await page.goto('/session/real-session');
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  // Act / Assert
  await workspace.openActions();
  await expect(workspace.menu().getByRole('menuitem', { name: 'Delete session', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await workspace.info();
  await expect(workspace.deleteActions()).toHaveCount(0);
  await workspace.closeInfo();
  await workspace.openActions(); await workspace.chooseAction('Archive session');
  await expect(page).toHaveURL(/\/sessions$/);
  expect(server.mutations).toEqual(['real-session:killSession']);
  expect(server.bashCommands).toEqual([]);
});

test('fork should ask before it creates a missing folder, copy again after Cancel, and start once after Create folder', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.missingDirectories = ['/real/project'];
  await server.install(page);
  await server.updateMetadata({ claudeSessionId: 'original-provider-id' });
  const workspace = new SessionOperationsPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  const folder = page.getByRole('dialog', { name: 'Create this folder?', exact: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await workspace.openSession();
  const sizes = touch ? phoneSizes : desktopSizes;
  // Act / Assert
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await workspace.openActions(); await workspace.chooseAction('Fork');
    await workspace.expectPromptUsable(folder, '/real/project', ['Close Create this folder?', 'Cancel', 'Create folder']);
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-fork-folder-${width}`);
    await workspace.press(folder, 'Cancel', touch);
    await expect(folder).toBeHidden();
    await expect(page).toHaveURL(/\/session\/real-session$/);
  }
  // Act
  await workspace.openActions(); await workspace.chooseAction('Fork');
  await workspace.press(folder, 'Create folder', touch);
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  // Cancel drops the copied conversation, so each later Fork copies the current conversation again.
  expect(server.branchCalls.map((call) => call.method)).toEqual(Array(sizes.length + 1).fill('computer:claude-fork-session'));
  expect(server.spawns).toHaveLength(sizes.length + 2);
  expect(server.spawns.slice(0, -1).every((spawn) => !spawn.approvedNewDirectoryCreation)).toBe(true);
  expect(server.spawns.at(-1)).toMatchObject({ directory: '/real/project', approvedNewDirectoryCreation: true,
    resumeClaudeSessionId: 'copied-claude-id', parentSessionId: 'real-session' });
});

test('duplicate should replace its picker with the folder question and start after Create folder', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.missingDirectories = ['/real/project'];
  await server.install(page);
  await server.updateMetadata({ claudeSessionId: 'original-provider-id' });
  const workspace = new SessionOperationsPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  const folder = page.getByRole('dialog', { name: 'Create this folder?', exact: true });
  await workspace.openSession();
  // Act
  await workspace.openActions(); await workspace.chooseAction('Duplicate');
  await workspace.selectPoint('Message 17:'); await workspace.confirmDuplicate();
  // Assert
  await workspace.expectPromptUsable(folder, '/real/project', ['Cancel', 'Create folder']);
  await expect(workspace.duplicateDialog()).toHaveCount(0);
  // Act
  await workspace.press(folder, 'Create folder', touch);
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.branchCalls).toEqual([{ method: 'computer:claude-duplicate-session',
    params: expect.objectContaining({ cutAfterUuid: 'claude-17' }) }]);
  expect(server.spawns.map((spawn) => spawn.approvedNewDirectoryCreation)).toEqual([false, true]);
});
