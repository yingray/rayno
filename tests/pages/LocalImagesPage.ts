import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class LocalImagesPage extends PriorityFeaturesPage {
  async openSession() {
    await this.page.goto('/session/real-session');
    await this.expectConnected();
    await expect(this.loadButton()).toBeVisible();
  }
  async activate(control: import('@playwright/test').Locator) {
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  loadButton() { return this.page.getByRole('button', { name: 'Load private image', exact: true }); }
  async loadPrivateImage() {
    await this.loadButton().scrollIntoViewIfNeeded();
    await this.expectTouchTarget(this.loadButton());
    await this.activate(this.loadButton());
  }
  async expectImage() {
    await this.page.getByText('private.png', { exact: true }).scrollIntoViewIfNeeded();
    const button = this.page.getByRole('button', { name: 'Open image private.png', exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
    await this.expectTouchTarget(button);
  }
  async openPrivateImage(downloadCopy = false) {
    await this.expectImage();
    await this.activate(this.page.getByRole('button', { name: 'Open image private.png', exact: true }));
    const dialog = this.page.getByRole('dialog', { name: 'private.png', exact: true });
    await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
    const download = dialog.getByRole('link', { name: 'Download image', exact: true });
    await download.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(download);
    await expect(download).toHaveAttribute('href', /^blob:/);
    let bytes: Uint8Array | undefined;
    if (downloadCopy) {
      const ready = this.page.waitForEvent('download');
      await this.activate(download);
      const file = await ready;
      expect(file.suggestedFilename()).toBe('private.png');
      bytes = new Uint8Array(await readFile((await file.path())!));
    }
    const close = dialog.getByRole('button', { name: 'Close private.png', exact: true });
    await close.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(close);
    await this.activate(close);
    await expect(dialog).toHaveCount(0);
    return bytes;
  }
}
