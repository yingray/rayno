import { expect } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class ReplyOptionsDemoPage extends LiveWorkspacePage {
  input() { return this.page.getByRole('textbox', { name: 'Message', exact: true }); }
  option(label: string) { return this.replyOptions().last().getByRole('button', { name: label, exact: true }); }
  async open() {
    await this.page.goto('/session/reply-options-demo?demo=1');
    await expect(this.option('Check the mobile layout')).toBeVisible();
  }
  async expectReplyTargetsReachable() {
    // Pause follow before the manual scroll, as a reader does with a touch or wheel gesture.
    await this.conversation().dispatchEvent('touchmove');
    await super.expectReplyTargetsReachable();
  }
  async toggle(label: string, touch: boolean) {
    if (touch) await this.option(label).tap();
    else await this.option(label).click();
  }
  async expectUserMessages(count: number) {
    await expect(this.page.locator('article[data-role="user"]')).toHaveCount(count);
  }
}
