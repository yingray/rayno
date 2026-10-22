import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { ChatActionsPage } from './ChatActionsPage';

export class SessionOperationsPage extends ChatActionsPage {
  worktreeDialog() { return this.page.getByRole('dialog', { name: 'Delete this worktree?', exact: true }); }
  details() { return this.page.getByRole('region', { name: 'Session details', exact: true }); }
  deleteActions() { return this.details().getByRole('button', { name: /^Delete( session)?$/ }); }
  async expectPromptUsable(dialog: Locator, path: string, buttons: string[]) {
    const viewport = this.page.viewportSize()!;
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(path, { exact: true })).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    for (const name of buttons) {
      const control = dialog.getByRole('button', { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      await this.expectTouchTarget(control);
      const target = (await control.boundingBox())!;
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.y + target.height).toBeLessThanOrEqual(viewport.height);
      expect(await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
    await this.expectNoPageOverflow();
  }
  async press(dialog: Locator, name: string, touch: boolean) {
    const button = dialog.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    if (touch) await button.tap();
    else await button.click();
  }
  async deleteFromInfo() {
    await this.info();
    const action = this.deleteActions().filter({ visible: true }).first();
    await action.scrollIntoViewIfNeeded();
    await action.click();
    await this.page.getByRole('dialog', { name: 'Delete this session?' }).getByRole('button', { name: 'Delete session', exact: true }).click();
  }
}
