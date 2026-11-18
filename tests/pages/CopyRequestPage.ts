import { expect } from '@playwright/test';
import { copyRequestDemoId } from '../../src/data/copyRequestDemo';
import { CopyResponsePage } from './CopyResponsePage';

export class CopyRequestPage extends CopyResponsePage {
  request(text: string) { return this.page.locator('article[data-role="user"]').filter({ hasText: text }); }
  copyRequestButton(text: string) {
    return this.request(text).getByRole('button', { name: 'Copy request', exact: true });
  }
  async openDemo() {
    await this.page.goto(`/session/${copyRequestDemoId}?demo=1`);
    await expect(this.copyRequestButton('Review **this change**.')).toBeVisible();
  }
  async copyRequest(text: string, touch: boolean) {
    await this.activateCopy(this.copyRequestButton(text), touch);
  }
  async expectCopyBelowRequest(text: string) {
    const [bubble, button] = await Promise.all([
      this.request(text).getByText(text).boundingBox(),
      this.copyRequestButton(text).boundingBox(),
    ]);
    expect(button!.y).toBeGreaterThanOrEqual(bubble!.y + bubble!.height);
    expect(button!.x + button!.width).toBeCloseTo(bubble!.x + bubble!.width);
  }
}
