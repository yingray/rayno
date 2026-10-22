import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const choices = '<options> <option>已按下全部 7 個 ✓</option> <option>我找不到 ✓ 按鈕</option> </options>';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
  test(`reply options should render after literal tags and send a reachable choice at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const server = new HappyServer();
    await server.install(page);
    const labels = ['A: TL;DR card in chat', 'B: Session headline in the list', 'C: Both'];
    const reply = [
      'From the real protocol',
      'I recommend A first. It uses the same path that `<options>` uses.',
      '| Topic | Recommendation |\n|---|---|\n| Position | At the end, before `<options>` |',
      'Choose the summary behavior.',
      '<options>\n' + labels.map((label) => `<option>${label}</option>`).join('\n') + '\n</options>',
    ].join('\n\n');
    await server.setMessages([
      { role: 'user', content: { type: 'text', text: 'Let us discuss summaries' } },
      { role: 'agent', content: { type: 'codex', data: { type: 'message', message: reply } } },
    ]);
    const workspace = new LiveWorkspacePage(page);
    await workspace.openSession();
    await expect(workspace.replyOptions().getByRole('button')).toHaveText(labels);
    await expect(workspace.markdownTable()).toContainText('<options>');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my draft');

    // Act
    await workspace.expectReplyTargetsReachable();
    if (testInfo.project.use.hasTouch) await workspace.tapReply(labels[1]);
    else await workspace.selectReply(labels[1]);

    // Assert
    await expect(workspace.replyOptions().getByRole('button').nth(1)).toBeDisabled();
    await workspace.expectDraft('Keep my draft');
    expect(server.sends).toHaveLength(1);
    const raw = await server.encryption.decrypt(server.sends[0].content, server.dataKey);
    expect(raw).toMatchObject({ role: 'user', content: { type: 'text', text: labels[1] } });
    await workspace.expectNoPageOverflow();
  });
}

test('reply options should send the exact encrypted choice, preserve the draft, and deduplicate a retry', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  server.failFirstSend = true;
  await server.install(page);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Show the choices' } },
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message:
      'From the real protocol\n\n請選擇目前的狀態：\n\n' + choices,
    } } },
  ]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  const buttons = workspace.replyOptions().getByRole('button');
  await expect(buttons).toHaveText(['已按下全部 7 個 ✓', '我找不到 ✓ 按鈕']);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my own draft');
  await workspace.capture(`${testInfo.project.name}-reply-options`);
  // Act
  await workspace.selectReply('已按下全部 7 個 ✓');
  await expect(page.getByRole('alert')).toContainText('confirmation lost');
  await workspace.expectDraft('Keep my own draft');
  await workspace.selectReply('已按下全部 7 個 ✓');
  // Assert
  await expect(buttons.nth(0)).toBeDisabled();
  await expect(buttons.nth(1)).toBeDisabled();
  await workspace.expectDraft('Keep my own draft');
  expect(server.sends).toHaveLength(2);
  expect(server.sends[1]).toEqual(server.sends[0]);
  const raw = await server.encryption.decrypt(server.sends[0].content, server.dataKey);
  expect(raw).toMatchObject({ role: 'user', content: { type: 'text', text: '已按下全部 7 個 ✓' } });
  expect(JSON.stringify(raw)).not.toContain('preserveDraft');
  expect(JSON.stringify(server.sends)).not.toContain('已按下全部 7 個 ✓');
  await page.reload();
  await expect(workspace.replyOptions().getByRole('button').nth(0)).toBeDisabled();
  await workspace.expectDraft('Keep my own draft');
  await workspace.expectNoPageOverflow();
});

test('option examples in code should stay literal and archived sessions should not send a choice', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const source = server.sessions[0];
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(source.metadata, server.dataKey);
  source.metadata = await server.encryption.encrypt({ ...metadata, lifecycleState: 'archived' }, server.dataKey);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Show an example' } },
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message:
      'From the real protocol\n\n```xml\n<options><option>Code example</option></options>\n```\n\n' + choices,
    } } },
  ]);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await workspace.openSession();
  // Assert
  await expect(workspace.replyOptions()).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Code example', exact: true })).toHaveCount(0);
  await expect(workspace.codeExample('<options><option>Code example</option></options>')).toBeVisible();
  await expect(workspace.replyOptions().getByRole('button').nth(0)).toBeDisabled();
  expect(server.sends).toEqual([]);
});
