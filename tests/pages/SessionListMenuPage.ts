import { expect } from '@playwright/test';
import { ChatActionsPage } from './ChatActionsPage';

export class SessionListMenuPage extends ChatActionsPage {
  rowActions() { return this.sessionList().getByRole('button', { name: 'Actions for PNG paste, search and Mermaid · Interactive demo', exact: true }); }
  async openDemo(chat = false) {
    await this.page.goto(chat ? '/session/paste-search-demo?demo=1' : '/sessions?demo=1');
    await expect(this.page.getByRole('heading', { name: 'Sessions', exact: true }).or(this.page.getByRole('button', { name: 'Open session list', exact: true }))).toBeVisible();
    if (!await this.sessionList().isVisible()) await this.page.getByRole('button', { name: 'Open session list', exact: true }).click();
    await expect(this.sessionList()).toBeVisible();
    await this.searchSessions('PNG paste');
    await expect(this.rowActions()).toBeVisible();
    await this.page.evaluate(() => {
      (window as any).menuLoading = false;
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Load screen"]')) (window as any).menuLoading = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
  }
  async openRowActions(touch: boolean) {
    const trigger = this.rowActions();
    await trigger.scrollIntoViewIfNeeded();
    if (touch) { await this.expectTouchTarget(trigger); await trigger.tap(); }
    else await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(this.menu()).toBeVisible();
    await expect(this.page.getByRole('dialog', { name: 'Session actions', exact: true })).toHaveCount(0);
    expect(await this.page.evaluate(() => (window as any).menuLoading)).toBe(false);
    await this.expectMenuUsable();
    await this.expectNoPageOverflow();
  }
  async dismissWithTrigger(touch: boolean) {
    if (touch) await this.rowActions().tap();
    else await this.rowActions().click();
    await expect(this.menu()).toHaveCount(0);
    await expect(this.rowActions()).toHaveAttribute('aria-expanded', 'false');
    await expect(this.rowActions()).toBeFocused();
  }
  async dismissWithOutsideClick() {
    const list = (await this.sessionList().boundingBox())!;
    await this.page.mouse.click(list.x + 2, list.y + 2);
    await expect(this.menu()).toHaveCount(0);
  }
  async dismissWithEscape() {
    await this.page.keyboard.press('Escape');
    await expect(this.menu()).toHaveCount(0);
    await expect(this.rowActions()).toBeFocused();
  }
}
