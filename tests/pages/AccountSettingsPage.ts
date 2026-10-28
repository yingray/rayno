import { expect, type Page } from '@playwright/test';

export class AccountSettingsPage {
  constructor(private readonly page: Page) {}

  async stubClipboard() {
    await this.page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } },
    }));
  }

  copiedText() {
    return this.page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '');
  }

  async open(query = '') {
    await this.page.goto(`/settings/account${query}`);
    await expect(this.signIn()).toBeVisible();
  }

  signIn() {
    return this.page.locator('h2', { hasText: /^Sign-in$/ }).locator('xpath=..');
  }

  serverRow() {
    return this.signIn().getByText('Happy server', { exact: true }).locator('xpath=../..');
  }

  async copyRecoveryKey() {
    await this.page.getByRole('button', { name: 'Copy recovery key', exact: true }).click();
  }

  dialog() {
    return this.page.getByRole('dialog', { name: 'Change Happy server', exact: true });
  }

  async changeServer(value: string) {
    await this.serverRow().getByRole('button', { name: 'Change', exact: true }).click();
    await this.dialog().getByRole('textbox', { name: 'Happy server', exact: true }).fill(value);
    await this.dialog().getByRole('button', { name: 'Connect', exact: true }).click();
  }

  storedServer() {
    return this.page.evaluate(() => {
      const raw = localStorage.getItem('rayno.credentials');
      return raw ? (JSON.parse(raw) as { server: string }).server : '';
    });
  }

  accountKeys() {
    return this.page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('rayno.account.')));
  }

  async expectNoPageOverflow() {
    const overflow = await this.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
}
