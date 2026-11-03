import { expect } from '@playwright/test';
import { WorkspacePage } from './WorkspacePage';

export class WorkspaceLoadingPage extends WorkspacePage {
  skeleton() { return this.page.getByRole('status', { name: 'Read your sessions…', exact: true, includeHidden: true }); }
  replay() { return this.page.getByRole('button', { name: 'Replay loading', exact: true }); }
  demoRow() { return this.sessionList().getByRole('button').filter({ has: this.page.locator('time'), hasText: 'Workspace loading · Interactive demo' }); }
  async openDemo() { await this.page.goto('/sessions?demo=1&workspaceLoading=1'); }
  async expectLoading() {
    await expect(this.skeleton()).toBeVisible();
    await expect(this.page.getByRole('heading', { name: 'Sessions', level: 1, exact: true, includeHidden: true })).toBeVisible();
    await expect(this.page.getByText('Open your workspace', { exact: true })).toHaveCount(0);
    await expect(this.page.getByText('A fresh start', { exact: true })).toHaveCount(0);
    await expect(this.page.getByRole('alert', { name: 'Connection error' })).toHaveCount(0);
    await this.page.getByRole('dialog').evaluateAll(dialogs => Promise.all(dialogs.flatMap(dialog => dialog.getAnimations().map(animation => animation.finished))));
    await this.expectNoPageOverflow();
  }
  async expectReachable(control: ReturnType<WorkspaceLoadingPage['replay']>) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
  async activate(control: ReturnType<WorkspaceLoadingPage['replay']>) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await control.tap();
    else await control.click();
  }
  async finishDemoLoading() {
    await expect(this.skeleton()).toHaveCount(0);
    await expect(this.replay()).toBeEnabled();
  }
  async openExample() {
    await this.openSessionSearch();
    await this.sessionSearch().fill('Workspace loading');
    await this.sessionSearch().press('Enter');
    await expect(this.demoRow()).toBeVisible();
    await this.activate(this.demoRow());
    await expect(this.page.getByRole('link', { name: 'Open the session list loading demo', exact: true })).toBeVisible();
  }
}
