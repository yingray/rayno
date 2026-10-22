import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WorkspacePage } from './pages/WorkspacePage';

const newer = { commit: 'fe12abc', builtAt: '2026-10-23T02:00:00.000Z' };
const about = (page: Page) => page.getByRole('main').or(page.locator('section[aria-label="Settings"]')).first();
const updateButton = (page: Page) => page.getByRole('button', { name: /^(Update now|Check again)$/ });
const runningBuild = async (page: Page) =>
  (await (await page.request.get('/version.json')).json()) as { commit: string; builtAt: string };
// A value on window survives until the page reloads.
const markPage = (page: Page) => page.evaluate(() => { (window as unknown as { kept?: boolean }).kept = true; });
// A check during the reload counts as kept, so the poll asks again.
const pageKept = (page: Page) =>
  page.evaluate(() => (window as unknown as { kept?: boolean }).kept === true).catch(() => true);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
});

test('settings should show the running version and reload into a newer release on update', async ({ page }, testInfo) => {
  // Arrange
  const build = await runningBuild(page);
  await page.route('**/version.json', (route) => route.fulfill({ json: newer }));
  const workspace = new WorkspacePage(page);
  await workspace.route('/settings/developer');
  await expect(page.getByLabel('Current version')).toHaveText(`1.0.0 · ${build.commit}`);
  await expect(about(page).getByText(`Version ${newer.commit} is ready`)).toBeVisible();
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-settings-update-available`);
  await markPage(page);
  // Act
  await updateButton(page).click();
  // Assert
  await expect.poll(() => pageKept(page)).toBe(false);
  await expect(updateButton(page)).toHaveText('Update now');
});

test('settings should say the running version is the latest when the server has the same build', async ({ page }) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  // Act
  await workspace.route('/settings/developer');
  // Assert
  await expect(about(page).getByText('This is the latest version')).toBeVisible();
  await expect(updateButton(page)).toBeEnabled();
});

test('an update without a connection should keep the page and let the user check again', async ({ page }) => {
  // Arrange
  let online = false;
  await page.route('**/version.json', (route) => online ? route.continue() : route.abort('internetdisconnected'));
  const workspace = new WorkspacePage(page);
  await workspace.route('/settings/developer');
  await expect(about(page).getByText('Cannot check for updates. Check your connection.')).toBeVisible();
  await markPage(page);
  // Act
  await updateButton(page).click();
  const offlineKept = await pageKept(page);
  online = true;
  await updateButton(page).click();
  // Assert
  expect(offlineKept).toBe(true);
  await expect(about(page).getByText('This is the latest version')).toBeVisible();
  expect(await pageKept(page)).toBe(true);
});

test('the update row should fit phone widths, landscape, and touch', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layouts use the mobile projects.');
  // Arrange
  await page.route('**/version.json', (route) => route.fulfill({ json: newer }));
  const workspace = new WorkspacePage(page);
  await workspace.route('/settings/developer');
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    await updateButton(page).scrollIntoViewIfNeeded();
    // Assert
    // A trial click fails when another element, such as the tab bar, covers the button.
    await updateButton(page).click({ trial: true });
    const box = (await updateButton(page).boundingBox())!;
    expect(box.height, `${width}x${height}`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, `${width}x${height}`).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `${width}x${height}`).toBeLessThanOrEqual(0);
    await workspace.capture(`${testInfo.project.name}-settings-update-${width}x${height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await markPage(page);
  await updateButton(page).tap();
  await expect.poll(() => pageKept(page)).toBe(false);
});

test('update now should install a changed service worker before the reload', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One Chromium context verifies a service worker update.');
  // Arrange
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'allow' });
  try {
    await context.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
    // The first registration gets an old release without a shell cache. Update checks skip the route and get the real file.
    await context.route('**/sw.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `
        self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
      `,
    }));
    await context.route('**/version.json', (route) => route.fulfill({ json: newer }));
    const page = await context.newPage();
    const workspace = new WorkspacePage(page);
    await workspace.route('/settings/developer');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.evaluate(() => localStorage.setItem('update.draft', 'Keep this draft'));
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await markPage(page);
    // Act
    await updateButton(page).click();
    // Assert
    await expect.poll(() => pageKept(page)).toBe(false);
    await expect(updateButton(page)).toBeVisible();
    expect(await page.evaluate(async () => [
      (await caches.keys()).some((name) => name.startsWith('rayno-precache')),
      navigator.serviceWorker.controller?.state,
      localStorage.getItem('update.draft'),
    ])).toEqual([true, 'activated', 'Keep this draft']);
  } finally {
    await context.close();
  }
});
