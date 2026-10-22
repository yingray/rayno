import { expect, type Locator } from '@playwright/test';
import { ComposerSuggestionsPage } from './ComposerSuggestionsPage';

// The rows that share the space above and below the composer: terminal control, goal and todo progress, and context use.
export class ComposerStackPage extends ComposerSuggestionsPage {
  notice() { return this.page.getByRole('group', { name: 'Terminal control', exact: true }); }
  takeControl() { return this.notice().getByRole('button', { name: 'Take control', exact: true }); }
  dock() { return this.page.getByRole('group', { name: 'Session progress', exact: true }); }
  todoChip() { return this.dock().getByRole('button', { name: /^Todo list: / }); }
  context() { return this.page.getByRole('meter', { name: 'Context window', exact: true }); }
  frame() { return this.page.locator('[data-focus-frame]').filter({ has: this.input() }); }
  header() { return this.page.getByRole('region', { name: 'Chat session', exact: true }).locator('header').first(); }
  async box(locator: Locator) { return (await locator.boundingBox())!; }
  // A control stays inside the viewport with a 44px target, and a tap at its center reaches it.
  async expectReachable(control: Locator) {
    const bounds = await this.box(control), viewport = this.page.viewportSize()!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  // Visible rows stack without overlap: notice, dock, composer frame, then the context warning, all inside the viewport.
  async expectStacked() {
    const viewport = this.page.viewportSize()!;
    const rows: Locator[] = [];
    for (const row of [this.notice(), this.dock(), this.frame(), this.context()]) if (await row.isVisible()) rows.push(row);
    const boxes = await Promise.all(rows.map((row) => this.box(row)));
    const header = await this.box(this.header());
    for (const box of boxes) expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
    // Rows in one line (a short landscape phone) sit side by side and must not overlap.
    for (let index = 1; index < boxes.length; index++) {
      const [above, below] = [boxes[index - 1], boxes[index]];
      const sideBySide = Math.abs(below.y - above.y) < 1;
      if (sideBySide) expect(below.x).toBeGreaterThanOrEqual(above.x + above.width - 1);
      else expect(below.y).toBeGreaterThanOrEqual(above.y + above.height - 1);
    }
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    const last = boxes.at(-1)!;
    expect(last.y + last.height).toBeLessThanOrEqual(viewport.height);
    // Some of the conversation stays readable between the header and the first row.
    return Math.min(...boxes.map((box) => box.y)) - header.y - header.height;
  }
}
