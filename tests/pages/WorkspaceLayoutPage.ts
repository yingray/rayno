import { expect, type Locator } from '@playwright/test';
import { ResizablePanelsPage } from './ResizablePanelsPage';

export class WorkspaceLayoutPage extends ResizablePanelsPage {
  prompt() { return this.page.getByRole('textbox', { name: 'Task description', exact: true }); }
  start() { return this.page.getByRole('button', { name: 'Start', exact: true }); }
  sessionsToggle() { return this.page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Sessions', exact: true }); }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async openDemo(side = false) {
    await this.page.goto(`/session/workspace-layout-demo${side ? '/side' : ''}?demo=1`);
    await expect(side ? this.panel() : this.mainChat()).toBeVisible();
  }
  async expectSessionsUsable() {
    const list = this.sessionList();
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const control of [list.getByRole('button', { name: 'Collapse session list', exact: true }),
      this.listOptionsButton(), list.getByRole('button', { name: 'New session', exact: true })]) {
      await this.expectInViewport(control);
      const listBox = (await list.boundingBox())!, box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(listBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(listBox.x + listBox.width);
      if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await this.expectTouchTarget(control);
    }
    await this.openListOptions();
    const search = this.listOptions().getByRole('textbox', { name: 'Search sessions', exact: true });
    await search.fill('Workspace layout');
    await expect(this.sessionRow('Workspace layout · Interactive demo')).toBeVisible();
    await search.fill('');
    await this.closeListOptions();
    await this.expectNoPageOverflow();
  }
  async resizeSessionsWithEscape() {
    const control = this.separator('sessions'), box = (await control.boundingBox())!;
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await control.press('Escape');
    await this.page.mouse.up();
    await expect(this.page.locator('html')).not.toHaveAttribute('data-panel-resizing');
  }
  async openNew() { await this.page.goto('/new?demo=1'); await expect(this.prompt()).toBeVisible(); }
  async toggleSessions(visible: boolean) {
    if (await this.sessionsToggle().getAttribute('aria-expanded') !== String(visible)) await this.activate(this.sessionsToggle());
    await expect(this.sessionList())[visible ? 'toBeVisible' : 'toBeHidden']();
    if (await this.separator('side').count()) await expect.poll(async () => {
      const side = await this.panelWidth('side'), main = (await this.mainChat().boundingBox())!.width;
      return Math.abs(await this.limit('side', 'max') - Math.round((side + main) * 0.7));
    }).toBeLessThanOrEqual(2);
  }
  async expectRatio(sideRatio: number) {
    await expect.poll(async () => {
      const side = await this.panelWidth('side'), main = (await this.mainChat().boundingBox())!.width;
      return side / (side + main);
    }).toBeCloseTo(sideRatio, 2);
    await this.expectMainUsable();
    await this.expectComposerFits();
  }
  async exerciseComposer(chat: Locator, message: string) {
    const input = chat.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(message);
    await this.activate(chat.getByRole('button', { name: 'Model and effort', exact: true }));
    const picker = this.page.getByRole('dialog', { name: 'Model & effort', exact: true });
    await expect(picker).toBeVisible();
    await this.activate(picker.getByRole('button', { name: 'Close Model & effort', exact: true }));
    await expect(input).toHaveValue(message);
    await this.activate(chat.getByRole('button', { name: 'Send message', exact: true }));
    await expect(input).toHaveValue('');
    await expect(chat.getByText(message, { exact: true }).last()).toBeVisible();
  }
  async installRenderProbe() {
    await this.page.addInitScript(() => {
      const state = window as unknown as { __renders: Record<string, number>; __renderTypes: Map<unknown, string>; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
      state.__renders = {};
      state.__renderTypes = new Map();
      type Fiber = { flags: number; type?: { name?: string; displayName?: string; type?: { name?: string } }; child?: Fiber; sibling?: Fiber; alternate?: Fiber };
      state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, inject: () => 1, onCommitFiberUnmount() {},
        onCommitFiberRoot(_renderer: number, root: { current: Fiber }) {
          function visit(fiber?: Fiber) {
            if (!fiber) return;
            const name = state.__renderTypes.get(fiber.type);
            if (name && (fiber.flags & 1)) state.__renders[name] = (state.__renders[name] || 0) + 1;
            if (!fiber.alternate || fiber.child !== fiber.alternate.child) visit(fiber.child);
            visit(fiber.sibling);
          }
          visit(root.current);
        },
      };
    });
  }
  async clearRenders() {
    await this.page.evaluate(async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const state = window as unknown as { __renders: Record<string, number>; __renderTypes: Map<unknown, string> };
      // Production bundles rename functions. Label fibers from the actual field and list instead.
      type Fiber = { type: unknown; return?: Fiber };
      function label(element: Element | null, prefix: string) {
        if (!element) return;
        const key = Object.keys(element).find(key => key.startsWith('__reactFiber'))!;
        let fiber = (element as unknown as Record<string, Fiber>)[key];
        let index = 0;
        while (fiber) {
          if (typeof fiber.type === 'function') state.__renderTypes.set(fiber.type, `${prefix}${index++}`);
          fiber = fiber.return!;
        }
      }
      label(document.querySelector('[aria-label="Session list"]'), 'list-');
      label(document.querySelector('textarea[aria-label="Task description"]'), 'prompt-');
      state.__renders = {};
    });
  }
  async renders() { return this.page.evaluate(() => (window as unknown as { __renders: Record<string, number> }).__renders); }
}
