import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { WorkspaceLoadingPage } from './pages/WorkspaceLoadingPage';

for (const [width, height] of [[1440, 900], [320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
  test(`session list should stay usable after demo loading at ${width}x${height}`, async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const workspace = new WorkspaceLoadingPage(page);

    // Act / Assert: the real list shell stays in place during both loads.
    await workspace.openDemo();
    await workspace.expectLoading();
    const heading = await page.getByRole('heading', { name: 'Sessions', level: 1, exact: true }).boundingBox();
    await workspace.finishDemoLoading();
    expect(await page.getByRole('heading', { name: 'Sessions', level: 1, exact: true }).boundingBox()).toEqual(heading);
    await workspace.expectReachable(workspace.replay());
    await workspace.activate(workspace.replay());
    await workspace.expectLoading();
    await workspace.finishDemoLoading();
    await workspace.openExample();
    await workspace.expectNoPageOverflow();
  });
}

test('signed-in startup should show the session list during account initialization and server loading', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  let release!: () => void;
  server.workspaceReady = new Promise<void>(resolve => { release = resolve; });
  await server.install(page);
  await page.addInitScript(serverOrigin => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    (window as any).releaseAccount = release;
    crypto.subtle.digest = async (algorithm, data) => {
      if (new TextDecoder().decode(data).startsWith(serverOrigin + ':')) await ready;
      return digest(algorithm, data);
    };
  }, server.credentials.server);
  const workspace = new WorkspaceLoadingPage(page);

  // Act / Assert
  await page.goto('/');
  await workspace.expectLoading();
  await page.evaluate(() => (window as any).releaseAccount());
  await workspace.openSessionSearch();
  await expect(workspace.skeleton()).toBeVisible();
  release();
  await expect(workspace.skeleton()).toHaveCount(0);
  await workspace.sessionSearch().fill('Connected workspace');
  await workspace.sessionSearch().press('Enter');
  await page.getByRole('button').filter({ has: page.locator('time'), hasText: 'Connected workspace' }).click();
  await expect(page.getByText('From the real protocol', { exact: true })).toBeVisible();
});

test('loading demo should preserve older sessions, drafts, and preferences', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    localStorage.setItem('rayno.demo.v1', JSON.stringify({ version: 1,
      sessions: [{ id: 'existing-demo', title: 'Keep this session', workspace: 'rayno', project: 'Rayno',
        path: '/demo', branch: 'main', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5',
        status: 'idle', unread: false, archived: false, createdAt: 1, updatedAt: 1, additions: 0, deletions: 0, messages: [] }],
      drafts: { 'existing-demo': 'Keep this draft' }, preferences: { chatWidth: 'full' },
    }));
  });
  const workspace = new WorkspaceLoadingPage(page);

  // Act
  await page.goto('/session/workspace-loading-demo?demo=1');

  // Assert
  await expect(page.getByRole('link', { name: 'Open the session list loading demo' })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(saved.sessions.some((session: { id: string }) => session.id === 'existing-demo')).toBe(true);
  expect(saved.drafts['existing-demo']).toBe('Keep this draft');
  expect(saved.preferences.chatWidth).toBe('full');
  await workspace.expectNoPageOverflow();
});
