import { expect, type Locator } from '@playwright/test';
import { ChatAppearancePage } from './ChatAppearancePage';
import { markdownBackgroundThemes, markdownElements, markdownTextThemes, type MarkdownAppearancePreferences } from '../../src/data/markdownAppearance';

const shadeLabel = (theme: { label: string; shade: number | null }) => `${theme.label}${theme.shade === null ? '' : ` ${theme.shade}`}`;

export class MarkdownAppearancePage extends ChatAppearancePage {
  textChoice(label: string) { return this.page.getByRole('group', { name: `${label} text color`, exact: true }); }
  backgroundChoice(label: string) { return this.page.getByRole('group', { name: `${label} background`, exact: true }); }
  preview() { return this.page.getByRole('region', { name: 'Markdown preview', exact: true }).locator('[data-markdown-preview]'); }
  sample() { return this.chat().locator('[data-markdown-content]').filter({ has: this.page.getByRole('heading', { name: 'A little room to read', exact: true }) }).first(); }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async openDemo() {
    await this.page.goto('/session/markdown-appearance-demo?demo=1');
    await expect(this.sample()).toBeVisible();
  }
  async openDemoSettings() {
    await this.activate(this.page.getByRole('button', { name: 'Appearance settings', exact: true }));
    await expect(this.page).toHaveURL(/\/settings\/appearance\?demo=1#markdown$/);
    await expect(this.preview()).toBeVisible();
  }
  async returnToDemo() {
    await this.activate(this.page.getByRole('button', { name: 'Open Markdown demo', exact: true }));
    await expect(this.page).toHaveURL(/\/session\/markdown-appearance-demo\?demo=1$/);
    await expect(this.sample()).toBeVisible();
  }
  async choose(themes: MarkdownAppearancePreferences) {
    for (const element of markdownElements) {
      const text = markdownTextThemes.find(theme => theme.value === themes[element.textKey])!;
      const background = markdownBackgroundThemes.find(theme => theme.value === themes[element.backgroundKey])!;
      await this.activate(this.textChoice(element.label).getByRole('button', { name: shadeLabel(text), exact: true }));
      await this.activate(this.backgroundChoice(element.label).getByRole('button', { name: shadeLabel(background), exact: true }));
    }
  }
  async expectChoices(themes: MarkdownAppearancePreferences) {
    for (const element of markdownElements) {
      const text = markdownTextThemes.find(theme => theme.value === themes[element.textKey])!;
      const background = markdownBackgroundThemes.find(theme => theme.value === themes[element.backgroundKey])!;
      for (const [group, label] of [[this.textChoice(element.label), shadeLabel(text)], [this.backgroundChoice(element.label), shadeLabel(background)]] as const) {
        await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);
      }
    }
    await expect(this.page.locator('input[type="color"]')).toHaveCount(0);
  }
  async expectColors(content: Locator, themes: MarkdownAppearancePreferences) {
    const colors = await this.page.evaluate(values => Object.fromEntries(values.map(color => {
      const probe = document.createElement('span');
      probe.style.color = color; document.body.append(probe);
      const result = getComputedStyle(probe).color; probe.remove();
      return [color, result];
    })), [...markdownTextThemes, ...markdownBackgroundThemes].map(theme => theme.color));
    for (const element of markdownElements) {
      const foreground = markdownTextThemes.find(theme => theme.value === themes[element.textKey])!;
      const background = markdownBackgroundThemes.find(theme => theme.value === themes[element.backgroundKey])!;
      const target = element.value === 'bold' ? content.locator('strong').first() : element.value === 'quote'
        ? content.locator('blockquote').first() : content.getByRole('link', { name: 'sample link', exact: true });
      await expect(target).toHaveCSS('color', colors[foreground.color]);
      await expect(target).toHaveCSS('background-color', colors[background.color]);
      if (element.value === 'quote') await expect(target).toHaveCSS('border-left-color', colors[foreground.color]);
    }
    await expect(content).toHaveCSS('color', 'rgb(212, 212, 216)');
    await expect(content.locator('code').filter({ hasText: /^inline code$/ })).toHaveCSS('color', 'rgb(0, 188, 125)');
    await expect(content.getByRole('heading', { level: 1 })).toHaveCSS('margin-top', '36px');
    await expect(content.getByRole('heading', { level: 2 })).toHaveCSS('margin-top', '32px');
    await expect(content.getByRole('heading', { level: 3 })).toHaveCSS('margin-top', '28px');
  }
  async expectControlsUsable() {
    await this.page.keyboard.press('Tab');
    for (const element of markdownElements) for (const [group, count] of [[this.textChoice(element.label), 26], [this.backgroundChoice(element.label), 27]] as const) {
      const buttons = group.getByRole('button');
      await expect(buttons).toHaveCount(count);
      expect(await buttons.evaluateAll(controls => controls.every(control => {
        const box = control.getBoundingClientRect(), dot = control.querySelector('span')!;
        const color = getComputedStyle(dot).backgroundColor;
        return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth
          && getComputedStyle(dot).width === '20px'
          && (control.getAttribute('aria-label') === 'No background' || color.startsWith('oklch('));
      }))).toBe(true);
      for (const index of [0, Math.floor(count / 2), count - 1]) {
        const control = buttons.nth(index);
        await control.scrollIntoViewIfNeeded();
        await control.focus();
        await expect(control).toHaveCSS('outline-style', 'none');
        await expect(control.locator('span')).toHaveCSS('outline-width', '1px');
        await expect(control).toHaveCSS('box-shadow', 'none');
        const box = (await control.boundingBox())!, viewport = this.page.viewportSize()!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(await control.evaluate(element => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
      }
    }
    await this.expectNoPageOverflow();
  }
}
