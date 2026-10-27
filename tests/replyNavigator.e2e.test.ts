import { expect, test } from '@playwright/test';

const link = '/session/reply-navigator-demo?demo=1';

test('reply navigator demo should mark the current reply, label a tick on hover and jump on click', async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, 'The reply rail shows only at 768px and wider.');
  // Arrange
  await page.goto(link);
  const rail = page.getByRole('navigation', { name: 'Agent replies', exact: true });
  const ticks = rail.getByRole('button');
  // Assert
  await expect(ticks).toHaveCount(5);
  await expect(ticks.nth(4)).toHaveAttribute('aria-current', 'location');
  // Act
  await ticks.nth(1).hover();
  // Assert
  await expect(page.getByTestId('response-rail-tip')).toHaveText(/^02No\. Claude readings come only/);
  // Act
  await ticks.nth(0).click();
  // Assert
  await expect(ticks.nth(0)).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('[data-message-id="reply-navigator-demo-reply-1"] p').first()).toBeInViewport();
  // Act: the jump repeats from any reply.
  await ticks.nth(3).click();
  // Assert
  await expect(ticks.nth(3)).toHaveAttribute('aria-current', 'location');
});

test('reply navigator demo link should work with demo data saved before the demo existed', async ({ page }) => {
  // Arrange
  await page.goto('/?demo=1');
  await expect(page.getByText('Reply navigator · Interactive demo')).toBeVisible();
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const value = localStorage.getItem(key) || '';
      if (!value.includes('reply-navigator-demo')) continue;
      const state = JSON.parse(value);
      state.sessions = state.sessions.filter((session: { id: string }) => session.id !== 'reply-navigator-demo');
      localStorage.setItem(key, JSON.stringify(state));
    }
  });
  // Act
  await page.goto(link);
  // Assert
  await expect(page.getByText('Try the reply navigator', { exact: true })).toBeVisible();
});
