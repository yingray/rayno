import { expect, test } from '@playwright/test';
import type { ChatWidth } from '../src/data/types';
import { HappyServer } from './fixtures/HappyServer';
import { ChatAppearancePage } from './pages/ChatAppearancePage';

for (const mode of ['live', 'demo']) {
  test(`chat width should default to moderate and save all three choices in ${mode} mode`, async ({ page }, testInfo) => {
    // Arrange
    if (mode === 'live') await new HappyServer().install(page);
    else await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
    const workspace = new ChatAppearancePage(page);
    const session = mode === 'live' ? 'real-session' : 'floating-panels';
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/settings/appearance');
    await expect(workspace.chatWidth()).toHaveValue('medium');
    // Act / Assert
    for (const value of ['full', 'standard', 'medium'] as ChatWidth[]) {
      await workspace.chooseChatWidth(value);
      await page.goto(`/session/${session}`);
      await workspace.expectWidth(value);
      await workspace.input().fill('Keep this draft after a width change');
      await page.reload();
      await workspace.expectWidth(value);
      await expect(workspace.input()).toHaveValue('Keep this draft after a width change');
      await page.goto('/settings/appearance');
      await expect(workspace.chatWidth()).toHaveValue(value);
    }
    await page.goto(`/session/${session}`);
    await workspace.expectWidth('medium');
    await workspace.capture(`${testInfo.project.name}-${mode}-moderate-chat`);
  });
}

test('chat width choices and the composer should remain usable at phone, keyboard, and landscape sizes', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page); await server.setWorking(false);
  server.sessions[0].agentState = null;
  const workspace = new ChatAppearancePage(page);
  // Act / Assert
  for (const [index, [width, height]] of [[320, 640], [360, 740], [390, 844], [430, 932], [360, 350], [844, 390]].entries()) {
    await page.setViewportSize({ width, height });
    const value = (['standard', 'full', 'medium'] as ChatWidth[])[index % 3];
    await workspace.chooseChatWidth(value);
    await workspace.expectWidthControlUsable();
    if (index === 0) await workspace.capture(`${testInfo.project.name}-chat-width-settings-320`);
    await workspace.openSession();
    await workspace.expectWidth(value);
    await workspace.input().fill(`Message at ${width} by ${height}`);
    await workspace.input().focus();
    const send = workspace.chat().getByRole('button', { name: 'Send message', exact: true });
    if (width < 768 || testInfo.project.name.startsWith('mobile')) await workspace.expectTouchTarget(send);
    const box = (await send.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await send.click();
    await workspace.expectDraft('');
    await workspace.capture(`${testInfo.project.name}-chat-width-${width}-${height}`);
  }
  expect(server.sends).toHaveLength(6);
});
