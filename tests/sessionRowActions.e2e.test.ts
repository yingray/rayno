import { expect, test } from '@playwright/test';
import { SessionListMenuPage } from './pages/SessionListMenuPage';

for (const [width, height] of [[320,568], [360,640], [390,844], [430,932], [390,360], [844,390], [1440,900]]) {
  test(`session list menu - ${width}x${height} - should open a nonmodal dropdown without a loading screen`, async ({ page }, info) => {
    test.skip(info.project.name.startsWith('mobile') ? width === 1440 : width !== 1440, 'Matching layout');
    // Arrange
    await page.setViewportSize({ width, height });
    const view = new SessionListMenuPage(page);
    await view.openDemo();
    // Act / Assert
    await view.openRowActions(!!info.project.use.hasTouch);
    await view.dismissWithTrigger(!!info.project.use.hasTouch);
    await view.openRowActions(!!info.project.use.hasTouch);
    await view.dismissWithTrigger(!!info.project.use.hasTouch);
    await view.openRowActions(!!info.project.use.hasTouch);
    await view.dismissWithOutsideClick();
    await view.openRowActions(!!info.project.use.hasTouch);
    await view.dismissWithEscape();
    await view.openRowActions(!!info.project.use.hasTouch);
    await view.chooseAction('Session info & rename');
    await expect(page).toHaveURL(/\/session\/paste-search-demo\/info/);
    await expect(page.getByRole('button', { name: 'Copy Happy session ID', exact: true })).toBeVisible();
  });
}

test('session list menu - desktop conversation - should keep the message field reachable', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'Desktop workspace');
  // Arrange
  const view = new SessionListMenuPage(page);
  await view.openDemo(true);
  // Act
  await view.openRowActions(false);
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.click();
  // Assert
  await expect(input).toBeFocused();
  await expect(view.menu()).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
