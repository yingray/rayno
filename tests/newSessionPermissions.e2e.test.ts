import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import type { Json } from '../src/happy/normalize';

for (const agent of ['Claude', 'Codex'] as const) {
  test(`new ${agent} sessions should use Auto in the spawn, first message, and chat without a saved choice`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const workspace = new LiveWorkspacePage(page);
    await page.goto('/new');
    await workspace.chooseNewAgent(agent);
    // Assert
    await expect(workspace.newPermissionMode()).toHaveValue('auto');
    await expect(workspace.newPermissionMode()).toHaveAttribute('required', '');
    // Act
    await page.getByLabel('Folder', { exact: true }).fill('/real/project');
    await workspace.taskDescription().fill('Use Auto for this session');
    await workspace.startDraft();
    // Assert
    await expect(page).toHaveURL(/\/session\/created-session$/);
    expect(server.spawns[0]).toMatchObject({ agent: agent.toLowerCase(), permissionMode: 'auto' });
    const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
    expect(raw.meta.permissionMode).toBe('auto');
    await expect(workspace.permissionMode()).toHaveText('Mode: Auto');
    // Act
    await page.reload();
    // Assert
    await expect(workspace.permissionMode()).toHaveText('Mode: Auto');
  });
}

test('new sessions and handoffs should restore each agent’s latest explicit permission choice, including later chat picks', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.chooseNewPermission('plan');
  await page.reload();
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('plan');
  // Act
  await workspace.chooseNewAgent('Codex');
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('auto');
  // Act
  await workspace.chooseNewPermission('safe-yolo');
  await workspace.chooseNewAgent('Claude');
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('plan');
  // Act
  await workspace.openSession();
  await workspace.openPermissionSettings();
  await workspace.choosePermission('Edits');
  await page.goto('/new');
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('acceptEdits');
  // Act
  await workspace.openSession();
  await workspace.handOff();
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('safe-yolo');
  // Act
  await workspace.chooseNewAgent('Claude');
  await page.reload();
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('acceptEdits');
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
});

test('a selected permission mode should reach the spawn and encrypted first message and remain selected after creation', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.chooseNewPermission('plan');
  await page.getByLabel('Folder', { exact: true }).fill('/real/project');
  await workspace.taskDescription().fill('Plan before you edit');
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns[0].permissionMode).toBe('plan');
  const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
  expect(raw.meta.permissionMode).toBe('plan');
  await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
  // Act
  await page.goto('/new');
  // Assert
  await expect(workspace.newPermissionMode()).toHaveValue('plan');
});

test('demo sessions should retain the selected permission mode in the new chat', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => localStorage.setItem('rayno.v2.mode', 'demo'));
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.chooseNewPermission('plan');
  await workspace.taskDescription().fill('Show the selected demo mode');
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\//);
  await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
  // Act
  await page.reload();
  // Assert
  await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
});

test('phone permission selection should remain reachable at narrow, keyboard-height, and landscape sizes', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new');
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.expectPermissionPickerUsableOnPhone(!!testInfo.project.use.hasTouch);
    await workspace.chooseNewPermission('plan');
    await expect(workspace.newPermissionMode()).toHaveValue('plan');
    await workspace.expectStartReachableOnPhone();
    await workspace.expectNoPageOverflow();
    await workspace.newPermissionMode().scrollIntoViewIfNeeded();
    if (width === 320 || width === 844) await workspace.capture(`${testInfo.project.name}-new-permission-${width}`);
    await workspace.chooseNewPermission('auto');
    await expect(workspace.newPermissionMode()).toHaveValue('auto');
  }
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
});
