import { expect, type Locator } from '@playwright/test';
import { WorkspaceLayoutPage } from './WorkspaceLayoutPage';

export class ComposerPastePage extends WorkspaceLayoutPage {
  message() { return this.mainChat().getByRole('textbox', { name: 'Message', exact: true }); }
  async openPasteDemo() {
    await this.page.goto('/session/paste-search-demo?demo=1');
    await expect(this.message()).toBeVisible();
  }
  async pasteImage(field: Locator, itemsOnly = false, size = 0) {
    await field.focus();
    return field.evaluate((element, { itemsOnly, size }) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([size ? new Uint8Array(size) : bytes], 'pasted.png', { type: 'image/png' }));
      if (itemsOnly) Object.defineProperty(clipboard, 'files', { value: [] });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, { itemsOnly, size });
  }
  async expectPendingImage() {
    const remove = this.mainChat().getByRole('button', { name: 'Remove pasted.png', exact: true });
    await expect(remove).toBeVisible();
    await expect(this.mainChat().getByRole('button', { name: 'pasted.png', exact: true }).locator('img')).toHaveJSProperty('naturalWidth', 1);
    await this.expectInViewport(remove);
    await this.expectTouchTarget(remove);
    await this.expectInViewport(this.mainChat().getByRole('button', { name: 'Send message', exact: true }));
  }
  async exerciseImage() {
    await this.message().fill('Keep this draft');
    expect(await this.pasteImage(this.message())).toBe(true);
    await expect(this.message()).toHaveValue('Keep this draft');
    await this.expectPendingImage();
    await this.activate(this.mainChat().getByRole('button', { name: 'pasted.png', exact: true }));
    const dialog = this.page.getByRole('dialog', { name: 'pasted.png', exact: true });
    await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', 1);
    await this.activate(dialog.getByRole('button', { name: 'Close pasted.png', exact: true }));
    await this.activate(this.mainChat().getByRole('button', { name: 'Remove pasted.png', exact: true }));
    await this.message().fill('');
    expect(await this.pasteImage(this.message(), true)).toBe(true);
    await this.expectPendingImage();
    await this.activate(this.mainChat().getByRole('button', { name: 'Send message', exact: true }));
    await expect(this.mainChat().getByRole('button', { name: 'Remove pasted.png', exact: true })).toHaveCount(0);
    await expect.poll(() => this.savedImages()).toEqual(['pasted.png']);
    const sample = this.mainChat().getByRole('button', { name: 'Try a sample PNG', exact: true });
    await this.expectTouchTarget(sample);
    await this.activate(sample);
    await expect(this.mainChat().getByRole('button', { name: 'Remove sample.png', exact: true })).toBeVisible();
    await this.activate(this.mainChat().getByRole('button', { name: 'Remove sample.png', exact: true }));
  }
  async savedImages() {
    return this.page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
      return saved.sessions.find((s: { id: string }) => s.id === 'paste-search-demo').messages
        .filter((m: { role: string }) => m.role === 'user').flatMap((m: { attachments: { name: string }[] }) => m.attachments.map(a => a.name));
    });
  }
  async expectProjectRowLayout(title: string) {
    const row = this.sessionRow(title);
    const label = (await row.getByText(title, { exact: true }).boundingBox())!;
    const time = (await row.locator('time').boundingBox())!;
    const frame = (await row.boundingBox())!;
    expect(Math.abs(label.y - time.y)).toBeLessThanOrEqual(1);
    expect(label.y - frame.y).toBeLessThanOrEqual(11);
    expect(label.x + label.width).toBeLessThanOrEqual(time.x);
    await this.expectTouchTarget(row);
  }
  async exerciseSessionSearch() {
    await this.page.keyboard.press('ControlOrMeta+k');
    await expect(this.sessionSearch()).toBeFocused();
    await this.sessionSearch().fill('PNG paste');
    await expect(this.sessionRow('PNG paste and session search · Interactive demo')).toBeVisible();
    await expect(this.sessionRow('PNG paste and session search · Interactive demo').getByText('rayno', { exact: true })).toBeVisible();
    await this.activate(this.sessionList().getByRole('button', { name: 'Projects', exact: true }));
    await expect(this.sessionList().getByRole('heading', { level: 2 }).filter({ hasText: 'Rayno' })).toBeVisible();
    await expect(this.sessionRow('PNG paste and session search · Interactive demo').getByText('rayno', { exact: true })).toHaveCount(0);
    await this.expectProjectRowLayout('PNG paste and session search · Interactive demo');
    await this.activate(this.archiveToggle());
    await expect(this.archiveToggle()).toHaveAttribute('aria-pressed', 'true');
    await expect(this.sessionList()).toBeVisible();
    await expect(this.sessionRow('PNG paste · Archived example')).toBeVisible();
    await expect(this.sessionRow('PNG paste · Archived example').getByText('rayno', { exact: true })).toHaveCount(0);
    await this.expectProjectRowLayout('PNG paste · Archived example');
    await this.activate(this.archiveToggle());
    await this.activate(this.sessionList().getByRole('button', { name: 'Flat', exact: true }));
    await expect(this.sessionRow('PNG paste and session search · Interactive demo').getByText('rayno', { exact: true })).toBeVisible();
    await this.closeSessionSearch();
    await expect(this.sessionList().getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
    await this.activate(this.sessionRow('PNG paste and session search · Interactive demo'));
  }
  async exerciseNewSessionPaste() {
    await this.page.goto('/new?demo=1');
    await expect(this.prompt()).toBeVisible();
    expect(await this.pasteImage(this.prompt(), true)).toBe(true);
    const remove = this.page.getByRole('button', { name: 'Remove pasted.png', exact: true });
    await remove.scrollIntoViewIfNeeded();
    await this.expectTouchTarget(remove);
    await this.activate(remove);
    await expect(remove).toHaveCount(0);
    await this.pasteImage(this.prompt());
    await this.start().scrollIntoViewIfNeeded();
    await this.activate(this.start());
    await expect(this.message()).toBeVisible();
    await expect.poll(() => this.page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
      return state.sessions.some((session: { messages: { attachments?: { name: string }[] }[] }) =>
        session.messages.some(m => m.attachments?.some(a => a.name === 'pasted.png')));
    })).toBe(true);
  }
}
