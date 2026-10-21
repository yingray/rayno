import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('session list should match v1 activity dates and stop the initial progress bar while an agent runs', async ({
  page,
}, testInfo) => {
  // Arrange
  const server = new HappyServer();
  let release!: () => void;
  server.workspaceReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await server.install(page);
  const now = new Date('2026-10-20T12:00:00Z');
  await page.clock.setFixedTime(now);
  const metadata = { path: '/real/project', machineId: 'computer', flavor: 'claude' };
  server.sessions[0] = {
    ...server.sessions[0],
    updatedAt: now.getTime() + 999999,
    metadata: await server.encryption.encrypt(
      { ...metadata, summary: { text: 'Connected workspace' }, lastMeaningfulMessageAt: now.getTime() - 5 * 60000 },
      server.dataKey,
    ),
    agentState: await server.encryption.encrypt({ thinking: true }, server.dataKey),
  };
  server.sessions[1].metadata = await server.encryption.encrypt(
    { ...metadata, summary: { text: 'Older workspace' }, lastMeaningfulMessageAt: now.getTime() - 60000 },
    null,
  );
  server.sessions[1].active = true;
  server.sessions.push({
    ...server.sessions[1],
    id: 'side-chat',
    metadata: await server.encryption.encrypt(
      { ...metadata, isSideChat: true, summary: { text: 'Hidden side chat' } },
      null,
    ),
  });
  server.sessions.push({
    ...server.sessions[1],
    id: 'past-session',
    metadata: await server.encryption.encrypt(
      { ...metadata, summary: { text: 'Previous day' }, lastMeaningfulMessageAt: now.getTime() - 86400000 },
      null,
    ),
  });
  const workspace = new LiveWorkspacePage(page);
  server.messages = [];
  await page.goto('/sessions');
  await workspace.expectWorkspaceLoading(true);
  // Act
  release();
  // Assert
  const rows = workspace.sessionRows();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Older workspace');
  await expect(rows.nth(0)).toContainText('1 minute ago');
  await expect(rows.nth(0)).toHaveCSS('opacity', '1');
  await expect(rows.nth(1)).toContainText('Connected workspace');
  await expect(rows.nth(1)).toContainText('5 minutes ago');
  await expect(rows.nth(1).getByRole('status', { name: 'Working' })).toBeVisible();
  const pastDate = await page.evaluate((time) =>
    new Date(time).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    now.getTime() - 86400000,
  );
  await expect(rows.nth(2).locator('time')).toHaveText(pastDate);
  await workspace.expectWorkspaceLoading(false);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-session-list-v1-parity`);
});

test('connected chat should decrypt history, retain a failed draft, and deduplicate its retry', async ({
  page,
}) => {
  // Arrange
  const server = new HappyServer();
  server.failFirstSend = true;
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await workspace.openSession();
  await workspace.expectConnected();
  // Act
  await workspace.loadEarlier();
  await expect(page.getByText('Earlier message', { exact: true })).toBeVisible();
  await workspace.send('One real request');
  await expect(page.getByRole('alert')).toContainText('confirmation lost');
  await workspace.expectDraft('One real request');
  await workspace.retrySend();
  await workspace.expectDraft('');
  await server.pushReply('Reply from the shared backend');
  // Assert
  await expect(page.getByText('Reply from the shared backend', { exact: true })).toBeVisible();
  await expect(page.getByText('One real request', { exact: true })).toHaveCount(1);
  expect(server.sends).toHaveLength(2);
  expect(server.sends[1]).toEqual(server.sends[0]);
  expect(
    server.requests.some((request) => request.path.includes('cursor=cursor_v1_real-session')),
  ).toBe(true);
  await expect(page.getByText('Local demo · simulated replies')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('connected actions should use real permissions, files, usage, and independent logout', async ({
  page,
}) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.allowOnce();
  await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
  await workspace.previewFile();
  await expect(page.getByText('Real file content', { exact: true })).toBeVisible();
  await workspace.refreshMonitor();
  // Assert
  await expect(page.getByRole('heading', { name: 'Real computer', exact: true })).toBeVisible();
  await expect(page.getByText('77%', { exact: true })).toBeVisible();
  await expect(page.getByText('25%', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Monitor preview state')).toHaveCount(0);
  expect(server.permissionReplies).toBe(1);
  await workspace.signOut();
  await workspace.expectSignIn();
  expect(await page.evaluate(() => localStorage.getItem('rayno.v2.credentials'))).toBeNull();
});

test('session info should not link to another client', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.info();
  // Assert
  await expect(page.getByRole('link', { name: /v1/ })).toHaveCount(0);
  expect(server.mutations).toEqual([]);
  await workspace.expectNoPageOverflow();
});

test('new connected session should spawn once and send the encrypted initial prompt', async ({
  page,
}) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await workspace.startRealSession('Create an isolated contract test');
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  await expect(page.getByText('Create an isolated contract test', { exact: true })).toBeVisible();
  expect(server.mutations.filter((method) => method.endsWith(':spawn-happy-session'))).toHaveLength(
    1,
  );
  expect(server.sends).toHaveLength(1);
  expect(JSON.stringify(server.sends)).not.toContain('Create an isolated contract test');
});

test('QR authorization should unlock the independent client with its own account key', async ({
  page,
}) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page, false);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/session/real-session');
  await workspace.expectSignIn();
  await workspace.expectQr();
  // Act
  server.authorized = true;
  // Assert
  await workspace.expectConnected();
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
  expect(server.mutations).toEqual([]);
});

test('connected session management should confirm rename, archive, resume guidance, and delete', async ({
  page,
}) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.info();
  await workspace.rename('A confirmed name');
  await workspace.closeInfo();
  await expect(
    page.getByRole('button', { name: 'Open session info', exact: true }).first(),
  ).toContainText('A confirmed name');
  await workspace.info();
  await workspace.archive();
  await expect(page).toHaveURL(/\/sessions$/);
  await workspace.route('/session/real-session/info');
  await expect(workspace.archiveActions()).toHaveCount(0);
  await workspace.delete();
  // Assert
  await expect(page).toHaveURL(/\/sessions$/);
  expect(server.sessions.some((session) => session.id === 'real-session')).toBe(false);
  expect(server.mutations).toContain('archive');
  expect(server.mutations).toContain('delete');
  expect(server.mutations.some((method) => method.endsWith(':spawn-happy-session'))).toBe(false);
});
