import { expect, test, type Locator } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';

const reply = (message: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message } } });
const long = Array.from({ length: 24 }, (_, index) => `Section ${index + 1}. ${'Detailed explanation. '.repeat(12)}`).join('\n\n');

class ResponseDotsPage extends PriorityFeaturesPage {
  rail() { return this.page.getByRole('navigation', { name: 'Agent replies', exact: true }); }
  pin(index: number) { return this.rail().getByRole('button', { name: `Jump to reply ${index}`, exact: true }); }
  article(index: number) { return this.page.locator(`article[data-message-id="fixture-${index + 1}"]`); }
  anchors() { return this.rail().getByRole('group', { name: 'Reply anchors', exact: true }); }
  async expectRailProgress(progress: number) {
    // A user scroll cancels an active restoration after an older page loads.
    await this.conversation().dispatchEvent('touchmove');
    await this.conversation().evaluate((element, fraction) => {
      element.scrollTop = fraction * (element.scrollHeight - element.clientHeight);
    }, progress);
    await expect.poll(() => this.anchors().evaluate((element, fraction) =>
      Math.abs(element.scrollTop - fraction * (element.scrollHeight - element.clientHeight)), progress)).toBeLessThan(2);
  }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
}

test('reply anchors should fit all loaded replies when possible and retain sized empty dots', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([{ role: 'user', content: { type: 'text', text: 'Read the replies' } }, reply('A short reply.'), reply('中'.repeat(600)), reply(long)]);
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = new ResponseDotsPage(page); await page.goto('/session/real-session');
  await expect(view.rail().getByRole('button')).toHaveText(['', '', '']);
  for (const [index, size, pixels] of [[1, 'small', 6], [2, 'medium', 10], [3, 'large', 14]] as const) {
    await expect(view.pin(index)).toHaveAttribute('data-size', size);
    await expect(view.pin(index).locator('span')).toHaveCSS('width', `${pixels}px`);
    await expect(view.pin(index).locator('span')).toHaveCSS('height', `${pixels}px`);
  }
  await expect.poll(() => view.anchors().evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  for (const progress of [0, 0.5, 1]) {
    await view.expectRailProgress(progress);
    for (const index of [1, 2, 3]) await expect(view.pin(index)).toBeInViewport();
  }
  await view.activate(view.pin(2));
  await expect(view.article(2)).toHaveClass(/flash/);
  await expect(view.pin(2)).toHaveAttribute('aria-current', 'location');
  await view.expectNoPageOverflow();
  await view.capture(`${info.project.name}-response-dots`);
});

test('dense dots should scroll independently and follow chat progress through the latest bottom', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([reply('Previously unloaded response.'), ...Array.from({ length: 18 }, (_, index) => reply(`Reply ${index + 1}.\n\n${long}`))]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = new ResponseDotsPage(page); await page.goto('/session/real-session');
  await expect(view.rail().getByRole('button')).toHaveCount(18);
  await expect.poll(() => view.anchors().evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  for (const progress of [0, 0.5, 1]) await view.expectRailProgress(progress);
  await expect(view.pin(18)).toBeInViewport();
  const chatTop = await view.conversation().evaluate(element => element.scrollTop);
  await view.anchors().evaluate(element => { element.scrollTop = 0; });
  await expect(view.pin(1)).toBeInViewport();
  await expect.poll(() => view.conversation().evaluate(element => element.scrollTop)).toBe(chatTop);
  for (const index of [1, 9, 18]) {
    await view.activate(view.pin(index));
    await expect(view.article(index)).toHaveClass(/flash/);
    await expect(view.pin(index)).toHaveAttribute('aria-current', 'location');
    if (info.project.use.hasTouch) {
      const hit = await view.pin(index).evaluate(element => {
        const box = element.getBoundingClientRect(), before = getComputedStyle(element, '::before');
        return { width: box.width - parseFloat(before.left) - parseFloat(before.right), height: box.height - parseFloat(before.top) - parseFloat(before.bottom) };
      });
      expect(hit.width).toBeGreaterThanOrEqual(44); expect(hit.height).toBeGreaterThanOrEqual(44);
    }
  }
  await view.loadEarlier();
  await expect(view.rail().getByRole('button')).toHaveCount(19);
  await view.expectRailProgress(0);
  await expect(view.pin(1)).toBeInViewport();
  await view.expectRailProgress(1);
  await expect(view.pin(19)).toBeInViewport();
  await view.activate(view.pin(19));
  await expect(view.article(18)).toHaveClass(/flash/);
  await view.expectNoPageOverflow();
});

test('a live reply should place its anchor without one list query for each loaded reply', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([reply('Previously unloaded response.'), ...Array.from({ length: 18 }, (_, index) => reply(`Reply ${index + 1}.`))]);
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 600 } : { width: 1440, height: 900 });
  await page.addInitScript(() => {
    const counts = { replyQueries: 0 };
    (window as unknown as { railCounts: typeof counts }).railCounts = counts;
    const query = Element.prototype.querySelector;
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector.startsWith('[data-message-id=')) counts.replyQueries++;
      return query.call(this, selector);
    } as typeof query;
  });
  const view = new ResponseDotsPage(page); await page.goto('/session/real-session');
  await expect(view.rail().getByRole('button')).toHaveCount(18);
  await page.evaluate(() => { (window as unknown as { railCounts: { replyQueries: number } }).railCounts.replyQueries = 0; });
  // Act
  await server.pushReply('Reply 19.');
  // Assert
  await expect(view.rail().getByRole('button')).toHaveCount(19);
  await expect(view.pin(19)).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as { railCounts: { replyQueries: number } }).railCounts.replyQueries)).toBeLessThan(18);
  await view.activate(view.pin(19));
  await expect(view.page.locator('article[data-message-id]').last()).toHaveClass(/flash/);
});

test('phone layouts should keep chat actions usable without the desktop reading rail', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  const view = new ResponseDotsPage(page);
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360]]) {
    await page.setViewportSize({ width, height }); await page.goto('/session/real-session');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(view.rail()).toHaveCount(0);
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(`Phone reply at ${width}x${height}`);
    await expect(input).toHaveCSS('font-size', '16px');
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await view.expectTouchTarget(send); await view.activate(send); await expect(input).toHaveValue('');
    await view.expectNoPageOverflow();
  }
  expect(server.sends).toHaveLength(5);
});
