import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { HappyServer } from './fixtures/HappyServer';
import { LocalImagesPage } from './pages/LocalImagesPage';
import { localImageKey } from '../src/happy/localImages';

const pixel = new Uint8Array(readFileSync(new URL('./fixtures/pixel.png', import.meta.url)));
async function setup(page: import('@playwright/test').Page, source = '/real/project/private.png', link = false) {
  const server = new HappyServer();
  await server.install(page);
  server.localImages.set('/real/project/private.png', pixel);
  await server.setMessages([{ role: 'session', content: {
    role: 'agent', turn: 'image-turn', ev: { t: 'text', text: `${link ? '' : '!'}[Private screenshot](${source})` },
  } }]);
  return { server, workspace: new LocalImagesPage(page) };
}

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [390, 360], [844, 390]]) {
  test(`private local image should require a click, encrypt, and remain readable offline at ${width}x${height}`, async ({ page }) => {
    // Arrange
    const { server, workspace } = await setup(page);
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.setViewportSize({ width, height });
    await workspace.openSession();
    await expect(workspace.loadButton()).toBeVisible();
    // Assert: rendering a model-provided path must not read the computer or upload anything.
    expect(server.localImageReads).toHaveLength(0);
    expect(server.uploadRequests).toHaveLength(0);
    expect(requests.some(url => url.includes('/real/project/private.png'))).toBe(false);
    if (width === 320) await workspace.capture('local-image-320');
    // Act
    await workspace.loadPrivateImage();
    expect(await workspace.openPrivateImage(true)).toEqual(pixel);
    // Assert
    expect(server.localImageReads).toEqual(['/real/project/private.png']);
    expect(server.uploadRequests).toEqual([{ filename: 'image.png', size: pixel.length + 40 }]);
    expect(server.uploadHeaders.every(headers => !headers.authorization)).toBe(true);
    const encrypted = [...server.blobs.values()][0];
    expect(await server.encryption.decryptBlob(encrypted, server.dataKey)).toEqual(pixel);
    expect(encrypted).not.toEqual(Buffer.from(pixel));
    expect(server.sends).toHaveLength(0);
    const metadata = await server.encryption.decrypt<Record<string, any>>(server.sessions[0].metadata, server.dataKey);
    expect(metadata.raynoLocalImages[localImageKey('fixture-1', '/real/project/private.png')]).toMatchObject({ name: 'private.png', ref: 'image-1' });
    expect(server.sessions[0].metadata).not.toContain('private.png');
    await workspace.expectNoPageOverflow();
    const records = await workspace.offlineRecords();
    expect(records.every(record => !record.value.includes('private.png'))).toBe(true);
    // Act: the attachment survives a reload, and a cached copy needs neither the CLI nor the network.
    await page.reload();
    await workspace.expectImage();
    await workspace.setNetwork(false);
    await page.reload();
    await workspace.openPrivateImage();
    expect(server.localImageReads).toHaveLength(1);
    expect(server.uploadRequests).toHaveLength(1);
    await workspace.expectNoPageOverflow();
  });
}

for (const [source, link] of [['./private.png', false], ['file:///real/project/private.png', false], ['/real/project/private.png', true]] as const) {
  test(`local ${link ? 'link' : 'image'} ${source} should convert to an encrypted attachment`, async ({ page }) => {
    const { server, workspace } = await setup(page, source, link);
    await workspace.openSession();
    await workspace.loadPrivateImage();
    await workspace.openPrivateImage();
    expect(server.localImageReads).toEqual(['/real/project/private.png']);
  });
}

test('failed private image uploads should offer an explicit retry and never publish a broken image', async ({ page }) => {
  const { server, workspace } = await setup(page);
  server.uploadFailure = true;
  await workspace.openSession();
  await workspace.loadPrivateImage();
  await expect(page.getByRole('alert').filter({ hasText: 'transfer failed' })).toBeVisible();
  await expect(workspace.loadButton()).toBeEnabled();
  expect(server.sends).toHaveLength(0);
  const metadata = await server.encryption.decrypt<Record<string, any>>(server.sessions[0].metadata, server.dataKey);
  expect(metadata.raynoLocalImages).toBeUndefined();
  server.uploadFailure = false;
  await workspace.loadPrivateImage();
  await workspace.openPrivateImage();
});

test('an outside path should remain private and explain the workspace limit', async ({ page }) => {
  const source = '/real/private-folder-with-a-very-long-name-that-must-wrap/private.png';
  const { server, workspace } = await setup(page, source);
  await page.setViewportSize({ width: 320, height: 640 });
  await workspace.openSession();
  await workspace.loadPrivateImage();
  await expect(page.getByRole('alert').filter({ hasText: 'outside the session workspace' })).toBeVisible();
  expect(server.localImageReads).toHaveLength(0);
  expect(server.uploadRequests).toHaveLength(0);
  await workspace.expectNoPageOverflow();
});
