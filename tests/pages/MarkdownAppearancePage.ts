import { expect, type Locator } from '@playwright/test';
import { ChatAppearancePage } from './ChatAppearancePage';
import { markdownBackgroundThemes, markdownElements, markdownTextThemes, type MarkdownAppearancePreferences } from '../../src/data/markdownAppearance';

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
      await this.activate(this.textChoice(element.label).getByRole('button', { name: text.label, exact: true }));
      await this.activate(this.backgroundChoice(element.label).getByRole('button', { name: background.label, exact: true }));
    }
  }
  async expectChoices(themes: MarkdownAppearancePreferences) {
    for (const element of markdownElements) {
      const text = markdownTextThemes.find(theme => theme.value === themes[element.textKey])!;
      const background = markdownBackgroundThemes.find(theme => theme.value === themes[element.backgroundKey])!;
      for (const [group, label] of [[this.textChoice(element.label), text.label], [this.backgroundChoice(element.label), background.label]] as const) {
        await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);
      }
    }
    await expect(this.page.locator('input[type="color"]')).toHaveCount(0);
  }
  async expectColors(content: Locator, themes: MarkdownAppearancePreferences) {
    const rgb = (color: string) => color === 'transparent' ? 'rgba(0, 0, 0, 0)' : `rgb(${[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(', ')})`;
    for (const element of markdownElements) {
      const foreground = markdownTextThemes.find(theme => theme.value === themes[element.textKey])!;
      const background = markdownBackgroundThemes.find(theme => theme.value === themes[element.backgroundKey])!;
      const target = element.value === 'bold' ? content.locator('strong').first() : element.value === 'quote'
        ? content.locator('blockquote').first() : content.getByRole('link', { name: 'sample link', exact: true });
      await expect(target).toHaveCSS('color', rgb(foreground.color || element.originalColor));
      await expect(target).toHaveCSS('background-color', rgb(background.color));
      if (element.value === 'quote') await expect(target).toHaveCSS('border-left-color', rgb(foreground.color || element.originalColor));
    }
    await expect(content).toHaveCSS('color', 'rgb(212, 212, 216)');
    await expect(content.locator('code').filter({ hasText: /^inline code$/ })).toHaveCSS('color', 'rgb(0, 188, 125)');
    await expect(content.getByRole('heading', { level: 1 })).toHaveCSS('margin-top', '36px');
    await expect(content.getByRole('heading', { level: 2 })).toHaveCSS('margin-top', '32px');
    await expect(content.getByRole('heading', { level: 3 })).toHaveCSS('margin-top', '28px');
  }
  async expectControlsUsable() {
    await this.page.keyboard.press('Tab');
    for (const element of markdownElements) for (const group of [this.textChoice(element.label), this.backgroundChoice(element.label)]) for (const control of await group.getByRole('button').all()) {
      await control.scrollIntoViewIfNeeded();
      await this.expectTouchTarget(control);
      await control.focus();
      await expect(control).toHaveCSS('outline-style', 'none');
      await expect(control.locator('span')).toHaveCSS('outline-width', '1px');
      await expect(control.locator('span')).toHaveCSS('width', '20px');
      await expect(control).toHaveCSS('box-shadow', 'none');
      const box = (await control.boundingBox())!, viewport = this.page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }
    await this.expectNoPageOverflow();
  }
}
