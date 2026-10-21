import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('session usage should read real quotas, expand, refresh, and open Monitor', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await page.goto('/sessions');
  // Assert
  await expect(workspace.usageSummary()).toContainText('25%');
  await expect(workspace.usageSummary()).toContainText('31%');
  await expect(workspace.usageSummary().getByRole('meter', { name: 'Claude weekly usage' })).toHaveAttribute('aria-valuenow', '25');
  await workspace.expectUsagePlacement();
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-session-usage`);
  // Act
  await workspace.openUsage();
  // Assert
  await expect(workspace.usageDetails()).toContainText('Real computer');
  await expect(workspace.usageDetails()).toContainText('Resets');
  await expect(workspace.usageDetails()).toContainText('Read ');
  expect(server.usageReads).toBe(1);
  // Act
  server.usagePercent = 88;
  server.codexPercent = 99;
  await workspace.refreshUsage();
  // Assert
  await expect(workspace.usageSummary()).toContainText('88%');
  await expect(workspace.usageSummary()).toContainText('99%');
  await expect(workspace.usageDetails()).toContainText('88% used');
  expect(server.usageReads).toBe(2);
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
  await workspace.capture(`${testInfo.project.name}-session-usage-details`);
  // Act
  await page.keyboard.press('Escape');
  // Assert
  await expect(workspace.usageDetails()).toHaveCount(0);
  await expect(workspace.usageSummary()).toBeFocused();
  // Act
  await workspace.openUsage();
  await workspace.usageDetails().getByRole('button', { name: 'Open Monitor', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/monitor$/);
  await expect(page.getByText('88%', { exact: true })).toBeVisible();
});

test('usage failures should retain stale readings and offline machines should disable refresh', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/sessions');
  await expect(workspace.usageSummary()).toContainText('25%');
  await workspace.openUsage();
  // Act
  server.usageFailure = true;
  await workspace.refreshUsage();
  // Assert
  await expect(workspace.usageDetails().getByRole('alert').filter({ hasText: 'Usage unavailable' })).toBeVisible();
  await expect(workspace.usageDetails()).toContainText('Stale reading');
  await expect(workspace.usageSummary()).toContainText('25%');
  // Act
  await server.setMachineActive(false);
  // Assert
  await expect(workspace.usageDetails().getByRole('button', { name: 'Refresh usage' })).toBeDisabled();
  await expect(workspace.usageDetails()).toContainText('Connect a computer');
  expect(server.sends).toEqual([]);
});

test('missing usage should stay unknown and the compact footer should fit narrow screens', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.usageFailure = true;
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await page.goto('/sessions');
  await workspace.openUsage();
  // Assert
  await expect(workspace.usageDetails().getByRole('alert').filter({ hasText: 'Usage unavailable' })).toBeVisible();
  await expect(workspace.usageSummary()).toContainText('——');
  await expect(workspace.usageSummary().getByRole('img', { name: 'Claude', exact: true })).toBeVisible();
  await expect(workspace.usageSummary().getByRole('img', { name: 'Codex', exact: true })).toBeVisible();
  await expect(workspace.usageSummary().getByRole('meter')).toHaveCount(0);
  // Act
  await page.keyboard.press('Escape');
  for (const width of [320, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 768) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Sessions', exact: true }).click();
    }
    // Assert
    await expect(workspace.usageSummary()).toBeVisible();
    const dimensions = await workspace.usageSummary().evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    await workspace.expectNoPageOverflow();
    if (width === 768) await page.keyboard.press('Escape');
  }
});
