import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const rigCatalog = [
  { id: 'same-model', providerId: 'provider-one', providerName: 'Provider One', name: 'Shared model', thinkingLevels: ['low', 'high'], defaultThinkingLevel: 'high' },
  { id: 'same-model', providerId: 'provider-two', providerName: 'Provider Two', name: 'Shared model', thinkingLevels: ['low'], defaultThinkingLevel: 'low' },
];

test('a CLI session without a model catalog should offer concrete models and explicit effort choices', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const source = server.sessions[0];
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(source.metadata, server.dataKey);
  source.metadata = await server.encryption.encrypt({ ...metadata, models: undefined, effortLevel: 'high' }, server.dataKey);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.openModelSettings();
  await workspace.chooseModel('Opus 5');
  await workspace.chooseEffort('Max');
  await workspace.closeModelSettings();
  await workspace.send('Use maximum effort');
  await workspace.expectDraft('');
  await workspace.openModelSettings();
  await workspace.chooseEffort('High');
  await workspace.closeModelSettings();
  await workspace.send('Use high effort');
  await workspace.expectDraft('');
  // Assert
  const first = await server.encryption.decrypt<Record<string, unknown>>(server.sends[0].content, server.dataKey);
  const second = await server.encryption.decrypt<Record<string, unknown>>(server.sends[1].content, server.dataKey);
  expect(first).toMatchObject({ meta: { model: 'claude-opus-5', effort: 'max' } });
  expect(second).toMatchObject({ meta: { model: 'claude-opus-5', effort: 'high' } });
});

test('model and effort picks should persist and reach encrypted messages with the correct Rig provider', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const source = server.sessions[0];
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(source.metadata, server.dataKey);
  source.metadata = await server.encryption.encrypt({ ...metadata, flavor: 'rig', client: { id: 'rig' },
    models: rigCatalog, lastMode: { modelId: 'same-model', providerId: 'provider-one', effort: 'high', permissionMode: 'default', serviceTier: null },
  }, server.dataKey);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.openModelSettings();
  await workspace.chooseModel('Provider Two · Shared model');
  await expect(page.getByRole('radiogroup', { name: 'Effort', exact: true }).getByRole('radio', { name: 'High', exact: true })).toHaveCount(0);
  await workspace.chooseEffort('Low');
  await workspace.capture(`${testInfo.project.name}-model-effort`);
  await workspace.expectNoPageOverflow();
  await workspace.closeModelSettings();
  await page.reload();
  await workspace.openModelSettings();
  await expect(page.getByRole('radio', { name: 'Provider Two · Shared model', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Low', exact: true })).toBeChecked();
  await workspace.closeModelSettings();
  await workspace.send('Use the selected model and effort');
  // Assert
  await workspace.expectDraft('');
  const raw = await server.encryption.decrypt<Record<string, unknown>>(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ meta: { model: 'same-model', modelProviderId: 'provider-two', effort: 'low' } });
  expect(server.spawns).toEqual([]);
});

test('a new CLI session should apply the selected model and effort to both spawn and its first message', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/new');
  // Act
  await workspace.chooseNewModel('Opus 5');
  await workspace.chooseNewEffort('Max');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('Opus 5');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('Max');
  await page.getByLabel('Folder', { exact: true }).fill('/real/project');
  await page.getByRole('textbox', { name: 'Task description' }).fill('Start with the selected effort');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns).toHaveLength(1);
  expect(server.spawns[0]).toMatchObject({ modelMode: 'claude-opus-5', effortLevel: 'max' });
  const raw = await server.encryption.decrypt<Record<string, unknown>>(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ meta: { model: 'claude-opus-5', effort: 'max' } });
});

test('new-session controls should hide Happy Agent and migrate a saved legacy draft to a concrete CLI choice', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .some((key) => key.startsWith('rayno.v2.account.') && key.endsWith('.ui')))).toBe(true);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('rayno.v2.account.') && key.endsWith('.ui'))!;
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.newDraft.agent = 'Happy Agent';
    saved.newDraft.model = 'Agent default';
    saved.newDraft.effort = null;
    localStorage.setItem(key, JSON.stringify(saved));
  });
  // Act
  await page.reload();
  // Assert
  await expect(page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Claude', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Happy Agent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).not.toContainText('Agent default');
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await expect(workspace.newModelPicker().getByRole('button', { name: 'Happy Agent', exact: true })).toHaveCount(0);
  await expect(workspace.newModelPicker().getByRole('radio', { name: 'Agent default', exact: true })).toHaveCount(0);
  expect(server.spawns).toEqual([]);
});
