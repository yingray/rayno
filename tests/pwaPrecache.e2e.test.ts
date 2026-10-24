import { expect, test } from '@playwright/test';
import { PwaCachePage } from './pages/PwaCachePage';

test('the PWA should cache the demo image on first use and reopen it offline', async ({ browser }, info) => {
  // Arrange
  const { baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const workspace = new PwaCachePage(page);
    await workspace.installShell();
    // Assert: installation must not download the demo image into the precache.
    expect(await workspace.demoCacheEntries()).toEqual([]);
    // Act / Assert: the demo page itself also waits for a user action.
    await workspace.open();
    expect(await workspace.demoCacheEntries()).toEqual([]);
    await context.setOffline(true);
    await workspace.tryUncachedOfflineImage();
    expect(await workspace.demoCacheEntries()).toEqual([]);
    await context.setOffline(false);
    await workspace.loadImage();
    await expect.poll(() => workspace.demoCacheEntries()).toEqual([{
      cache: 'rayno-demo-images', path: expect.stringMatching(/^\/assets\/demo-chat-[\w-]+\.png$/),
      type: 'image/png', signature: [137, 80, 78, 71, 13, 10, 26, 10],
    }]);
    // A cold offline reload drops the in-memory decrypted image and exercises the worker cache.
    await context.setOffline(true);
    await page.reload();
    await workspace.viewAndDownload();
    await workspace.expectNoPageOverflow();
  } finally {
    await context.close();
  }
});
