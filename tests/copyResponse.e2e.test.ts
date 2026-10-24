import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { CopyResponsePage } from './pages/CopyResponsePage';

const first = 'From the real protocol\n\n**Keep Markdown** and `inline code`.\n\n```ts\nconst ready = true;\n```';
const recap = '<rayno-recap>The reply keeps <point quote="Keep Markdown">Markdown</point> and code.</rayno-recap>';
const second = 'Choose the next step.';
const options = '<options><option>Continue</option><option>Wait</option></options>';
const reply = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
async function arrange(server: HappyServer) {
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Show two responses' } },
    reply(first + '\n\n' + recap),
    { role: 'user', content: { type: 'text', text: 'What comes next?' } },
    reply(second + '\n\n' + options),
  ]);
}

test('response copy should copy only the selected reply and preserve Markdown without recap or option tags', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await arrange(server);
  const view = new CopyResponsePage(page);
  await view.stubClipboard();
  await view.openSession();
  const touch = !!info.project.use.hasTouch;
  // Act
  await view.copy('From the real protocol', touch);
  // Assert
  await expect.poll(() => view.copiedText()).toBe(first);
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
  await expect(view.responses().getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(2);
  await expect(page.locator('article[data-role="user"]').getByRole('button', { name: 'Copy response' })).toHaveCount(0);
  // Act
  const button = view.copyButton(second);
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await page.keyboard.press('Enter');
  // Assert
  await expect.poll(() => view.copiedText()).toBe(second + '\n\n- Continue\n- Wait');
});

test('response copy should stay reachable by touch at phone widths and short landscape viewports', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await arrange(server);
  const view = new CopyResponsePage(page);
  await view.stubClipboard();
  await view.openSession();
  test.setTimeout(60000);
  // Act / Assert
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await view.copy('From the real protocol', !!info.project.use.hasTouch);
    await expect.poll(() => view.copiedText()).toBe(first);
    await view.copy(second, !!info.project.use.hasTouch);
    await expect.poll(() => view.copiedText()).toContain('- Continue');
    await view.expectNoPageOverflow();
    if (width === 320 || width === 844) await view.capture(`${info.project.name}-response-copy-${width}`);
  }
});

test('response copy should report denied clipboard access and keep the reply readable', async ({ page }, info) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await arrange(server);
  const view = new CopyResponsePage(page);
  await view.stubClipboard(true);
  await view.openSession();
  // Act
  await view.copy('From the real protocol', !!info.project.use.hasTouch);
  // Assert
  await expect(page.getByRole('status').filter({ hasText: 'Could not copy. Check clipboard access in your browser.' })).toBeVisible();
  await expect(view.copyButton('From the real protocol')).toBeEnabled();
  expect(await view.copiedText()).toBeUndefined();
});
