import { expect, type Locator } from '@playwright/test';
import { PriorityFeaturesPage } from './PriorityFeaturesPage';

export class GitChangesPage extends PriorityFeaturesPage {
  screen() { return this.page.getByRole('region', { name: 'Git changes', exact: true }); }
  diff() { return this.screen().getByRole('region', { name: 'File diff', exact: true }); }
  fileToggle() { return this.screen().locator('aside > button'); }
  async use(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(control);
    if (await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await control.tap();
    else await control.click();
  }
  async openChanges(demo = false) {
    if (demo) {
      await this.page.goto('/session/git-diff-demo?demo=1');
      await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    } else await this.openSession();
    await this.info();
    await this.use(this.page.getByRole('button', { name: /^View changes/ }));
    await expect(this.screen()).toBeVisible();
    await expect(this.screen().getByRole('heading', { name: /^Git changes/ })).toBeVisible();
  }
  async showFiles() {
    if (await this.fileToggle().isVisible() && await this.fileToggle().getAttribute('aria-expanded') === 'false') await this.use(this.fileToggle());
  }
  async selectFile(path: string) {
    await this.showFiles();
    const search = this.screen().getByRole('searchbox', { name: 'Filter changed files', exact: true });
    await search.fill(path);
    if (this.page.viewportSize()!.width < 768) await expect(search).toHaveCSS('font-size', '16px');
    await this.use(this.screen().getByRole('navigation', { name: 'Changed files' }).getByTitle(path, { exact: true }));
    await expect(this.screen().getByRole('heading', { name: path, exact: true })).toBeVisible();
  }
  async clearSearch() {
    await this.showFiles();
    await this.screen().getByRole('searchbox', { name: 'Filter changed files', exact: true }).fill('');
  }
  async filter(name: string) {
    await this.use(this.screen().getByRole('group', { name: 'Change filters', exact: true }).getByRole('button', { name: new RegExp('^' + name) }));
  }
  async source(name: string) { await this.use(this.screen().getByRole('group', { name: 'Diff source', exact: true }).getByRole('button', { name, exact: true })); }
  async layout(name: string) { await this.use(this.screen().getByRole('group', { name: 'Diff layout', exact: true }).getByRole('button', { name, exact: true })); }
  async scenario(value: string) {
    const select = this.screen().getByRole('combobox', { name: 'Demo repository state', exact: true });
    await select.scrollIntoViewIfNeeded(); await select.selectOption(value);
  }
  async expectControlLayout() {
    const issues = await this.screen().evaluate(screen => {
      const toolbar = screen.querySelector<HTMLElement>('[data-diff-toolbar]')!;
      if (!toolbar) return ['Missing diff toolbar'];
      const buttons = [...toolbar.querySelectorAll('button')];
      const bounds = toolbar.getBoundingClientRect();
      return buttons.flatMap((button, index) => {
        const box = button.getBoundingClientRect(), group = button.closest('[role="group"]')?.getBoundingClientRect();
        const problems: string[] = [];
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1) problems.push(`Outside toolbar: ${button.textContent || button.ariaLabel}`);
        if (group && (box.top < group.top - 1 || box.bottom > group.bottom + 1)) problems.push(`Outside group: ${button.textContent}`);
        const text = document.createRange(); text.selectNodeContents(button);
        const label = text.getBoundingClientRect();
        if (label.width && (label.left < box.left - 1 || label.right > box.right + 1)) problems.push(`Clipped label: ${button.textContent}`);
        for (const other of buttons.slice(index + 1)) {
          const next = other.getBoundingClientRect();
          if (Math.min(box.right, next.right) - Math.max(box.left, next.left) > 1 && Math.min(box.bottom, next.bottom) - Math.max(box.top, next.top) > 1)
            problems.push(`Overlapping: ${button.textContent}/${other.textContent}`);
        }
        return problems;
      });
    });
    expect(issues).toEqual([]);
  }
  async expectHeaderGit(branch: string, counts: string) {
    const label = this.page.locator('[data-session-branch]').first(), changes = this.page.locator('[data-session-changes]').first();
    await expect(label).toBeVisible(); await expect(label).toHaveText(branch);
    await expect(changes).toBeVisible(); await expect(changes).toHaveText(counts);
    const a = (await label.boundingBox())!, b = (await changes.boundingBox())!;
    expect(a.width).toBeGreaterThan(12); expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
    expect(b.x + b.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
  }
  async expectDiffContrast() {
    const colors = await this.diff().evaluate(region => ['add', 'remove'].map(kind => {
      const cell = region.querySelector<HTMLElement>(`tr[data-kind='${kind}'] td:last-child, td[data-kind='${kind}']:has(code)`)!;
      const style = getComputedStyle(cell);
      return { kind, color: style.color.match(/[\d.]+/g)!.map(Number), background: style.backgroundColor.match(/[\d.]+/g)!.map(Number) };
    }));
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    for (const item of colors) {
      const a = luminance(item.color), b = luminance(item.background);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
      if (item.kind === 'add') expect(item.background[1] - item.background[0]).toBeGreaterThan(20);
      else expect(item.background[0] - item.background[1]).toBeGreaterThan(20);
      expect(item.background[3] ?? 1).toBe(1);
    }
  }
}
