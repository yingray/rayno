import { expect, type Locator } from '@playwright/test';
import { LiveWorkspacePage } from './LiveWorkspacePage';

export class GoalProgressPage extends LiveWorkspacePage {
  async openGoalChat() {
    await this.page.goto('/session/real-session');
    await expect(this.page.getByText('I updated the todo list.', { exact: true })).toBeVisible();
  }
  dock() { return this.page.getByRole('group', { name: 'Session progress', exact: true }); }
  goal(text: string, progress = '') {
    return this.dock().getByRole('button', { name: `Current goal${progress ? `, ${progress}` : ''}: ${text}`, exact: true });
  }
  goalAction(name: 'Edit goal' | 'Clear goal') { return this.dock().getByRole('button', { name, exact: true }); }
  todoChip(done: number, total: number) {
    return this.dock().getByRole('button', { name: `Todo list: ${done} of ${total} tasks done`, exact: true });
  }
  dialog(name: string) { return this.page.getByRole('dialog', { name, exact: true }); }
  async press(control: Locator, touch: boolean) {
    await expect(control).toBeVisible();
    if (touch) await control.tap(); else await control.click();
  }
  // Every changed phone control stays inside the viewport with a 44px target.
  async expectReachable(control: Locator, touch: boolean) {
    // The dialog scales in. Measure after its animation ends.
    await control.evaluate(element => Promise.all(element.closest('[role="dialog"]')?.getAnimations().map(animation => animation.finished) || []));
    const bounds = (await control.boundingBox())!;
    const viewport = this.page.viewportSize()!;
    if (touch || viewport.width < 768) {
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  }
  // The dock sits directly above the composer and leaves the message field usable.
  async expectDockAboveComposer() {
    const dock = (await this.dock().boundingBox())!;
    const field = (await this.page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(field.y);
    expect(field.y + field.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
  }
  async editGoal(text: string, touch: boolean) {
    await this.press(this.goalAction('Edit goal'), touch);
    const field = this.dialog('Edit goal').getByRole('textbox', { name: 'Goal', exact: true });
    await field.fill(text);
    await this.press(this.dialog('Edit goal').getByRole('button', { name: 'Save', exact: true }), touch);
  }
}
