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
}
