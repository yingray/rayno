import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';

const reply = (message: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message } } });
const firstTime = 1700000001234;

class ResponseHeadersPage extends PriorityFeaturesPage {
  headers() { return this.page.locator('[data-response-header]'); }
  async expectHeaderLayout() {
    const header = this.headers().last();
    await header.scrollIntoViewIfNeeded();
    const line = header.getByRole('separator');
    await expect(line).toHaveCSS('height', '1px');
    const lineBox = (await line.boundingBox())!, dateBox = (await header.locator('time').boundingBox())!;
    expect(lineBox.width).toBeGreaterThanOrEqual(16);
    expect(lineBox.x + lineBox.width).toBeLessThan(dateBox.x);
    expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
    await this.expectNoPageOverflow();
  }
}

test('each formal response should start with a divider and its original local date and time across reloads', async ({ page }) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Check these replies' } },
    reply('First dated response'),
    { role: 'agent', content: { type: 'codex', data: { type: 'thinking', text: 'Internal reasoning' } } },
    { role: 'session', content: { role: 'agent', turn: 'tool-turn', ev: { t: 'tool-call-start', call: 'read', name: 'Read', args: { file: 'README.md' } } } },
    reply('Second dated response'),
  ]);
  server.messages.forEach((message, index) => { message.createdAt = firstTime + index * 60000; });
  const view = new ResponseHeadersPage(page);
  await page.goto('/session/real-session');
  await expect(view.headers()).toHaveCount(2);
  const time = view.headers().first().locator('time');
  const expected = new Date(firstTime + 60000).toISOString();
  await expect(time).toHaveAttribute('datetime', expected);
  const local = await page.evaluate(at => new Date(at).toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }), firstTime + 60000);
  await expect(time).toHaveText(local);
  expect(await view.headers().first().evaluate(header => header.parentElement?.firstElementChild === header)).toBe(true);
  await expect(page.locator('[data-role="user"] [data-response-header], [data-tool-activity] [data-response-header]')).toHaveCount(0);
  await page.reload();
  await expect(view.headers()).toHaveCount(2);
  await expect(time).toHaveAttribute('datetime', expected);
  await view.expectHeaderLayout();
  await page.goto('/settings/advanced');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-TW');
  await page.goto('/session/real-session');
  const chinese = await page.evaluate(at => new Date(at).toLocaleString('zh-TW', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }), firstTime + 60000);
  await expect(time).toHaveText(chinese);
  await view.expectHeaderLayout();
});

test('response dates and the composer should remain usable at phone, keyboard, landscape, and desktop sizes', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  await server.setMessages([reply('A formal response with a date and divider.')]);
  const view = new ResponseHeadersPage(page);
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/session/real-session');
    await expect(view.headers()).toHaveCount(1);
    await view.expectHeaderLayout();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(`Reply at ${width}x${height}`);
    await input.focus();
    if (width < 768) await expect(input).toHaveCSS('font-size', '16px');
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    if (width < 768 || info.project.use.hasTouch) await view.expectTouchTarget(send);
    if (info.project.use.hasTouch) await send.tap(); else await send.click();
    await expect(input).toHaveValue('');
    await expect.poll(() => server.sends.length).toBeGreaterThan(0);
    if (width === 390 && height === 844) await view.capture(`${info.project.name}-response-header-390`);
    await view.expectNoPageOverflow();
  }
  expect(server.sends).toHaveLength(7);
});
