import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WorkspacePage } from './pages/WorkspacePage';

const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop response', exact: true });
const hints = (page: Page) => page.getByTestId('session-shortcut');
const modifier = (page: Page) => page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control');

async function expectSequentialHints(page: Page, key: string) {
  const prefix = key === 'Meta' ? '⌘' : 'Ctrl+';
  const texts = await hints(page).allTextContents();
  expect(texts.length).toBeGreaterThan(1);
  expect(texts.length).toBeLessThanOrEqual(9);
  expect(texts).toEqual(texts.map((_, index) => `${prefix}${index + 1}`));
}

// The title of the second list row. A closed drawer opens for the read and closes again.
async function secondTitle(page: Page, workspace: WorkspacePage, listed: boolean, key: string) {
  if (!listed) await page.keyboard.press(`${key}+KeyK`);
  const label = await workspace.sessionList().getByRole('button', { name: /^Actions for / }).nth(1).getAttribute('aria-label');
  if (!listed) {
    await page.getByRole('button', { name: 'Close session search', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(workspace.sessionList()).toHaveCount(0);
  }
  return label!.replace(/^Actions for /, '');
}

test('Escape should stop a running response and keep popup Escape behavior', async ({ page }) => {
  // Arrange
  await page.goto('/session/api-contract?demo=1');
  await expect(stopButton(page)).toBeVisible();
  await expect(stopButton(page)).toHaveAttribute('title', 'Stop response (Esc)');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('/');
  await expect(page.getByRole('listbox')).toBeVisible();
  // Act
  await composer.press('Escape');
  // Assert
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(stopButton(page)).toBeVisible();
  // Act
  await composer.press('Escape');
  // Assert
  await expect(stopButton(page)).toHaveCount(0);
  await expect(page.getByText('Simulated response stopped')).toBeVisible();
});

test('Escape should stop a response again after a new demo send', async ({ page }) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await page.goto('/session/api-contract?demo=1');
  await page.keyboard.press('Escape');
  await expect(stopButton(page)).toHaveCount(0);
  await workspace.send('Check the retry headers again');
  await expect(stopButton(page)).toBeVisible();
  // Act
  await page.locator('body').press('Escape');
  // Assert
  await expect(stopButton(page)).toHaveCount(0);
});

test('Escape should close the session menu without a stop', async ({ page }) => {
  // Arrange
  await page.goto('/session/api-contract?demo=1');
  await expect(stopButton(page)).toBeVisible();
  const list = new WorkspacePage(page).sessionList();
  test.skip(!await list.isVisible(), 'The phone layout shows the list on its own page.');
  await list.getByRole('button', { name: /^Actions for Review the webhook/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  // Act
  await page.keyboard.press('Escape');
  // Assert
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(stopButton(page)).toBeVisible();
});

for (const [width, height] of [[320, 740], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
  test(`held shortcut modifier should number sessions and switch at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const workspace = new WorkspacePage(page);
    await page.goto('/sessions?demo=1');
    await expect(workspace.sessionList().or(page.locator('[data-chat-session]')).first()).toBeVisible();
    // A narrow desktop keeps the list in a closed drawer. The shortcut still switches without the numbers.
    const listed = await workspace.sessionList().isVisible();
    const key = await modifier(page);
    const second = await secondTitle(page, workspace, listed, key);
    await expect(hints(page)).toHaveCount(0);
    // Act
    await page.keyboard.down(key);
    // Assert
    if (listed) await expectSequentialHints(page, key);
    else await expect(hints(page)).toHaveCount(0);
    for (const box of await hints(page).evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`hints-${width}x${height}.png`) });
    // Act
    await page.keyboard.press('Digit2');
    await page.keyboard.up(key);
    // Assert
    await expect(page).toHaveURL(/\/session\/[^/?]+/);
    await expect(hints(page)).toHaveCount(0);
    await expect(page.locator('[data-chat-session] header')).toContainText(second);
    await workspace.expectNoPageOverflow();
  });
}

test('shortcut numbers should follow the project grouping order', async ({ page }) => {
  // Arrange
  const workspace = new WorkspacePage(page);
  await page.goto('/sessions?demo=1');
  await workspace.sessionList().getByRole('button', { name: 'Projects' }).click();
  const key = await modifier(page);
  // Act
  await page.keyboard.down(key);
  // Assert
  await expectSequentialHints(page, key);
  const third = hints(page).nth(2).locator('xpath=ancestor::button[1]');
  const title = (await third.textContent())!.replace(/^(⌘|Ctrl\+)\d/, '');
  // Act
  await page.keyboard.press('Digit3');
  await page.keyboard.up(key);
  // Assert
  await expect(page).toHaveURL(/\/session\//);
  if (await workspace.sessionList().isVisible()) {
    await expect(workspace.sessionList().locator('[aria-current="page"]')).toHaveText(title);
  }
});

test('a modifier combination with another key should hide the numbers', async ({ page }) => {
  // Arrange
  await page.goto('/sessions?demo=1');
  await expect(new WorkspacePage(page).sessionList()).toBeVisible();
  const key = await modifier(page);
  await page.keyboard.down(key);
  await expect(hints(page).first()).toBeVisible();
  // Act
  await page.keyboard.press('KeyC');
  // Assert
  await expect(hints(page)).toHaveCount(0);
  await page.keyboard.up(key);
});
