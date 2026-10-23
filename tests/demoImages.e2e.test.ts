import { test, expect } from '@playwright/test';
import { DemoImagesPage } from './pages/DemoImagesPage';

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [390, 360], [844, 390]]) {
  test(`image demo should show a real thumbnail and support touch, zoom, and download at ${width}x${height}`, async ({ page }) => {
    const workspace = new DemoImagesPage(page);
    const requests: { method: string; url: string }[] = [];
    page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
    await page.setViewportSize({ width, height });
    await workspace.open();
    await expect(page.getByText('Demo: load a public sample image. No computer files are read or uploaded.', { exact: true })).toBeVisible();
    await workspace.viewAndDownload();
    await workspace.expectNoPageOverflow();
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    expect(requests.every(request => new URL(request.url).origin === new URL(page.url()).origin)).toBe(true);
    expect(requests.some(request => request.url.includes('/demo/workspace/'))).toBe(false);
    if (width === 390 && height === 844) await workspace.capture('image-demo-390');
  });
}

test('an image demo link should work with demo data saved before this feature', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rayno.demo.v1', JSON.stringify({ version: 1, sessions: [], preferences: {}, drafts: {}, newDraft: {}, recentPaths: [] })));
  const workspace = new DemoImagesPage(page);
  await workspace.open();
  await workspace.viewAndDownload();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Load private image', exact: true })).toBeVisible();
});
