import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import type { Json } from '../src/happy/normalize';

test('chat should keep a compact usable header without shortcuts or view tabs at every viewport', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft under the compact header');
  // Act / Assert
  for (const [width, height] of [[1440, 900], [320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await workspace.expectCompactChatHeader();
    await workspace.info();
    await workspace.closeInfo();
    await workspace.expectDraft('Keep this draft under the compact header');
    await workspace.expectNoPageOverflow();
    if (width === 320 || width === 1440) await workspace.capture(`${testInfo.project.name}-compact-chat-${width}`);
  }
  // Assert
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
});

test('the model picker should switch to Codex and preserve its model and effort through spawn', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  await page.getByLabel('Folder', { exact: true }).fill('/real/project');
  await workspace.taskDescription().fill('Use the selected Codex settings');
  // Act
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await workspace.newModelPicker().getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true }).click();
  await workspace.newModelPicker().getByRole('textbox', { name: 'Search models' }).fill('6.1');
  await workspace.newModelPicker().getByRole('radio', { name: 'GPT-6.1 Sol', exact: true }).click();
  await workspace.newModelPicker().getByRole('radio', { name: 'High', exact: true }).click();
  await workspace.capture(`${testInfo.project.name}-new-model-picker`);
  await workspace.expectNoPageOverflow();
  await workspace.newModelPicker().getByRole('button', { name: 'Done', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/new$/);
  expect(server.spawns).toEqual([]);
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('GPT-6.1 Sol');
  // Act
  await page.reload();
  // Assert
  await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('High');
  await workspace.capture(`${testInfo.project.name}-new-session-controls`);
  // Act
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns[0]).toMatchObject({ agent: 'codex', modelMode: 'gpt-6.1-sol', effortLevel: 'high' });
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.meta).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high' });
});

test('workspace choices should use real sessions, deduplicate folders, and preserve a selected checkout', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const legacy = server.sessions[1];
  for (const [id, path, machineId, activity] of [
    ['api-workspace', '/real/api', 'computer', Date.now() - 60000],
    ['worktree-workspace', '/real/project/.dev/worktree/review', 'computer', Date.now()],
    ['other-computer-workspace', '/private/other-computer', 'other-computer', Date.now()],
  ] as const) {
    server.sessions.push({ ...legacy, id, metadata: await server.encryption.encrypt({
      path, machineId, flavor: 'claude', lastMeaningfulMessageAt: activity,
    }, null) });
  }
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.openWorkspacePicker();
  const recent = workspace.workspacePicker().getByRole('group', { name: 'Recent workspaces', exact: true });
  // Assert
  await expect(recent.getByRole('button')).toHaveCount(3);
  await expect(recent).not.toContainText('/private/other-computer');
  await expect(recent.getByRole('button').first()).toContainText('review');
  await workspace.capture(`${testInfo.project.name}-workspace-picker`);
  // Act
  await workspace.workspacePicker().getByRole('textbox', { name: 'Search workspaces' }).fill('review');
  await recent.getByRole('button').click();
  // Assert
  await expect(page.getByLabel('Folder', { exact: true })).toHaveValue('~/project');
  await expect(page.getByLabel('Worktree', { exact: true })).toHaveValue('/real/project/.dev/worktree/review');
  expect(server.spawns).toEqual([]);
  await workspace.expectNoPageOverflow();
});

test('a manually entered workspace should remain recent after its session disappears and the page reloads', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.openWorkspacePicker();
  await workspace.workspacePicker().getByRole('textbox', { name: 'Workspace folder', exact: true }).fill('/real/new-workspace');
  await workspace.workspacePicker().getByRole('button', { name: 'Use folder', exact: true }).click();
  await workspace.taskDescription().fill('Remember this workspace');
  await workspace.startDraft();
  await expect(page).toHaveURL(/\/session\/created-session$/);
  server.sessions = server.sessions.filter((session) => session.id !== 'created-session');
  await page.goto('/new');
  await workspace.openWorkspacePicker();
  // Assert
  await expect(workspace.workspacePicker().getByRole('button', { name: 'Use workspace ~/new-workspace', exact: true })).toBeVisible();
  expect(server.spawns).toHaveLength(1);
});
