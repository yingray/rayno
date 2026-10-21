import { test, expect } from '@playwright/test';
import { WorkspacePage } from './pages/WorkspacePage';

test('a cached PWA shell should upgrade without closing every open tab or clearing storage', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    'One Chromium context verifies a service worker upgrade.',
  );
  // Arrange
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: 'allow',
  });
  try {
    await context.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
    let oldRelease = true;
    await context.route('**/sw.js', async (route) => {
      if (!oldRelease) return route.continue();
      return route.fulfill({
        contentType: 'application/javascript',
        body: `
          self.addEventListener('install', event => {
            self.skipWaiting();
            event.waitUntil(caches.open('test-old-shell').then(cache =>
              cache.put('/old-shell', new Response('<!doctype html><html><body><h1>Old session list</h1><time>now</time></body></html>', {
                headers: { 'Content-Type': 'text/html' }
              }))
            ));
          });
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', event => {
            if (event.request.mode === 'navigate') {
              event.respondWith(caches.open('test-old-shell').then(cache => cache.match('/old-shell')));
            }
          });
        `,
      });
    });
    const page = await context.newPage();
    const workspace = new WorkspacePage(page);
    await workspace.open();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      localStorage.setItem('pwa.upgrade.draft', 'Keep this draft');
      localStorage.setItem('pwa.upgrade.auth', 'Keep this authorization');
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Old session list' })).toBeVisible();
    const otherTab = await context.newPage();
    await otherTab.goto('/sessions');
    await expect(otherTab.getByRole('heading', { name: 'Old session list' })).toBeVisible();
    // Act
    oldRelease = false;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration?.active && !registration.installing && !registration.waiting;
    })).toBe(true);
    // Assert
    await expect(page.getByRole('heading', { name: 'Old session list' })).toBeVisible();
    await expect(otherTab.getByRole('heading', { name: 'Old session list' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
    await expect(page.getByText('now', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => [
      localStorage.getItem('pwa.upgrade.draft'),
      localStorage.getItem('pwa.upgrade.auth'),
    ])).toEqual(['Keep this draft', 'Keep this authorization']);
  } finally {
    await context.close();
  }
});
