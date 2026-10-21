import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export class WorkspacePage {
  constructor(readonly page: Page) {}
  listOptions() { return this.page.getByRole('dialog', { name: 'Session list options', exact: true }); }
  listOptionsButton() { return this.page.getByRole('button', { name: 'Session list options', exact: true }); }
  async openListOptions() {
    if (!await this.listOptions().isVisible()) await this.listOptionsButton().click();
    await expect(this.listOptions()).toBeVisible();
  }
  async closeListOptions() {
    await this.listOptions().getByRole('button', { name: 'Done', exact: true }).click();
    await expect(this.listOptions()).toHaveCount(0);
  }
  async searchSessions(query: string) {
    await this.openListOptions();
    await this.listOptions().getByRole('textbox', { name: 'Search sessions', exact: true }).fill(query);
    await this.closeListOptions();
  }
  async setListVisibility(archived: boolean) {
    await this.openListOptions();
    await this.listOptions().getByRole('group', { name: 'Session visibility', exact: true })
      .getByRole('button', { name: archived ? 'Archived' : 'Active', exact: true }).click();
    await this.closeListOptions();
  }
  async open() {
    await this.page.goto('/sessions');
    await expect(this.page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  }
  async create(prompt: string) {
    await this.page.getByRole('button', { name: /^New( session)?$/, exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Task description' }).fill(prompt);
    await this.page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  }
  async stop() {
    await this.page.getByRole('button', { name: 'Stop response' }).click();
    await expect(this.page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  }
  async send(content: string) {
    await this.page.getByRole('textbox', { name: 'Message', exact: true }).fill(content);
    await this.page.getByRole('button', { name: 'Send message' }).click();
  }
  async sendWithEnter(content: string) {
    const input = this.page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(content);
    await input.press('Enter');
  }
  async info() {
    await this.page.getByRole('button', { name: 'Open session info', exact: true }).first().click();
    await expect(
      this.page.getByRole('heading', { name: 'Session info', exact: true }),
    ).toBeVisible();
  }
  async rename(name: string) {
    await this.page
      .getByRole('button', { name: /^Rename/ })
      .first()
      .click();
    await this.page.getByRole('textbox', { name: 'Session name', exact: true }).fill(name);
    await this.page.getByRole('button', { name: 'Save name' }).click();
  }
  async closeInfo() {
    await this.page.getByRole('button', { name: /^(Close session info|Back to chat)$/i }).click();
  }
  async archive() {
    await this.page.getByRole('button', { name: /^Archive( session)?$/, exact: true }).click();
  }
  async delete() {
    await this.page.getByRole('button', { name: /^Delete( session)?$/, exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Delete this session?' });
    await dialog.getByRole('button', { name: 'Delete session', exact: true }).click();
  }
  async route(path: string) {
    await this.page.goto(path);
    await expect(this.page.locator('main, [aria-label="Session list"]').first()).toBeVisible();
  }
  async expectNoPageOverflow() {
    const dimensions = await this.page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
  }
  async capture(name: string) {
    await this.page.screenshot({ path: `test-results/screenshots/${name}.png`, fullPage: true, animations: 'disabled' });
  }
}
