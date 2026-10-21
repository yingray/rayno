import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('usage should poll once per foreground minute across routes and pause without focus or an online machine', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  let release!: () => void;
  server.usageReady = new Promise<void>(resolve => { release = resolve; });
  await server.install(page);
  const time = new Date('2026-10-20T12:00:00Z');
  await page.clock.install({ time });
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/sessions');
  await workspace.setForeground(true, true);
  await expect.poll(() => server.usageReads).toBe(1);
  // Let lazy screens mount before the clock stops animation and Suspense timers.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

  // Act / Assert: repeated focus events share the pending read.
  for (let i = 0; i < 3; i++) await workspace.setForeground(true, true);
  expect(server.usageReads).toBe(1);
  await page.clock.runFor(5000);
  release();
  await expect(workspace.usageSummary()).toContainText('25%');
  await page.clock.runFor(55000);
  await expect.poll(() => server.usageReads).toBe(2);
  await workspace.goToSection('Settings');
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  server.socket?.send('2');
  await page.clock.runFor(60000);
  await expect.poll(() => server.usageReads).toBe(3);

  // Hidden and unfocused pages do not read quotas.
  await workspace.setForeground(false, false);
  server.socket?.send('2');
  await page.clock.runFor(60000);
  expect(server.usageReads).toBe(3);
  await workspace.setForeground(true, false);
  server.socket?.send('2');
  await page.clock.runFor(60000);
  expect(server.usageReads).toBe(3);
  await workspace.setForeground(true, true);
  await expect.poll(() => server.usageReads).toBe(4);

  // Offline machines stop polling; reconnect resumes a stale read.
  server.setMachineActive(false);
  await workspace.goToSection('Monitor');
  await page.clock.runFor(1000);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  server.socket?.send('2');
  await page.clock.runFor(60000);
  expect(server.usageReads).toBe(4);
  server.setMachineActive(true);
  await expect.poll(() => server.usageReads).toBe(5);
  expect(server.sends).toEqual([]);
  expect(server.spawns).toEqual([]);
  expect(server.mutations).toEqual([]);
});
