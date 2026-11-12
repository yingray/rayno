import { expect } from '@playwright/test';
import { SessionListPreferencesPage } from './SessionListPreferencesPage';

export const pinDemoTitle = 'Pin sessions · Interactive demo';

export class SessionPinPage extends SessionListPreferencesPage {
  rowActions(title = pinDemoTitle) { return this.sessionList().getByRole('button', { name: `Actions for ${title}`, exact: true }); }
  menu() { return this.page.getByRole('menu', { name: 'Session actions', exact: true }); }
  pinMark(title = pinDemoTitle) {
    return this.sessionList().getByRole('button', { name: title }).filter({ hasNotText: 'Actions for' }).getByRole('img', { name: 'Pinned', exact: true });
  }
  async firstRow() {
    await this.ensureListOpen();
    return this.sessionList().getByRole('button', { name: /^Actions for / }).first().getAttribute('aria-label');
  }
  async expectFirst(first: boolean, title = pinDemoTitle) {
    const check = expect.poll(() => this.firstRow());
    if (first) await check.toBe(`Actions for ${title}`);
    else await check.not.toBe(`Actions for ${title}`);
  }
  async choose(action: 'Pin session' | 'Unpin session') {
    const item = this.menu().getByRole('menuitem', { name: action, exact: true });
    await item.scrollIntoViewIfNeeded();
    const box = (await item.boundingBox())!, viewport = this.page.viewportSize()!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await this.activate(item);
    await expect(this.menu()).toHaveCount(0);
  }
  async toggleFromRow(action: 'Pin session' | 'Unpin session', title = pinDemoTitle) {
    await this.ensureListOpen();
    // Keep the row clear of the phone navigation at the bottom of the list.
    await this.rowActions(title).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await this.activate(this.rowActions(title));
    await expect(this.menu()).toBeVisible();
    await this.choose(action);
  }
  async toggleFromChat(action: 'Pin session' | 'Unpin session') {
    await this.activate(this.page.getByRole('button', { name: 'Session actions', exact: true }));
    await expect(this.menu()).toBeVisible();
    await this.choose(action);
  }
  savedPins() {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).preferences.pinnedSessions);
  }
}
