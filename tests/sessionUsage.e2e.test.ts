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
  await expect(workspace.usageDetails().getByRole('meter', { name: 'Claude 5-hour usage' })).toHaveAttribute('aria-valuenow', '12');
  await expect(workspace.usageDetails().getByRole('meter', { name: 'Codex 5-hour usage' })).toHaveAttribute('aria-valuenow', '44');
  await expect(workspace.usageDetails().getByRole('meter', { name: 'Codex weekly usage' })).toHaveAttribute('aria-valuenow', '31');
  await expect(workspace.usageDetails().getByText('5-hour limit', { exact: true })).toHaveCount(2);
  await expect(workspace.usageDetails().getByText('Weekly limit', { exact: true })).toHaveCount(2);
  await workspace.expectUsageDetailsFit();
  expect(server.usageReads).toBe(1);
  // Act
  server.usagePercent = 88;
  server.codexPercent = 99;
  server.fiveHourPercent = 63;
  await workspace.refreshUsage();
  // Assert
  await expect(workspace.usageSummary()).toContainText('88%');
  await expect(workspace.usageSummary()).toContainText('99%');
  await expect(workspace.usageDetails()).toContainText('88% used');
  await expect(workspace.usageDetails()).toContainText('63% used');
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
  await expect(page.getByRole('meter', { name: 'Claude 5-hour usage' })).toHaveAttribute('aria-valuenow', '63');
  await expect(page.getByRole('meter', { name: 'Codex 5-hour usage' })).toHaveAttribute('aria-valuenow', '44');
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-monitor-usage`);
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

test('usage details should show both plan windows and keep actions reachable on phones', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/sessions');
  await expect(workspace.usageSummary()).toContainText('25%');
  for (const [width, height] of [[320, 568], [360, 640], [390, 420], [430, 932], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    await page.goto('/sessions');
    // Wider screens open the latest chat; the navigation shows the list again.
    if (width >= 768) await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(workspace.usageSummary()).toContainText('25%');
    await workspace.openUsage();
    // Assert
    await expect(workspace.usageDetails().getByRole('meter', { name: 'Claude 5-hour usage' })).toBeVisible();
    const summary = (await workspace.usageSummary().boundingBox())!;
    expect(summary.height).toBeGreaterThanOrEqual(44);
    await workspace.expectUsageDetailsFit();
    // Act
    await page.keyboard.press('Escape');
    // Assert
    await expect(workspace.usageDetails()).toHaveCount(0);
  }
  await page.goto('/monitor');
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    const meter = page.getByRole('meter', { name: 'Claude 5-hour usage' });
    await meter.scrollIntoViewIfNeeded();
    // Assert
    await expect(meter).toBeInViewport();
    const box = (await meter.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await workspace.expectNoPageOverflow();
  }
});

test('a plan with only a 5-hour window should still show its reading in the summary, details, and Monitor', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.weekReported = false;
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await page.goto('/sessions');
  // Assert
  await expect(workspace.usageSummary().getByRole('meter', { name: 'Claude 5-hour usage' })).toHaveAttribute('aria-valuenow', '12');
  await expect(workspace.usageSummary().getByRole('meter', { name: 'Codex 5-hour usage' })).toHaveAttribute('aria-valuenow', '44');
  await expect(workspace.usageSummary()).toContainText('12%');
  await expect(workspace.usageSummary()).toContainText('44%');
  await expect(workspace.usageSummary().getByText('5h', { exact: true })).toHaveCount(2);
  // Act
  await workspace.openUsage();
  // Assert
  await expect(workspace.usageDetails().getByText('5-hour limit', { exact: true })).toHaveCount(2);
  await expect(workspace.usageDetails().getByText('Weekly limit', { exact: true })).toHaveCount(0);
  await expect(workspace.usageDetails()).not.toContainText('No usage reported');
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 420], [844, 390]]) {
    // Act
    await page.setViewportSize({ width, height });
    await page.goto('/sessions');
    if (width >= 768) await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Sessions', exact: true }).click();
    // Assert
    await expect(workspace.usageSummary()).toContainText('12%');
    const summary = workspace.usageSummary();
    const dimensions = await summary.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Act
    await workspace.openUsage();
    // Assert
    await workspace.expectUsageDetailsFit();
    await workspace.expectNoPageOverflow();
    // Act
    await page.keyboard.press('Escape');
  }
  // Act
  await page.goto('/monitor');
  // Assert
  await expect(page.getByRole('meter', { name: 'Claude 5-hour usage' })).toHaveAttribute('aria-valuenow', '12');
  await expect(page.getByRole('meter', { name: 'Codex 5-hour usage' })).toHaveAttribute('aria-valuenow', '44');
  await expect(page.getByText('of 5 hours used · Real computer')).toHaveCount(2);
  await expect(page.getByText('Day 1', { exact: true })).toHaveCount(0);
  await workspace.expectNoPageOverflow();
});
