import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class TerminalControlPage extends LiveWorkspacePage {
  notice() { return this.page.getByRole('group', { name: 'Terminal control', exact: true }); }
  takeControlButton() { return this.notice().getByRole('button', { name: /^(Take control|Taking control…)$/ }); }
  message() { return this.page.getByRole('textbox', { name: 'Message', exact: true }); }
  async press(target: Locator, touch: boolean) {
    if (touch) await target.tap();
    else await target.click();
  }
  async expectTerminalControl(controlled: boolean) {
    if (controlled) {
      await expect(this.notice()).toContainText('The terminal controls this session');
      await expect(this.message()).toHaveAttribute('placeholder', 'Send a message to take control…');
      await expect(this.page.getByText('The terminal controls this session', { exact: true }).first()).toBeVisible();
    } else {
      await expect(this.notice()).toHaveCount(0);
      await expect(this.message()).toHaveAttribute('placeholder', 'Type a message…');
    }
  }
  async expectReachable(target: Locator) {
    await target.scrollIntoViewIfNeeded();
    const bounds = (await target.boundingBox())!;
    const viewport = this.page.viewportSize()!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    const hit = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    });
    expect(hit).toBe(true);
  }
}
