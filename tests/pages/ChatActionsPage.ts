import { expect } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class ChatActionsPage extends PriorityFeaturesPage {
  trigger() { return this.page.getByRole('button', { name: 'Session actions', exact: true }); }
  menu() { return this.page.getByRole('menu', { name: 'Session actions', exact: true }); }
  duplicateDialog() { return this.page.getByRole('dialog', { name: 'Duplicate session', exact: true }); }
  async openActions() {
    await this.trigger().click();
    await expect(this.menu()).toBeVisible();
    await this.expectTouchTarget(this.trigger());
  }
  async chooseAction(name: string) { await this.menu().getByRole('menuitem', { name, exact: true }).click(); }
  async selectPoint(name: string) { await this.duplicateDialog().getByRole('radio', { name: new RegExp(name) }).click(); }
  async confirmDuplicate() { await this.duplicateDialog().getByRole('button', { name: 'Duplicate session', exact: true }).click(); }
  async expectWideChat() {
    const dimensions = await this.page.getByRole('region', { name: 'Chat session', exact: true }).evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const messages = element.querySelector<HTMLElement>('[data-font-size]')!;
      const textarea = element.querySelector('textarea')!;
      const composer = textarea.parentElement!.parentElement!.getBoundingClientRect();
      const width = element.querySelector('[aria-label="Conversation messages"]')!.clientWidth;
      return { maxWidth: getComputedStyle(messages).maxWidth, messageWidth: messages.getBoundingClientRect().width,
        width, left: composer.left - bounds.left, right: bounds.right - composer.right };
    });
    expect(dimensions.maxWidth).toBe('none');
    expect(Math.abs(dimensions.messageWidth - dimensions.width)).toBeLessThanOrEqual(1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeGreaterThanOrEqual(0);
    expect(dimensions.left).toBeLessThanOrEqual(12.1);
    expect(dimensions.right).toBeLessThanOrEqual(12.1);
    const info = this.page.getByRole('button', { name: 'Toggle session info', exact: true });
    await this.expectTouchTarget(info);
    const infoBox = (await info.boundingBox())!, trigger = (await this.trigger().boundingBox())!;
    expect(trigger.x).toBeGreaterThan(infoBox.x);
  }
  async expectMenuUsable() {
    const bounds = (await this.menu().boundingBox())!, viewport = this.page.viewportSize()!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    for (const item of await this.menu().getByRole('menuitem').all()) {
      await item.scrollIntoViewIfNeeded();
      await this.expectTouchTarget(item);
    }
  }
}
