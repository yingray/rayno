import { expect } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class DemoImagesPage extends PriorityFeaturesPage {
  async open() {
    await this.page.goto('/session/private-image-demo?demo=1');
    await expect(this.page.getByRole('heading', { name: 'Try the image preview', exact: true })).toBeVisible();
  }
  async activate(control: import('@playwright/test').Locator) {
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async loadImage() {
    const load = this.page.getByRole('button', { name: 'Load private image', exact: true });
    await load.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(load);
    await this.activate(load);
    const image = this.page.getByRole('button', { name: 'Open image private-demo.png', exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect(image.getByRole('img')).toHaveJSProperty('naturalWidth', 2880);
    await this.expectTouchTarget(image);
    return image;
  }
  async viewAndDownload() {
    const image = await this.loadImage();
    await this.activate(image);
    const dialog = this.page.getByRole('dialog', { name: 'private-demo.png', exact: true });
    await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 2880);
    const link = dialog.getByRole('link', { name: 'Download image', exact: true });
    await link.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(link);
    const ready = this.page.waitForEvent('download');
    await this.activate(link);
    expect((await ready).suggestedFilename()).toBe('private-demo.png');
    const close = dialog.getByRole('button', { name: 'Close private-demo.png', exact: true });
    await close.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(close);
    await this.activate(close);
    await expect(dialog).toHaveCount(0);
  }
}
