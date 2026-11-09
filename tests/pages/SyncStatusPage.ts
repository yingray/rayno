import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class SyncStatusPage extends LiveWorkspacePage {
  chat() { return this.page.getByRole('region', { name: 'Chat session', exact: true }); }
  demoControls() { return this.page.getByRole('group', { name: 'Sync status demo', exact: true }); }
  demoButton(name: string) { return this.demoControls().getByRole('button', { name, exact: true }); }
  status(area: 'Session list' | 'Conversation') { return this.availability(area); }
  failure() { return this.page.getByRole('alert', { name: 'Connection error', exact: true }); }
  messageFailure() { return this.page.getByRole('alert', { name: 'Message sync error', exact: true }); }
  details() { return this.page.getByRole('region', { name: 'Sync details', exact: true }); }
  intro() { return this.page.getByRole('heading', { name: 'Try the sync status', exact: true }); }
  async openDemo() { await this.page.goto('/session/sync-status-demo?demo=1'); await expect(this.intro()).toBeVisible(); }
  async touch() { return this.page.evaluate(() => navigator.maxTouchPoints > 0); }
  async use(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.touch()) await control.tap(); else await control.click();
  }
  async step(name: string) { await this.use(this.demoButton(name)); }
  // A control is a 44px target, inside the viewport, and nothing covers its center.
  async expectReachable(control: Locator) {
    const box = (await control.boundingBox())!, viewport = this.page.viewportSize()!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  // The status floats over the messages. It must not cover the composer.
  async expectClearOfComposer(status: Locator) {
    const box = (await status.boundingBox())!;
    const composer = (await this.page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(composer.y);
  }
  async introTop() { return (await this.intro().boundingBox())!.y; }
  async hideAndShow(persisted: boolean) {
    await this.page.evaluate((persisted) => {
      let state: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'visible';
      if (persisted) window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      else document.dispatchEvent(new Event('visibilitychange'));
    }, persisted);
  }
}
