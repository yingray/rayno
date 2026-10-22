import { expect } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class AgentRequestsPage extends PriorityFeaturesPage {
  dismiss() { return this.requests().getByRole('button', { name: 'Dismiss', exact: true }); }
  userMessage(text: string) { return this.page.locator('article[data-role="user"]').filter({ hasText: text }); }
  async expectRequestUsable(touch: boolean) {
    const viewport = this.page.viewportSize()!;
    for (const button of await this.requests().getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      await this.expectTouchTarget(button);
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // The control is the top element at its center, so a tap reaches it.
      expect(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
    }
    for (const field of await this.requests().getByRole('textbox').all()) await expect(field).toHaveCSS('font-size', '16px');
    await this.expectNoPageOverflow();
    if (touch) await this.dismiss().scrollIntoViewIfNeeded();
  }
  async tapOrClickDismiss(touch: boolean) {
    await this.dismiss().scrollIntoViewIfNeeded();
    if (touch) await this.dismiss().tap();
    else await this.dismiss().click();
  }
  async expectSendState(text: string, state: string | null) {
    const message = this.userMessage(text);
    await expect(message).toBeVisible();
    if (state === null) {
      await expect(message.locator('p')).toHaveCount(0);
      await expect(message.locator('[data-pending]')).toHaveCount(0);
    } else await expect(message.locator('p')).toHaveText(state);
  }
  async expectLastMessage(text: string) {
    await expect(this.page.locator('article[data-message-id]').last()).toContainText(text);
  }
}
