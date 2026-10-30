import { expect, type Page } from '@playwright/test';
import { WorkspaceLayoutPage } from './WorkspaceLayoutPage';

export class SessionListPreferencesPage extends WorkspaceLayoutPage {
  constructor(page: Page, readonly mode: 'live' | 'demo') { super(page); }
  url(path: string) { return `${path}${this.mode === 'demo' ? '?demo=1' : ''}`; }
  async ensureListOpen() {
    await expect(this.sessionList().or(this.page.getByRole('button', { name: 'Open session list', exact: true })).first()).toBeVisible();
    if (!await this.sessionList().isVisible()) await this.page.keyboard.press('ControlOrMeta+k');
    await expect(this.sessionList()).toBeVisible();
  }
  async openList() { await this.page.goto(this.url('/sessions')); await this.ensureListOpen(); }
  grouping(value: 'flat' | 'projects') {
    return this.sessionList().getByRole('group', { name: 'Session list mode', exact: true })
      .getByRole('button', { name: value === 'flat' ? 'Flat' : 'Projects', exact: true });
  }
  async expectChoices(mode: 'flat' | 'projects', archived: boolean) {
    await this.ensureListOpen();
    await expect(this.grouping(mode)).toHaveAttribute('aria-pressed', 'true');
    await expect(this.archiveToggle()).toHaveAttribute('aria-pressed', String(archived));
    for (const control of [this.grouping(mode), this.archiveToggle()]) {
      await expect.poll(async () => {
        await this.ensureListOpen();
        const box = await control.boundingBox();
        return box ? Math.min(box.width, box.height) : 0;
      }).toBeGreaterThanOrEqual(44);
    }
    await this.expectNoPageOverflow();
  }
  async reloadAndExpect(mode: 'flat' | 'projects', archived: boolean) {
    await this.page.reload();
    await this.expectChoices(mode, archived);
  }
  async selectAndReturn(archived: boolean) {
    const title = this.mode === 'demo'
      ? archived ? 'PNG paste · Archived example' : 'PNG paste, search and Mermaid · Interactive demo'
      : archived ? 'Older workspace' : 'Connected workspace';
    await this.activate(this.sessionRow(title));
    await expect(this.mainChat()).toBeVisible();
    await this.page.reload();
    await expect(this.mainChat()).toBeVisible();
    await this.page.keyboard.press('ControlOrMeta+k');
    await expect(this.sessionSearch()).toBeFocused();
    await this.closeSessionSearch();
  }
  async exercisePersistence() {
    await this.openList();
    await this.expectChoices('flat', false);
    await this.activate(this.grouping('projects'));
    await this.expectChoices('projects', false);
    await this.activate(this.archiveToggle());
    await this.expectChoices('projects', true);

    await this.selectAndReturn(true);
    await this.expectChoices('projects', true);
    await this.page.goto(this.url('/settings/appearance'));
    await this.openList();
    await this.expectChoices('projects', true);
    await this.reloadAndExpect('projects', true);

    await this.activate(this.grouping('flat'));
    await this.expectChoices('flat', true);
    await this.reloadAndExpect('flat', true);
    await this.activate(this.archiveToggle());
    await this.expectChoices('flat', false);
    await this.activate(this.grouping('projects'));
    await this.expectChoices('projects', false);
    await this.reloadAndExpect('projects', false);
    await this.selectAndReturn(false);
    await this.expectChoices('projects', false);
  }
}
