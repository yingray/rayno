import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import { MermaidPage } from './pages/MermaidPage';
import { base64 } from '../src/happy/crypto';
import type { CachedHistory } from '../src/happy/offlineCache';

// The saved history is an index in `history.<id>` and its rows in pages in `history.<id>#<page>`.
async function expectSaved(workspace: LiveWorkspacePage, server: HappyServer, text = 'Earlier message') {
  await expect.poll(async () => {
    const records = await workspace.offlineRecords();
    const index = records.find((row) => row.key.endsWith('history.real-session'));
    if (!index) return false;
    const { pages } = await server.encryption.decrypt<{ pages: number[] }>(index.value, null);
    const rows = await Promise.all(pages.map(async (page) => {
      const record = records.find((row) => row.key.endsWith(`history.real-session#${page}`));
      return record ? (await server.encryption.decrypt<Pick<CachedHistory, 'messages'>>(record.value, null)).messages : [];
    }));
    return rows.flat().some((row) => JSON.stringify(row.raw).includes(text));
  }).toBe(true);
}

test('saved sessions and messages should survive offline reloads and recover missed replies without sending the draft', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  await workspace.loadEarlier();
  await expectSaved(workspace, server);
  const encrypted = JSON.stringify(await workspace.offlineRecords());
  for (const plain of ['Connected workspace', 'Earlier message', 'From the real protocol', '/real/project', server.credentials.token])
    expect(encrypted).not.toContain(plain);

  // Act: reload the real-mode UI with browser network state set to offline.
  await workspace.setNetwork(false);
  await workspace.route('/sessions');
  await expect(workspace.sessionRow()).toBeVisible();
  await expect(workspace.availability('Session list')).toContainText('Offline · saved on this device');
  await expect(workspace.connectionError()).toHaveCount(0);
  await workspace.openRow();
  await expect(page.getByText('Earlier message', { exact: true })).toBeVisible();
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  await expect(workspace.availability('Conversation')).toContainText('Offline · saved');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my offline draft');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await page.reload();
  await workspace.expectDraft('Keep my offline draft');
  await expect(page.getByText('Earlier message', { exact: true })).toBeVisible();

  // Assert: saved rows remain operable on narrow, short, and landscape screens.
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await workspace.resizeChat(width, height);
    await workspace.showSessions();
    await workspace.searchSessions('Connected');
    if (width === 844) {
      await workspace.sessionRow().scrollIntoViewIfNeeded();
      await workspace.capture(`${testInfo.project.name}-offline-landscape-list`);
    }
    await workspace.openRow();
    await expect(workspace.availability('Conversation')).toBeVisible();
    await workspace.expectNoPageOverflow();
    await workspace.expectDraft('Keep my offline draft');
    if (width === 390 && height === 844) await workspace.capture(`${testInfo.project.name}-offline-phone-chat`);
  }
  const requestsBefore = server.requests.length;
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus();
  expect(server.requests).toHaveLength(requestsBefore);

  // A missed reply must merge with cached history after reconnection.
  await server.pushEvent({
    role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Reply after reconnect' } },
  }, 'real-session', false);
  await workspace.setNetwork(true);
  await workspace.expectConnected();
  await expect(page.getByText('Reply after reconnect', { exact: true })).toBeVisible();
  await expect(page.getByText('Earlier message', { exact: true })).toBeVisible();
  await workspace.expectDraft('Keep my offline draft');
  expect(server.sends).toEqual([]);
  expect(server.spawns).toEqual([]);
  expect(server.mutations).toEqual([]);
});

test('saved data should stay account scoped and sign-out should clear only the current account cache', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await expectSaved(workspace, server, 'From the real protocol');
  const otherKey = 'rayno.account.other.workspace';
  await workspace.addOfflineRecord(otherKey, 'other-account-sentinel');
  await page.evaluate(() => localStorage.setItem('v1-credentials', 'keep-v1'));

  // Act / Assert: another login must not read this account's saved content.
  await workspace.setNetwork(false);
  await page.evaluate((credentials) => localStorage.setItem('rayno.credentials', JSON.stringify(credentials)), {
    ...server.credentials, secret: base64(new Uint8Array(32).fill(21), true),
  });
  await workspace.route('/sessions');
  await expect(page.getByText('No saved sessions', { exact: true })).toBeVisible();
  await expect(workspace.sessionRow()).toHaveCount(0);
  await expect(workspace.connectionError()).toHaveCount(0);
  await workspace.route('/session/real-session');
  await expect(page.getByText('Not available offline', { exact: true })).toBeVisible();
  await expect(page.getByText('From the real protocol', { exact: true })).toHaveCount(0);

  // The original account can still read its cache and sign out while offline.
  await page.evaluate((credentials) => localStorage.setItem('rayno.credentials', JSON.stringify(credentials)), server.credentials);
  await workspace.openSession();
  await workspace.signOut();
  await workspace.expectSignIn();
  await expect.poll(() => workspace.offlineRecords()).toEqual([{ key: otherKey, value: 'other-account-sentinel' }]);
  expect(await page.evaluate(() => localStorage.getItem('v1-credentials'))).toBe('keep-v1');
  expect(server.mutations).toEqual([]);
});

test('a yellow connection warning should appear only after failure and stay hidden during startup and retry', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  let release!: () => void;
  server.workspaceReady = new Promise<void>((resolve) => { release = resolve; });
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/session/real-session');
  await workspace.expectWorkspaceLoading(true);
  await expect(workspace.connectionError()).toHaveCount(0);
  await expect(page.getByText('Session not found', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);

  // Act / Assert
  server.workspaceFailure = true;
  release();
  await expect(workspace.connectionError()).toContainText('Could not read the workspace');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  const retryBounds = (await page.getByRole('button', { name: 'Retry', exact: true }).boundingBox())!;
  expect(retryBounds.height).toBeGreaterThanOrEqual(44);
  server.workspaceFailure = false;
  server.workspaceReady = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(workspace.connectionError()).toHaveCount(0);
  release();
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  await workspace.expectConnected();
  await workspace.expectNoPageOverflow();
});

test('the installed live PWA should reopen its session list and chat with the network fully offline', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Chromium verifies the generated worker; all projects verify account-cache flows.');
  // Arrange
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const server = new HappyServer();
    await server.install(page);
    await server.pushReply('```mermaid\nflowchart LR\n  A[Saved locally] --> B[Available offline]\n```');
    const workspace = new MermaidPage(page);
    await workspace.openSession();
    await workspace.expectRendered();
    await expectSaved(workspace, server, 'From the real protocol');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
    await workspace.expectRendered();
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open('rayno-diagrams');
      return (await cache.keys()).some((request) => request.url.includes('mermaid.worker-'));
    })).toBe(true);

    // Act / Assert: no static server or API is available to a cold navigation.
    await context.setOffline(true);
    await workspace.route('/sessions');
    await expect(workspace.sessionRow()).toBeVisible();
    await expect(workspace.availability('Session list')).toContainText('Offline · saved');
    await workspace.openRow();
    await page.reload();
    await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
    await workspace.expectRendered();
    await expect(workspace.availability('Conversation')).toContainText('Offline · saved');
    await expect(workspace.connectionError()).toHaveCount(0);
    expect(server.sends).toEqual([]);
    expect(server.spawns).toEqual([]);
  } finally {
    await context.close();
  }
});
