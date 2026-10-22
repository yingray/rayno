import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import type { Json } from '../src/happy/normalize';

test('a missing folder should ask for approval, keep the draft on Cancel, and start after Create folder', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.missingDirectories = ['/real/new-project'];
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new');
  await page.getByLabel('Folder', { exact: true }).fill('~/new-project');
  await workspace.taskDescription().fill('Set up the new project');
  const sizes = touch ? [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]] : [[1440, 900], [1024, 768]];
  // Act / Assert
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await workspace.expectStartReachableOnPhone();
    await workspace.startDraft();
    await workspace.expectFolderDialogUsable('/real/new-project');
    await workspace.expectNoPageOverflow();
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-new-folder-${width}`);
    await workspace.answerFolderDialog('Cancel', touch);
    await expect(page).toHaveURL(/\/new$/);
    await expect(workspace.taskDescription()).toHaveValue('Set up the new project');
  }
  expect(server.spawns).toHaveLength(sizes.length);
  expect(server.spawns.every((spawn) => spawn.directory === '/real/new-project' && spawn.approvedNewDirectoryCreation === false)).toBe(true);
  expect(server.sends).toEqual([]);
  // Act
  await workspace.startDraft();
  await workspace.expectFolderDialogUsable('/real/new-project');
  await workspace.answerFolderDialog('Create folder', touch);
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns).toHaveLength(sizes.length + 2);
  expect(server.spawns.at(-1)).toMatchObject({ directory: '/real/new-project', approvedNewDirectoryCreation: true, permissionMode: 'bypassPermissions' });
  expect(server.sends).toHaveLength(1);
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.content.text).toBe('Set up the new project');
});
