import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { SyncStatusPage } from './pages/SyncStatusPage';

const phones = [[320, 740], [360, 800], [390, 844], [430, 932], [390, 360], [844, 390]];

test('the sync status demo should stay quiet, show retry only after a failure, and keep the messages in place', async ({ page }, info) => {
  // The phone sizes repeat the full failure and retry flow.
  test.setTimeout(120000);
  // Arrange
  const view = new SyncStatusPage(page);
  const touch = !!info.project.use.hasTouch;
  await view.openDemo();
  await expect(page.locator('[data-sync-status]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft');
  // Act: a normal resume.
  await view.step('Return from background');
  const top = await view.introTop();
  // Assert
  await expect(view.status('Conversation')).toContainText('Syncing…');
  expect(await view.introTop()).toBe(top);
  await expect(view.status('Conversation')).toContainText('Synced');
  await expect(page.locator('[data-sync-status]')).toHaveCount(0);
  // Act: the network goes and returns.
  await view.step('Lose the network');
  await expect(view.status('Conversation')).toContainText('Offline · saved on this device');
  await view.step('Network returns');
  // Assert
  await expect(view.status('Conversation')).toContainText('Reconnecting…');
  await expect(page.locator('[data-sync-status]')).toHaveCount(0, { timeout: 8000 });
  // Act / Assert: a failure shows Retry and the details at every phone size.
  const sizes = touch ? phones : [[1440, 900]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    // The tap can scroll the page. Measure after it, before the status shows.
    await view.step('Fail the sync');
    const before = await view.introTop();
    await expect(view.failure()).toContainText('Could not sync');
    expect(await view.introTop()).toBe(before);
    const retry = view.failure().getByRole('button', { name: 'Retry', exact: true });
    await view.expectReachable(retry);
    await view.expectClearOfComposer(view.failure());
    await view.use(view.failure().getByRole('button', { name: /Show sync details/ }));
    await expect(view.details()).toContainText('Last synced');
    await expect(view.details().locator('pre')).toBeHidden();
    await view.use(view.details().getByText('Technical details', { exact: true }));
    await expect(view.details().locator('pre')).toContainText('Happy request failed (503)');
    await view.expectNoPageOverflow();
    await page.keyboard.press('Escape');
    await expect(view.details()).toHaveCount(0);
    await view.use(retry);
    await expect(view.failure()).toHaveCount(0);
    await expect(page.locator('[data-sync-status]')).toHaveCount(0, { timeout: 8000 });
  }
  // Act / Assert: a failed message update belongs to this conversation.
  await view.step('Fail a message update');
  await expect(view.messageFailure()).toContainText('Could not update messages');
  await view.use(view.messageFailure().getByRole('button', { name: 'Retry messages', exact: true }));
  await expect(view.messageFailure()).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this draft');
  await view.capture(`${info.project.name}-sync-status-demo`);
});

test('the session list should show the same status, and the app update should stay separate', async ({ page }, info) => {
  // Arrange
  const view = new SyncStatusPage(page);
  await view.openDemo();
  await view.step('Fail the sync');
  await expect(view.failure()).toBeVisible();
  // Act
  if (info.project.use.hasTouch) await view.use(page.getByRole('button', { name: 'Back to sessions', exact: true }));
  // Assert: one Retry owner at a time.
  await expect(view.failure()).toHaveCount(1);
  if (info.project.use.hasTouch) {
    await expect(view.sessionList().getByRole('alert', { name: 'Connection error', exact: true })).toBeVisible();
    await view.expectReachable(view.failure().getByRole('button', { name: 'Retry', exact: true }));
    await view.use(view.failure().getByRole('button', { name: 'Retry', exact: true }));
    await expect(view.failure()).toHaveCount(0);
    await page.goto('/session/sync-status-demo?demo=1');
  } else {
    await view.use(view.failure().getByRole('button', { name: 'Retry', exact: true }));
    await expect(view.failure()).toHaveCount(0);
  }
  // Act
  await view.step('Show a new version');
  // Assert
  const notice = page.getByRole('region', { name: 'Rayno update', exact: true });
  await expect(notice).toContainText('A new version of Rayno is ready.');
  await expect(notice).toContainText('Your messages keep syncing.');
  await expect(page.locator('[data-sync-status]')).toHaveCount(0);
  await view.use(notice.getByRole('button', { name: 'Reload and update', exact: true }));
  await expect(page.getByText('Simulated: Rayno reloads with the new version. Your drafts stay on this device.')).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('the demo link should work with demo data saved before the sync status demo existed', async ({ page }) => {
  // Arrange: a saved demo account from an older build, without the sync status demo.
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [], preferences: { sessionListMode: 'projects' }, drafts: { untouched: 'Keep this draft' }, newDraft: {}, recentPaths: [],
    }));
  });
  const view = new SyncStatusPage(page);
  // Act
  await view.openDemo();
  await view.step('Return from background');
  // Assert
  await expect(view.status('Conversation')).toContainText('Syncing…');
  await page.goto('/sessions?demo=1');
  await expect(view.sessionList().getByText('Sync status · Interactive demo')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(saved.drafts.untouched).toBe('Keep this draft');
  expect(saved.preferences.sessionListMode).toBe('projects');
});

test('a resume should replace a read that a frozen PWA left open and show the missed reply', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const view = new SyncStatusPage(page);
  await view.route('/session/real-session');
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft before the freeze');
  let release!: () => void;
  server.historyReady = new Promise<void>(resolve => { release = resolve; });
  // A focus sync starts a message read that does not answer.
  await view.hideAndShow(false);
  await expect.poll(() => server.requests.filter(request => request.path.includes('after_seq')).length).toBeGreaterThan(0);
  await server.pushEvent({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Missed while frozen' } } }, 'real-session', false);
  server.historyReady = Promise.resolve();
  try {
    // Act: the page comes back from the back-forward cache.
    await view.hideAndShow(true);
    // Assert
    await expect(page.getByText('Missed while frozen', { exact: true })).toBeVisible();
    await expect(view.failure()).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Draft before the freeze');
  } finally {
    release();
  }
});
