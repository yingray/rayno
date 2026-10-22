import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { ChatActionsPage } from './ChatActionsPage';

export class SideChatsPage extends ChatActionsPage {
  panel() { return this.page.getByRole('region', { name: 'Side chats', exact: true }); }
  tabs() { return this.panel().getByRole('group', { name: 'Open side chats', exact: true }); }
  tab(name: string) { return this.tabs().getByRole('button', { name, exact: true }); }
  sideChat() { return this.page.getByRole('region', { name: 'Side chat conversation', exact: true }); }
  sessionList() { return this.page.getByRole('region', { name: 'Session list', exact: true }); }
  headerButton() { return this.page.getByRole('button', { name: /^Side chats/ }); }
  newButton() { return this.panel().getByRole('button', { name: /^(New side chat|Start a side chat)$/ }).first(); }
  row(name: string) { return this.panel().getByRole('button', { name: `Open ${name}`, exact: true }); }
  close(name: string) { return this.panel().getByRole('button', { name: `Close ${name}`, exact: true }); }
  parentBack() { return this.page.getByRole('button', { name: 'Back to parent chat', exact: true }); }
  async openFromMenu() {
    await this.openActions();
    await this.menu().getByRole('menuitem', { name: /^Side chats/ }).click();
  }
  async expectInViewport(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!, viewport = this.page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }
  async expectUsableList() {
    for (const control of [this.newButton(), ...await this.panel().getByRole('button').all()]) {
      await this.expectInViewport(control);
      await this.expectTouchTarget(control);
    }
    await this.expectNoPageOverflow();
  }
  /** The embedded composer fits its panel: no control crosses the panel edge. */
  async expectComposerFits() {
    const result = await this.sideChat().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll<HTMLElement>('textarea, [aria-label="Send message"], [aria-label="Model and effort"]')];
      return controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5 && rect.bottom <= bounds.bottom + 0.5 && rect.width > 0;
      });
    });
    expect(result).toEqual([true, true, true]);
  }
}
