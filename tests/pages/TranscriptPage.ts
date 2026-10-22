import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class TranscriptPage extends LiveWorkspacePage {
  async openChat(text: string) {
    await this.page.goto('/session/real-session');
    await expect(this.page.getByText(text, { exact: true })).toBeVisible();
  }
  thinking() { return this.conversation().locator('details').filter({ has: this.page.locator('summary', { hasText: /^Thinking$/ }) }); }
  toolRow(name: string) { return this.toolGroups().locator('summary', { hasText: name }); }
  subagentWork() { return this.toolGroups().getByRole('list', { name: 'Subagent work', exact: true }); }
  async toggle(summary: Locator, touch: boolean) {
    await summary.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    if (touch) await summary.tap(); else await summary.click();
  }
  async expectTarget(summary: Locator, touch: boolean) {
    // A resize can move the conversation back to the latest message, so scroll again until the row takes the tap.
    await expect.poll(() => summary.evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + Math.min(20, rect.width / 2), rect.y + rect.height / 2));
    })).toBe(true);
    const bounds = (await summary.boundingBox())!;
    const viewport = this.page.viewportSize()!;
    if (touch) expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  }
}
