import { expect } from '@playwright/test';
import { SideChatsPage } from './SideChatsPage';
import type { PanelKind } from '../../src/app/panelWidths';

export class ResizablePanelsPage extends SideChatsPage {
  separator(kind: PanelKind) { return this.page.getByRole('separator', { name: kind === 'info' ? 'Resize session info' : 'Resize side chat', exact: true }); }
  mainChat() { return this.page.getByRole('region', { name: 'Chat session', exact: true }); }
  async openPanel(kind: PanelKind) {
    await this.page.goto(`/session/real-session/${kind === 'info' ? 'info' : 'side'}`);
    await expect(this.separator(kind)).toBeVisible();
  }
  async panelWidth(kind: PanelKind) {
    return this.separator(kind).evaluate(element => element.parentElement!.querySelector('aside')!.getBoundingClientRect().width);
  }
  async expectPanelWidth(kind: PanelKind, width: number) {
    await expect.poll(() => this.panelWidth(kind)).toBeCloseTo(width, 0);
    await expect(this.separator(kind)).toHaveAttribute('aria-valuenow', String(width));
  }
  async limit(kind: PanelKind, edge: 'min' | 'max') {
    return Number(await this.separator(kind).getAttribute(`aria-value${edge}`));
  }
  async expectMainUsable() {
    const side = this.separator('side');
    await expect.poll(async () => {
      const minimum = await side.count() ? (await this.limit('side', 'min')) - 2 : 520;
      return (await this.mainChat().boundingBox())!.width - minimum;
    }).toBeGreaterThanOrEqual(0);
    const input = this.mainChat().getByRole('textbox', { name: 'Message', exact: true });
    const send = this.mainChat().getByRole('button', { name: 'Send message', exact: true });
    for (const control of [input, send]) await this.expectInViewport(control);
    await this.expectNoPageOverflow();
  }
  async drag(kind: PanelKind, distance: number, browser: string) {
    const control = this.separator(kind), box = (await control.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    expect(await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element === document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    })).toBe(true);
    if (browser === 'chromium' && await this.page.evaluate(() => navigator.maxTouchPoints > 0)) {
      await this.expectTouchTarget(control);
      const session = await this.page.context().newCDPSession(this.page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + distance * step / 6, y }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await this.page.mouse.move(x, y); await this.page.mouse.down();
      await this.page.mouse.move(x + distance, y, { steps: 6 });
      // The drag state lives on the root, not in a `:has()` rule that restyles the tree on each chat update.
      await expect(this.page.locator('html')).toHaveAttribute('data-panel-resizing', '');
      await this.page.mouse.up();
      await expect(this.page.locator('html')).not.toHaveAttribute('data-panel-resizing');
    }
  }
}
