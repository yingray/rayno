import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('new sessions and handoffs should reuse concrete choices for each agent and track later chat selections', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ models: undefined });
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/new');
  // Act
  await workspace.chooseNewModel('Opus 5');
  await workspace.chooseNewEffort('Max');
  await page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true }).click();
  await workspace.chooseNewModel('GPT-6.1 Sol');
  await workspace.chooseNewEffort('High');
  await page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Claude', exact: true }).click();
  // Assert
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('Opus 5');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('Max');
  // Act
  await page.reload();
  await workspace.openSession();
  await page.goto('/new');
  // Assert
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('Opus 5');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('Max');
  // Act
  await workspace.openSession();
  await workspace.handOff();
  // Assert
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('GPT-6.1 Sol');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('High');
  // Act
  await workspace.openSession();
  await workspace.openModelSettings();
  await expect(page.getByRole('radio', { name: 'Agent default', exact: true })).toHaveCount(0);
  await workspace.chooseModel('Fable 5.1');
  await workspace.chooseEffort('Low');
  await workspace.closeModelSettings();
  await page.goto('/new');
  await page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Claude', exact: true }).click();
  // Assert
  await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toContainText('Fable 5.1');
  await expect(page.getByRole('button', { name: 'Choose effort', exact: true })).toContainText('Low');
  expect(server.spawns).toEqual([]);
  expect(server.sends).toEqual([]);
});

test('phone selectors should support touch, narrow widths, keyboard-height scrolling, and an explicit start', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new');
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Choose model', exact: true }).click();
    const dialog = workspace.newModelPicker();
    await expect(dialog.getByRole('group', { name: 'Agent', exact: true }).getByRole('button')).toHaveCount(2);
    await expect(dialog.getByRole('radio', { name: 'Agent default', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Codex', exact: true }).click();
    await dialog.getByRole('radio', { name: 'GPT-6.1 Sol', exact: true }).click();
    await dialog.getByRole('radio', { name: 'High', exact: true }).click();
    await workspace.expectPickerUsableOnPhone();
    if (width === 320 || width === 844) {
      await dialog.getByRole('button', { name: 'Codex', exact: true }).scrollIntoViewIfNeeded();
      await workspace.capture(`${testInfo.project.name}-model-picker-${width}x${height}`);
    }
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await workspace.expectNoPageOverflow();
  }
  // Act
  await page.setViewportSize({ width: 390, height: 430 });
  await workspace.openWorkspacePicker();
  await workspace.workspacePicker().getByRole('button', { name: 'Use workspace ~/project', exact: true }).click();
  await workspace.taskDescription().fill('Start from the short phone viewport');
  await workspace.expectStartReachableOnPhone();
  await workspace.capture(`${testInfo.project.name}-short-phone-controls`);
  await workspace.startDraft();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns[0]).toMatchObject({ agent: 'codex', modelMode: 'gpt-6.1-sol', effortLevel: 'high' });
  expect(server.sends).toHaveLength(1);
});
