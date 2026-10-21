import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const userMessage = (text: string, meta: Record<string, unknown>) => ({
  role: 'user',
  content: { type: 'text', text },
  meta: { sentFrom: 'web', ...meta },
});

test('an opened session should show the modes of its last message when metadata reports none', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const source = server.sessions[0];
  const metadata = await server.encryption.decrypt<Record<string, unknown>>(source.metadata, server.dataKey);
  source.metadata = await server.encryption.encrypt({ ...metadata, flavor: 'codex', models: undefined }, server.dataKey);
  await server.setMessages([
    userMessage('Review the repo', { permissionMode: 'yolo', model: 'gpt-6.1-sol', effort: 'xhigh' }),
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'From the real protocol' } } },
  ]);
  const workspace = new LiveWorkspacePage(page);
  const model = page.getByRole('button', { name: 'Model and effort', exact: true });
  // Act
  await workspace.openSession();
  // Assert
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
  await expect(model).toHaveText('GPT-6.1 Sol · xHigh');
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-session-modes`);
  if (testInfo.project.name.startsWith('mobile')) {
    for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await workspace.expectNoPageOverflow();
      await expect(model).toBeInViewport();
      await expect(workspace.permissionMode()).toBeInViewport();
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }

  // Arrange: an older build saved a fallback for this session on every render.
  const sentKey = () => page.evaluate(() => Object.keys(localStorage).find((key) => key.endsWith('.sentModes.real-session')));
  await expect.poll(sentKey).toBeTruthy();
  const prefix = (await sentKey())!.slice(0, -'sentModes.real-session'.length);
  await page.evaluate((prefix) => localStorage.setItem(`${prefix}composerModes.real-session`,
    JSON.stringify({ model: 'gpt-5.6-sol', effort: 'medium', permission: 'default' })), prefix);
  // Act
  await page.reload();
  // Assert
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
  await expect(model).toHaveText('GPT-6.1 Sol · xHigh');

  // Act: an explicit pick outranks the older message.
  await workspace.openModelSettings();
  await workspace.chooseModel('GPT-5.6 Sol');
  await workspace.chooseEffort('Low');
  await workspace.closeModelSettings();
  await page.reload();
  // Assert
  await expect(model).toHaveText('GPT-5.6 Sol · Low');
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');

  // Act: another device sends a newer message with other modes.
  await server.pushEvent(userMessage('Continue on the phone', { permissionMode: 'read-only', model: 'gpt-6-luna', effort: 'high' }),
    'real-session', true, Date.now() + 60000);
  // Assert
  await expect(model).toHaveText('GPT-6 Luna · High');
  await expect(workspace.permissionMode()).toHaveText('Mode: Read');
});
