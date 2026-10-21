import { test, expect } from '@playwright/test';
import { WorkspacePage } from './pages/WorkspacePage';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
});

test('session lifecycle should preserve edits and honor stop, archive, and delete', async ({
  page,
}) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await workspace.open();
  // Act
  await workspace.create('Build a quiet dashboard');
  const sessionUrl = page.url();
  await workspace.stop();
  await workspace.send('Add a useful empty state');
  await expect(page.getByText('This is a simulated response', { exact: false })).toBeVisible();
  await workspace.info();
  await workspace.rename('My dashboard');
  await workspace.closeInfo();
  await page.reload();
  // Assert
  await expect(
    page.getByRole('button', { name: 'Open session info', exact: true }).first(),
  ).toContainText('My dashboard');
  await expect(page.getByText('Add a useful empty state', { exact: true }).first()).toBeVisible();
  await workspace.info();
  await workspace.archive();
  await expect(page).toHaveURL(/\/sessions$/);
  await workspace.setListVisibility(true);
  await expect(page.getByRole('button', { name: /My dashboard/ }).first()).toBeVisible();
  await workspace.route(`${new URL(sessionUrl).pathname}/info`);
  await workspace.delete();
  await expect(page).toHaveURL(/\/sessions$/);
  await workspace.route(new URL(sessionUrl).pathname);
  await expect(page.getByRole('heading', { name: 'Session not found' })).toBeVisible();
});

test('workspace navigation should preserve preferences and drafts across reloads', async ({
  page,
}) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await workspace.route('/settings/appearance');
  // Act
  await page.getByRole('button', { name: 'Use blue message bubbles' }).click();
  await page.getByRole('switch', { name: 'Enter to send' }).click();
  await workspace.route('/session/floating-panels');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft');
  await page.reload();
  // Assert
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft',
  );
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(/\n/);
  await workspace.route('/settings/appearance');
  await expect(page.getByRole('button', { name: 'Use blue message bubbles' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('switch', { name: 'Enter to send' })).not.toBeChecked();
  await workspace.route('/monitor');
  await page.getByLabel('Monitor preview state').selectOption('empty');
  await expect(page.getByRole('heading', { name: 'No computers yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  await page.getByLabel('Monitor preview state').selectOption('error');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'ray-mbp', exact: true })).toBeVisible();
});

test('six screens should stay within the viewport at reference sizes and breakpoints', async ({
  page,
}, testInfo) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const routes = [
    ['sessions', '/sessions'],
    ['chat', '/session/floating-panels'],
    ['new', '/new'],
    ['monitor', '/monitor'],
    ['info', '/session/floating-panels/info'],
    ['settings', '/settings/appearance'],
  ];
  // Act
  for (const [name, path] of routes) {
    await workspace.route(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await workspace.expectNoPageOverflow();
    await workspace.capture(`${testInfo.project.name}-${name}`);
  }
  if (testInfo.project.name === 'desktop-chromium') {
    for (const width of [767, 768, 1023, 1024, 1279, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await workspace.route('/session/floating-panels/info');
      await workspace.expectNoPageOverflow();
    }
  }
  // Assert
  expect(errors).toEqual([]);
});

test('tablet drawers should trap focus, close with Escape, and retain rail preferences', async ({
  page,
}) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await workspace.route('/session/floating-panels');
  // Act
  await page.keyboard.press('ControlOrMeta+k');
  const list = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByRole('textbox', { name: 'Search sessions' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workspace.listOptions()).toHaveCount(0);
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await workspace.info();
  await workspace.rename('A tablet session');
  await page
    .getByRole('button', { name: /^Rename/ })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'Session name', exact: true }).fill('Do not save');
  await page.keyboard.press('Escape');
  // Assert
  await expect(page.getByRole('dialog', { name: 'Session info', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Session name', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('installed app shell should load routes and local conversations while offline', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'One Chromium context verifies the generated service worker.',
  );
  // Arrange
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: 'allow',
  });
  try {
    await context.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
    const page = await context.newPage();
    const workspace = new WorkspacePage(page);
    await workspace.open();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // Act
    await context.setOffline(true);
    await workspace.route('/session/floating-panels');
    // Assert
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await workspace.send('An offline local request');
    await expect(page.getByText('This is a simulated response', { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
});
