import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { CloudRecapPage } from './pages/CloudRecapPage';

const text = '這次摘要使用自然中文，原本的暫停和速度控制都會保留。';
const recap = `<rayno-recap><point quote="From the real protocol">這次</point>摘要使用自然中文，原本的暫停和速度控制都會保留。</rayno-recap>`;
async function arrange(server: HappyServer) {
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Only summarize this private main reply.' } },
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'From the real protocol\n\n' + recap } } },
  ]);
}

test('cloud recap should send only recap text and play, pause, change speed, and stop on composer input', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page);
  await view.stubRelay(); await view.removeSpeech(); await view.openSession();
  const touch = !!info.project.use.hasTouch;
  // Act
  await view.activate(view.play(), touch);
  // Assert
  await view.expectCloudPlaying();
  expect(view.requests).toEqual([{ text, language: 'zh-TW' }]);
  await view.expand(touch);
  await expect(view.card().locator('[data-recap-jump][data-point="1"]').first()).toHaveAttribute('data-active', 'true');
  // Act
  await view.activate(view.card().getByRole('button', { name: 'Pause recap', exact: true }), touch);
  await expect.poll(async () => (await view.audioState()).paused).toBe(true);
  await view.activate(view.card().getByRole('button', { name: 'Reading speed 1×', exact: true }), touch);
  // Assert: a speed change retains the pause and does not synthesize again.
  expect(await view.audioState()).toMatchObject({ paused: true, rate: 1.25 });
  expect(view.requests).toHaveLength(1);
  // Act
  await view.activate(view.play(), touch);
  await view.expectCloudPlaying();
  await view.composer().fill('Stop the recap');
  // Assert
  await expect(view.play()).toBeVisible();
  await expect.poll(async () => (await view.audioState()).src).toBeNull();
});

