import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export class WorkspacePage {
  constructor(readonly page: Page) {}
  sessionList() { return this.page.getByRole('region', { name: 'Session list', exact: true }); }
  sessionSearch() { return this.sessionList().getByRole('textbox', { name: 'Search sessions', exact: true }); }
  archiveToggle() { return this.sessionList().getByRole('button', { name: 'Archived sessions', exact: true }); }
  searchButton() { return this.sessionList().getByRole('button', { name: 'Search sessions', exact: true }); }
  async openSessionSearch() {
    if (!await this.sessionSearch().isVisible()) await this.searchButton().click();
    await this.sessionSearch().focus();
    await expect(this.sessionSearch()).toBeFocused();
  }
  async closeSessionSearch() {
    await this.sessionList().getByRole('button', { name: 'Close session search', exact: true }).click();
    await expect(this.sessionSearch()).toHaveCount(0);
  }
  async searchSessions(query: string) {
    await this.openSessionSearch();
    await this.sessionSearch().fill(query);
    await this.sessionSearch().press('Enter');
  }
  async setListVisibility(archived: boolean) {
    if (await this.archiveToggle().getAttribute('aria-pressed') !== String(archived)) await this.archiveToggle().click();
    await expect(this.archiveToggle()).toHaveAttribute('aria-pressed', String(archived));
    if (await this.sessionSearch().count()) await this.closeSessionSearch();
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
  async sendDraft() {
    const button = this.page.getByRole('button', { name: 'Send message', exact: true });
    if (await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await button.tap();
    else await button.click();
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
