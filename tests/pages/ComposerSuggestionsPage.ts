import { expect } from '@playwright/test';
import { PerformancePage } from './PerformancePage';

export class ComposerSuggestionsPage extends PerformancePage {
  suggestions(kind: 'Command' | 'File') { return this.page.getByRole('listbox', { name: `${kind} suggestions`, exact: true }); }
  option(kind: 'Command' | 'File', label: string) {
    return this.suggestions(kind).getByRole('option').filter({ has: this.page.locator('strong', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) }) });
  }
  async expectSelected(kind: 'Command' | 'File', label: string) {
    await expect(this.option(kind, label)).toHaveAttribute('aria-selected', 'true');
    const id = await this.option(kind, label).getAttribute('id');
    await expect(this.input()).toHaveAttribute('aria-activedescendant', id!);
  }
  async expectListUsable(kind: 'Command' | 'File') {
    const list = this.suggestions(kind);
    await expect(list).toBeVisible();
    const viewport = this.page.viewportSize()!;
    const box = (await list.boundingBox())!;
    const frame = (await this.page.locator('[data-focus-frame]').filter({ has: this.input() }).boundingBox())!;
    const header = (await this.page.getByRole('region', { name: 'Chat session', exact: true }).locator('header').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y);
    const options = list.getByRole('option');
    for (const option of await options.all()) {
      const target = (await option.boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeLessThanOrEqual(box.width);
    }
    const last = options.last();
    await last.scrollIntoViewIfNeeded();
    const target = (await last.boundingBox())!;
    expect(target.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(target.y + target.height).toBeLessThanOrEqual(box.y + box.height + 1);
    expect(await last.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await this.expectNoPageOverflow();
  }
}
