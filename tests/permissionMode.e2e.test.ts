import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('permission mode should show the inherited value and preserve explicit picks across reload and send', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ permissionMode: 'bypassPermissions' });
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
  await expect(workspace.permissionMode()).toHaveAttribute('title', 'Permission mode: Yolo (bypassPermissions)');
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-permission-mode`);
  // Act
  await workspace.openPermissionSettings();
  await expect(page.getByRole('radio', { name: 'Use agent mode · Yolo', exact: true })).toBeChecked();
  await workspace.choosePermission('Plan');
  await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
  await page.reload();
  await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
  await workspace.send('Use the selected permission mode');
  await workspace.expectDraft('');
  await workspace.openPermissionSettings();
  await workspace.choosePermission('Use agent mode · Yolo');
  await workspace.send('Follow the reported agent mode');
  await workspace.expectDraft('');
  // Assert
  const raw = await Promise.all(server.sends.map((packet) =>
    server.encryption.decrypt<{ meta: { permissionMode: string } }>(packet.content, server.dataKey),
  ));
  expect(raw.map((message) => message.meta.permissionMode)).toEqual(['plan', 'bypassPermissions']);
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
});

test('permission mode should use daemon labels and track its reported mode until an explicit pick', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const modes = [
    { code: 'review', value: 'Review changes' },
    { code: 'read', value: 'Read only' },
  ];
  await server.updateMetadata({ flavor: 'rig', client: { id: 'rig' }, operatingModes: modes,
    currentModelCode: 'rig-model', currentModelProviderId: 'provider',
    models: [{ id: 'rig-model', providerId: 'provider', name: 'Rig model', thinkingLevels: [] }],
    lastMode: { permissionMode: 'review' } });
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await expect(workspace.permissionMode()).toHaveText('Mode: Review changes');
  await workspace.expectConnected();
  await workspace.expectPermissionLabelReadable();
  // Act
  await server.updateMetadata({ lastMode: { permissionMode: 'read' } });
  // Assert
  await expect(workspace.permissionMode()).toHaveText('Mode: Read only');
  await workspace.openPermissionSettings();
  await workspace.choosePermission('Review changes');
  await workspace.send('Use the published mode code');
  await workspace.expectDraft('');
  const raw = await server.encryption.decrypt<{ meta: { permissionMode: string } }>(server.sends[0].content, server.dataKey);
  expect(raw.meta.permissionMode).toBe('review');
  await expect(workspace.permissionMode()).toHaveText('Mode: Review changes');
});

test('an unreported permission mode should stay explicit without sending a guessed default', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await expect(workspace.permissionMode()).toHaveText('Mode: Not reported');
  await workspace.expectPermissionLabelReadable();
  await workspace.send('Keep the daemon permission mode');
  // Assert
  await workspace.expectDraft('');
  const raw = await server.encryption.decrypt<{ meta: object }>(server.sends[0].content, server.dataKey);
  expect(raw.meta).not.toHaveProperty('permissionMode');
});

test('a locked permission mode should stay visible and prevent unavailable picks', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ flavor: 'rig', client: { id: 'rig' }, currentOperatingModeCode: 'review',
    operatingModes: [{ code: 'review', value: 'Review changes' }, { code: 'read', value: 'Read only' }],
    capabilities: { permissionModeSelection: false } });
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.openPermissionSettings();
  // Assert
  await expect(page.getByText('This session locks permission mode selection.', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Read only', exact: true })).toBeDisabled();
  expect(server.sends).toEqual([]);
});
