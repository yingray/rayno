import { expect, test, type Locator } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';

class SessionHistoryPage extends PriorityFeaturesPage {
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async createFromList() {
    const list = this.page.getByRole('button', { name: 'Open session list', exact: true });
    const width = this.page.viewportSize()!.width;
    if (width >= 768 && width < 1280) await this.activate(list);
    await this.activate(this.page.getByRole('button', { name: /^(New session|New)$/ }));
    await expect(this.page).toHaveURL(/\/new$/);
    await this.page.getByLabel('Folder', { exact: true }).fill('/real/project');
    await this.taskDescription().fill('Create this session once');
    const start = this.page.getByRole('button', { name: 'Start', exact: true });
    await start.scrollIntoViewIfNeeded();
    await this.expectNoPageOverflow();
    if (this.page.viewportSize()!.width < 768) await this.expectTouchTarget(start);
    await this.activate(start);
    await expect(this.page).toHaveURL(/\/session\/[^/]+$/);
    await expect(this.page.getByRole('region', { name: 'Create session', exact: true })).toHaveCount(0);
  }
  async expectCompletedFormRemoved() {
    const chatUrl = this.page.url();
    await this.page.goBack();
    await expect(this.page).toHaveURL(/\/sessions(?:\?demo=1)?$/);
    await expect(this.page.getByRole('region', { name: 'Create session', exact: true })).toHaveCount(0);
    await this.page.goForward();
    await expect(this.page).toHaveURL(chatUrl);
    const input = this.page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('Chat remains usable after history navigation');
    await expect(input).toHaveValue('Chat remains usable after history navigation');
    await this.expectNoPageOverflow();
  }
}

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
  test(`successful creation should replace the form in history at ${width}x${height}`, async ({ page }) => {
    const server = new HappyServer(); await server.install(page); await server.setWorking(false);
    await page.setViewportSize({ width, height });
    const view = new SessionHistoryPage(page);
    await page.goto('/sessions');
    await view.createFromList();
    await view.expectCompletedFormRemoved();
    expect(server.spawns).toHaveLength(1);
    expect(server.sends).toHaveLength(1);
  });
}

test('demo creation should also replace the completed form in history', async ({ page }) => {
  const view = new SessionHistoryPage(page);
  await page.goto('/sessions?demo=1');
  await view.createFromList();
  await view.expectCompletedFormRemoved();
});
