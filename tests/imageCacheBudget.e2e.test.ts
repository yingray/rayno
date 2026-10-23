import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

// PERFORMANCE-PLAN.md 6.5: cached images have a budget of 250 MB or 10% of the quota, the smaller.
// The test sets a small quota, so the budget holds 2.5 images. The chat loads each image when it shows.
test('the image cache should delete the least recently viewed image when it is over budget', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    const quota = Number(localStorage.getItem('fixture.quota')) || 1e12;
    Object.assign(StorageManager.prototype, { estimate: async () => ({ quota, usage: 0 }) });
  });
  const server = new HappyServer();
  await server.install(page);
  const png = new Uint8Array(readFileSync('tests/fixtures/pixel.png'));
  const file = (name: string, index: number) => ({ role: 'session', meta: { sentFrom: 'web' }, content: {
    id: `image-${index}`, time: 1700000000000 + index, role: 'user',
    ev: { t: 'file', name, size: png.length, mimeType: 'image/png', ref: `ref-${name}` } } });
  for (const name of ['first.png', 'second.png', 'third.png'])
    await server.serveBlob(`ref-${name}`, await server.encryption.encryptBlob(png, server.dataKey));
  // The first history page keeps one older row back, so a text row comes first.
  await server.setMessages([{ role: 'user', content: { type: 'text', text: 'Compare these images' } }, file('first.png', 1), file('second.png', 2)]);
  const workspace = new LiveWorkspacePage(page);
  const image = (name: string) => page.getByRole('button', { name: `Open image ${name}`, exact: true });
  const cache = async () => {
    const records = await workspace.offlineRecords();
    const index = records.find((record) => record.key.endsWith('.images'));
    return { images: records.filter((record) => /\.image\./.test(record.key)).map((record) => record.key.split('.image.')[1]).sort(),
      index: index ? Object.keys(JSON.parse(index.value).entries).map((key) => key.slice('image.'.length)).sort() : [] };
  };
  const downloads = () => server.requests.filter((request) => request.path.endsWith('/attachments/request-download')).length;
  await page.goto('/session/real-session');
  await workspace.expectConnected();
  await expect(image('second.png')).toBeVisible();
  await expect.poll(async () => (await cache()).index).toHaveLength(2);
  const saved = (await cache()).images;
  const bytes = (await workspace.offlineRecords()).find((record) => /\.image\./.test(record.key))!.value.length;
  await page.evaluate((quota) => localStorage.setItem('fixture.quota', String(quota)), bytes * 25);
  await page.reload();
  await workspace.expectConnected();
  await expect(image('second.png')).toBeVisible();
  // Act: a third image arrives. The first image is the least recently viewed one.
  await server.pushEvent(file('third.png', 3));
  await expect(image('third.png')).toBeVisible();
  // Assert
  await expect.poll(async () => (await cache()).images).toHaveLength(2);
  const { images, index } = await cache();
  expect(index).toEqual(images);
  expect(images).toContain(saved.find((key) => images.includes(key)));
  expect(saved.filter((key) => images.includes(key))).toHaveLength(1);
  expect((await workspace.offlineRecords()).every((record) => !record.value.includes('third.png'))).toBe(true);
  // Act: offline, the two newest images open from the cache.
  const before = downloads();
  await workspace.setNetwork(false);
  await page.reload();
  // Assert
  await expect(image('third.png')).toBeVisible();
  await expect(image('second.png')).toBeVisible();
  expect(downloads()).toBe(before);
});