test('cloud recap should show quiet preparation feedback without layout shifts and cancel late audio at phone sizes', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay('wait'); await view.removeSpeech(); await view.openSession();
  test.setTimeout(60000);
  const touch = !!info.project.use.hasTouch;
  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await view.expectControlReachable('Play recap');
    const before = (await view.card().boundingBox())!.height;
    const requests = view.requests.length;
    await view.activate(view.play(), touch);
    await expect(view.cancel()).toHaveAttribute('aria-busy', 'true');
    await expect(view.cancel()).toHaveAccessibleDescription('Preparing recap audio…');
    await expect.poll(() => view.requests.length).toBe(requests + 1);
    await expect(page.getByText('Preparing recap audio…', { exact: true })).toHaveCount(0);
    expect((await view.card().boundingBox())!.height).toBeCloseTo(before, 1);
    const ring = view.cancel().locator(':scope > span').last();
    await expect(ring).toHaveCSS('opacity', '1');
    await view.expectControlReachable('Cancel recap playback');
    if (width === 320 || width === 844) await view.capture(`${info.project.name}-recap-loading-${width}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await view.cancel().evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    await view.activate(view.cancel(), touch);
    view.release!();
    await expect(view.play()).toBeVisible();
    await expect.poll(async () => (await view.audioState()).src).toBeNull();
    await view.expectNoPageOverflow();
  }
});

test('cloud recap should fall back to browser speech when synthesis fails', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay('fail'); await view.stubSpeech(); await view.openSession();
  // Act
  await view.activate(view.play(), !!info.project.use.hasTouch);
  // Assert
  await expect.poll(async () => (await view.speechLog()).spoken[0]?.text).toBe(text);
  await expect(view.card().getByRole('status')).toHaveText('Cloud voice is unavailable. Using the browser voice.');
});

test('cloud recap should keep real audio controls usable at phone widths and short landscape viewports', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay(); await view.removeSpeech(); await view.openSession();
  test.setTimeout(60000);
  const touch = !!info.project.use.hasTouch;
  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await view.play().scrollIntoViewIfNeeded();
    await view.expectControlReachable('Play recap');
    await view.activate(view.play(), touch);
    await view.expectCloudPlaying();
    await view.expectControlReachable('Pause recap');
    await view.activate(view.card().getByRole('button', { name: 'Pause recap', exact: true }), touch);
    await expect.poll(async () => (await view.audioState()).paused).toBe(true);
    await view.expectNoPageOverflow();
    if (width === 320 || width === 844) await view.capture(`${info.project.name}-cloud-recap-${width}`);
    await view.composer().fill(`Stop at ${width}`);
    await view.composer().fill('');
  }
});

test('cloud recap autoplay should reuse the gesture-authorized player for a fresh recap', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.setWorking(false); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay(); await view.removeSpeech();
  await page.goto('/settings/appearance');
  await view.activate(page.getByRole('switch', { name: 'Read recaps aloud automatically', exact: true }), !!info.project.use.hasTouch);
  await view.openSession();
  // An explicit playback unlocks the audio element, then typing stops that recap.
  await view.activate(view.play(), !!info.project.use.hasTouch);
  await view.expectCloudPlaying();
  await view.composer().fill('Next recap'); await view.composer().fill('');
  // Act
  await server.setWorking(true);
  await server.pushReply('Fresh reply.\n\n<rayno-recap>新的摘要可以自動播放。</rayno-recap>');
  await server.setWorking(false);
  // Assert
  await expect.poll(() => view.requests.at(-1)?.text).toBe('新的摘要可以自動播放。');
  await expect.poll(async () => (await view.audioState()).paused).toBe(false);
  await expect.poll(async () => (await view.audioState()).time).toBeGreaterThan(0);
});

test('cloud recap should show a retryable error when both cloud and browser voices are unavailable', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay('fail'); await view.removeSpeech(); await view.openSession();
  // Act
  await view.activate(view.play(), !!info.project.use.hasTouch);
  // Assert
  await expect(view.card().getByRole('status')).toHaveText('Speech is unavailable. Try again later.');
  await expect(view.play()).toBeEnabled();
});

test('cloud recap should avoid a network request and show a retryable notice offline without browser speech', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay(); await view.removeSpeech(); await view.openSession();
  await expect(view.play()).toBeVisible();
  await page.context().setOffline(true);
  // Act
  await view.activate(view.play(), !!info.project.use.hasTouch);
  // Assert
  await expect(view.card().getByRole('status')).toHaveText('Speech is unavailable. Try again later.');
  expect(view.requests).toHaveLength(0);
  await page.context().setOffline(false);
});

test.describe('persistent recap audio', () => {
  // Install the real worker for WebKit persistence; load mocked account data before it takes control.
  test.use({ serviceWorkers: 'allow' });
test('cloud recap should replay immediately and reuse encrypted audio after reload until its one-day expiry', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await arrange(server);
  const view = new CloudRecapPage(page); await view.stubRelay(); await view.removeSpeech();
  await view.deferWorker();
  await view.openSession();
  const touch = !!info.project.use.hasTouch;
  await view.activate(view.play(), touch); await view.expectCloudPlaying();
  await expect.poll(async () => (await view.audioCacheEntries()).length).toBe(1);
  const saved = (await view.audioCacheEntries())[0];
  expect(saved.body).not.toContain(text);
  expect(saved.body).not.toContain('"audio"');
  expect(saved.expires - Date.now()).toBeGreaterThan(23.9 * 60 * 60 * 1000);
  expect(saved.expires - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  // Act / Assert: an ended recap starts immediately, with no new synthesis or loading control.
  await view.finishAudio();
  await view.activate(view.play(), touch);
  await expect(view.cancel()).toHaveCount(0);
  await view.expectCloudPlaying();
  expect(view.requests).toHaveLength(1);
  // Act / Assert: a cold player uses the installed worker and keeps the original expiry.
  await expect.poll(async () => (await view.offlineRecords()).some(row => row.key.endsWith('history.real-session'))).toBe(true);
  await view.startWorker();
  await view.setNetwork(false);
  await page.reload();
  await view.activate(view.play(), touch); await view.expectCloudPlaying();
  expect(view.requests).toHaveLength(1);
  expect((await view.audioCacheEntries())[0].expires).toBe(saved.expires);
  // Act / Assert: the worker removes an expired entry, then the next online play synthesizes again.
  await view.expireAudioCache();
  expect(await page.evaluate(async () => {
    const cache = await caches.open('rayno-recap-audio-v1');
    const [request] = await cache.keys();
    const [, , scope, id] = new URL(request.url).pathname.split('/');
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data.ok && event.data.value === null); };
      navigator.serviceWorker.controller!.postMessage({ type: 'RAYNO_RECAP_AUDIO_V1', op: 'get', scope, id }, [channel.port2]);
    });
  })).toBe(true);
  // Release the controlling worker before online API mocks; WebKit bypasses page.route behind it.
  await page.evaluate(async () => {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    localStorage.setItem('fixture.online', 'true');
  });
  await page.reload();
  await view.activate(view.play(), touch); await view.expectCloudPlaying();
  expect(view.requests).toHaveLength(2);
  await expect.poll(async () => (await view.audioCacheEntries())[0]?.expires).toBeGreaterThan(saved.expires);
  // Sign-out clears this account's worker cache too.
  await view.startWorker();
  await view.setNetwork(false);
  await view.signOut();
  await expect.poll(async () => (await view.audioCacheEntries()).length).toBe(0);
});

});

test('an installed worker should replay cached recap audio after an offline reload', async ({ browser }, info) => {
  // Arrange
  const { baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const server = new HappyServer(); await server.install(page); await arrange(server);
    const view = new CloudRecapPage(page); await view.stubRelay(); await view.removeSpeech(); await view.deferWorker(); await view.openSession();
    await view.activate(view.play(), !!hasTouch); await view.expectCloudPlaying();
    await expect.poll(async () => (await view.audioCacheEntries()).length).toBe(1);
    await expect.poll(async () => (await view.offlineRecords()).some(row => row.key.endsWith('history.real-session'))).toBe(true);
    await view.startWorker();
    // The installed worker itself must acknowledge the encrypted cache, not just the page fallback.
    expect(await page.evaluate(async () => {
      const cache = await caches.open('rayno-recap-audio-v1');
      const [request] = await cache.keys();
      const scope = new URL(request.url).pathname.split('/')[2];
      return new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
        channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data.ok && event.data.value); };
        navigator.serviceWorker.controller!.postMessage({ type: 'RAYNO_RECAP_AUDIO_V1', op: 'has', scope }, [channel.port2]);
      });
    })).toBe(true);
    // Act
    await view.setNetwork(false); await context.setOffline(true); await page.reload();
    await expect(view.play()).toBeVisible();
    await view.activate(view.play(), !!hasTouch);
    // Assert
    await view.expectCloudPlaying();
    expect(view.requests).toHaveLength(1);
    expect((await view.audioCacheEntries())[0].body).not.toContain(text);
  } finally { await context.close(); }
});
