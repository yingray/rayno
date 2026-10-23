import { expect, test, type Locator } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';

const reply = (message: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message } } });
const long = Array.from({ length: 24 }, (_, index) => `Section ${index + 1}. ${'Detailed explanation. '.repeat(12)}`).join('\n\n');

class ResponseDotsPage extends PriorityFeaturesPage {
  rail() { return this.page.getByRole('navigation', { name: 'Agent replies', exact: true }); }
  pin(index: number) { return this.rail().getByRole('button', { name: `Jump to reply ${index}`, exact: true }); }
  article(index: number) { return this.page.locator(`article[data-message-id="fixture-${index + 1}"]`); }
  async align(index: number) {
    await this.article(index).evaluate(element => {
      const scroll = element.closest('[aria-label="Conversation messages"]')!;
      const offset = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      scroll.scrollTop = offset - 150;
    });
    await expect.poll(async () => {
      const pin = (await this.pin(index).boundingBox())!, article = (await this.article(index).boundingBox())!;
      return Math.abs(pin.y + pin.height / 2 - article.y);
    }).toBeLessThan(2);
  }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
}

test('reply anchors should be empty dots sized by reply length and move with the visible reply starts', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([{ role: 'user', content: { type: 'text', text: 'Read the replies' } }, reply('A short reply.'), reply('中'.repeat(600)), reply(long)]);
  await page.setViewportSize(info.project.use.isMobile ? { width: 844, height: 390 } : { width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = new ResponseDotsPage(page); await page.goto('/session/real-session');
  await expect(view.rail().getByRole('button')).toHaveText(['', '', '']);
  for (const [index, size, pixels] of [[1, 'small', 6], [2, 'medium', 10], [3, 'large', 14]] as const) {
    await expect(view.pin(index)).toHaveAttribute('data-size', size);
    await expect(view.pin(index).locator('span')).toHaveCSS('width', `${pixels}px`);
    await expect(view.pin(index).locator('span')).toHaveCSS('height', `${pixels}px`);
  }
  await view.align(3);
  const before = (await view.pin(3).boundingBox())!.y;
  await view.conversation().evaluate(element => { element.scrollTop += 40; });
  await expect.poll(async () => before - (await view.pin(3).boundingBox())!.y).toBeGreaterThan(38);
  await expect.poll(async () => {
    const pin = (await view.pin(3).boundingBox())!, article = (await view.article(3).boundingBox())!;
    return Math.abs(pin.y + pin.height / 2 - article.y);
  }).toBeLessThan(2);
  await view.activate(view.pin(2));
  await expect(view.article(2)).toHaveClass(/flash/);
  await expect(view.pin(2)).toHaveAttribute('aria-current', 'location');
  await view.expectNoPageOverflow();
  await view.capture(`${info.project.name}-response-dots`);
});

test('dense touch dots should retain independent targets and rail navigation should move the chat', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([{ role: 'user', content: { type: 'text', text: 'Read all replies' } }, ...Array.from({ length: 18 }, (_, index) => reply(`Reply ${index + 1}.\n\n${long}`))]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const view = new ResponseDotsPage(page); await page.goto('/session/real-session');
  await expect(view.rail().getByRole('button')).toHaveCount(18);
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
  await view.expectNoPageOverflow();
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
