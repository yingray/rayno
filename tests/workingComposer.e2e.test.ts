import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import { WorkspacePage } from './pages/WorkspacePage';

for (const [width, height] of [[320, 740], [360, 740], [390, 360], [430, 844], [844, 390]]) {
  test(`send during work then Stop should accept an empty CLI reply at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const server = new HappyServer();
    await server.install(page);
    await server.setWorking(true);
    const workspace = new LiveWorkspacePage(page);
    await workspace.openSession();
    await workspace.expectConnected();
    // Act
    await workspace.send('Add this instruction while you work');
    await workspace.expectDraft('');
    const stop = page.getByRole('button', { name: 'Stop response', exact: true });
    await expect(stop).toBeEnabled();
    const bounds = (await stop.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await workspace.capture(`${testInfo.project.name}-stop-${width}x${height}`);
    if (testInfo.project.use.hasTouch) await stop.tap();
    else await stop.click();
    // Assert
    await expect.poll(() => server.mutations.filter((method) => method.endsWith(':abort'))).toHaveLength(1);
    await expect(stop).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await server.setWorking(false);
    await expect(stop).toHaveCount(0);
    await workspace.send('Continue after Stop');
    await workspace.expectDraft('');
    expect(server.sends).toHaveLength(2);
    await workspace.expectNoPageOverflow();
  });
}

test('Stop should show an encrypted handler error', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  server.abortReply = { error: 'The agent could not stop.' };
  await server.setWorking(true);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  // Assert
  await expect(page.getByRole('alert')).toContainText('The agent could not stop.');
});

test('working agents should accept button, Enter, and option sends without an abort RPC', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(true);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  const stop = page.getByRole('button', { name: 'Stop response', exact: true });
  await expect(stop).toBeVisible();
  await expect(send).toBeDisabled();
  // Act
  await workspace.send('Add this instruction while you work');
  await workspace.expectDraft('');
  if (testInfo.project.use.hasTouch) await workspace.send('Also keep the original task');
  else await workspace.sendWithEnter('Also keep the original task');
  await workspace.expectDraft('');
  await server.pushReply('Choose the next step.\n\n<options><option>繼續檢查 ✓</option></options>');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unfinished draft');
  await workspace.selectReply('繼續檢查 ✓');
  // Assert
  await expect(workspace.replyOptions().getByRole('button')).toBeDisabled();
  await workspace.expectDraft('Keep this unfinished draft');
  await expect(page.getByText('Claude is working', { exact: true })).toBeVisible();
  expect(server.mutations.filter((method) => method.endsWith(':abort'))).toEqual([]);
  const messages = await Promise.all(server.sends.map((packet) =>
    server.encryption.decrypt<{ content: { text: string } }>(packet.content, server.dataKey),
  ));
  expect(messages.map((message) => message.content.text)).toEqual([
    'Add this instruction while you work', 'Also keep the original task', '繼續檢查 ✓',
  ]);
  await expect(send).toBeEnabled();
  await expect(stop).toBeEnabled();
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-working-composer`);
  // Act
  await stop.click();
  await expect.poll(() => server.mutations.filter((method) => method.endsWith(':abort'))).toEqual(['real-session:abort']);
  await server.setWorking(false);
  // Assert
  await expect(stop).toHaveCount(0);
  await expect(send).toBeEnabled();
  await workspace.expectDraft('Keep this unfinished draft');
  expect(server.sends).toHaveLength(3);
});

test('a failed send during work should retain the draft and retry the same packet without stopping the agent', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.failFirstSend = true;
  await server.install(page);
  await server.setWorking(true);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  // Act
  await workspace.send('Keep this queued instruction');
  await expect(page.getByRole('alert')).toContainText('confirmation lost');
  await workspace.expectDraft('Keep this queued instruction');
  await workspace.retrySend();
  // Assert
  await workspace.expectDraft('');
  expect(server.sends).toHaveLength(2);
  expect(server.sends[1]).toEqual(server.sends[0]);
  expect(server.mutations.filter((method) => method.endsWith(':abort'))).toEqual([]);
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
  await expect(page.getByText('Claude is working', { exact: true })).toBeVisible();
});

test('the local demo should accept another instruction during a simulated response', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
  const workspace = new WorkspacePage(page);
  await workspace.open();
  await workspace.create('Prepare the first draft');
  // Act
  await workspace.send('Add another instruction');
  // Assert
  await expect(page.getByText('Add another instruction', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await expect(page.getByText('This is a simulated response', { exact: false })).toBeVisible();
  const quote = page.locator('blockquote');
  await expect(quote).toContainText('Prepare the first draft');
  await expect(quote).toContainText('Add another instruction');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
});
