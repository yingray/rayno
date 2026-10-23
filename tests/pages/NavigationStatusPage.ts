import { expect } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class NavigationStatusPage extends PriorityFeaturesPage {
  navigation() { return this.page.getByRole('navigation', { name: 'Main navigation', exact: true }); }
  sessionsButton() { return this.navigation().getByRole('button', { name: 'Sessions', exact: true }); }
  unreadBadge() { return this.sessionsButton().getByRole('img', { name: 'Unread messages', exact: true }); }
  updateIcon() { return this.navigation().getByRole('button', { name: 'Update Rayno', exact: true }); }
  updateNotice() { return this.page.getByRole('region', { name: 'Rayno update', exact: true }); }
  async activate(control: import('@playwright/test').Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async dismissUpdate() {
    await this.activate(this.updateNotice().getByRole('button', { name: 'Dismiss update notification', exact: true }));
    await expect(this.updateNotice()).toHaveCount(0);
  }
  async installUpdate() {
    await this.activate(this.updateNotice().getByRole('button', { name: 'Reload and update', exact: true }));
  }
  async expectUpdateUsable() {
    await expect(this.updateNotice()).toBeVisible();
    for (const control of [this.updateIcon(), ...await this.updateNotice().getByRole('button').all()]) {
      await control.scrollIntoViewIfNeeded();
      await this.expectTouchTarget(control);
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }
    const box = (await this.updateNotice().boundingBox())!, viewport = this.page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await this.expectNoPageOverflow();
  }
  async markPage() { await this.page.evaluate(() => { (window as unknown as { navigationKept: boolean }).navigationKept = true; }); }
  async pageKept() { return this.page.evaluate(() => (window as unknown as { navigationKept?: boolean }).navigationKept === true).catch(() => true); }
}
