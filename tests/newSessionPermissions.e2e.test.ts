import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import type { Json } from '../src/happy/normalize';
import { createInitialState } from '../src/data/fixtures';
import { STORAGE_KEY } from '../src/data/reducer';

for (const agent of ['Claude', 'Codex'] as const) {
  test(`new ${agent} sessions should use Yolo in the spawn, first message, and chat without a saved choice`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const workspace = new LiveWorkspacePage(page);
    await page.goto('/new');
    await workspace.chooseNewAgent(agent);
    const permissionMode = agent === 'Codex' ? 'yolo' : 'bypassPermissions';
    // Assert
    await expect(workspace.newPermissionMode()).toHaveValue(permissionMode);
    await expect(workspace.newPermissionMode()).toHaveAttribute('required', '');
    // Act
    await page.getByLabel('Folder', { exact: true }).fill('/real/project');
    await workspace.taskDescription().fill('Use Yolo for this session');
    await workspace.startDraft();
    // Assert
    await expect(page).toHaveURL(/\/session\/created-session$/);
    expect(server.spawns[0]).toMatchObject({ agent: agent.toLowerCase(), permissionMode });
    const raw = await server.encryption.decrypt<Json>(server.sends[0].content, server.dataKey);
    expect(raw.meta.permissionMode).toBe(permissionMode);
    await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
    // Act
    await page.reload();
    // Assert
    await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
  });
}

test('an implicit Auto draft should use Yolo while an explicit Auto choice should survive reload and agent changes', async ({ page }) => {
  // Arrange
  const state = createInitialState(1000000);
  state.newDraft.permissionMode = 'auto';
  await page.addInitScript(({ state, key }) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem('rayno.mode', 'demo');
    localStorage.setItem(key, JSON.stringify(state));
  }, { state, key: STORAGE_KEY });
  const workspace = new LiveWorkspacePage(page);
  // Act / Assert
  await page.goto('/new');
  await expect(workspace.newPermissionMode()).toHaveValue('bypassPermissions');
  await workspace.chooseNewPermission('auto');
  await page.reload();
  await expect(workspace.newPermissionMode()).toHaveValue('auto');
  await workspace.chooseNewAgent('Codex');
  await expect(workspace.newPermissionMode()).toHaveValue('yolo');
  await workspace.chooseNewAgent('Claude');
  await expect(workspace.newPermissionMode()).toHaveValue('auto');
});

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
  await expect(workspace.newPermissionMode()).toHaveValue('yolo');
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
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
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

test('phone new sessions should fill the screen and keep permissions, Start, and Close usable at narrow, keyboard-height, and landscape sizes', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new');
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.expectNewSessionFullscreen();
    await workspace.expectPermissionPickerUsableOnPhone(!!testInfo.project.use.hasTouch);
    await workspace.chooseNewPermission('plan');
    await expect(workspace.newPermissionMode()).toHaveValue('plan');
    await workspace.expectStartReachableOnPhone();
    await workspace.expectNoPageOverflow();
    await workspace.newPermissionMode().scrollIntoViewIfNeeded();
    if (width === 320 || width === 844) await workspace.capture(`${testInfo.project.name}-new-permission-${width}`);
    await workspace.chooseNewPermission('auto');
    await expect(workspace.newPermissionMode()).toHaveValue('auto');
    await workspace.taskDescription().fill('Keep this draft when the full screen closes');
    await workspace.closeNewSession(!!testInfo.project.use.hasTouch);
    await page.goto('/new');
    await expect(workspace.taskDescription()).toHaveValue('Keep this draft when the full screen closes');
    await expect(workspace.newPermissionMode()).toHaveValue('auto');
  }
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
});
