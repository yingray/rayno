import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { TerminalControlPage } from './pages/TerminalControlPage';

// happy-cli claude/runClaude.ts writes { ...state, controlledByUser: mode === 'local' } and a switch event on each mode change.
const localMode = { controlledByUser: true, requests: {} };
const remoteMode = { controlledByUser: false, requests: {} };
const switchEvent = (mode: 'local' | 'remote') => ({ role: 'agent', content: { id: `switch-${mode}`, type: 'event', data: { type: 'switch', mode } } });

for (const [width, height] of [[320, 740], [360, 740], [390, 360], [430, 844], [844, 390]]) {
  test(`Take control should send one switch request and follow the CLI mode at ${width}x${height}`, async ({ page }, testInfo) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const server = new HappyServer();
    await server.install(page);
    await server.updateAgentState(localMode);
    const view = new TerminalControlPage(page);
    await view.openSession();
    await view.expectConnected();
    await view.expectTerminalControl(true);
    await view.expectReachable(view.takeControlButton());
    await view.expectNoPageOverflow();
    await view.capture(`${testInfo.project.name}-terminal-control-${width}x${height}`);
    // Act
    await view.press(view.takeControlButton(), !!testInfo.project.use.hasTouch);
    // Assert
    await expect.poll(() => server.switchRequests).toEqual([{ to: 'remote' }]);
    await expect(view.notice()).toContainText('Waiting for the terminal…');
    await expect(view.takeControlButton()).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Act
    await server.pushEvent(switchEvent('remote'));
    await server.updateAgentState(remoteMode);
    // Assert
    await view.expectTerminalControl(false);
    await expect(page.getByText('Ready when you are', { exact: true })).toBeVisible();
    expect(server.switchRequests).toHaveLength(1);
    await view.expectNoPageOverflow();
    // Act: a double space in the terminal (claudeRemoteLauncher.ts) gives control back.
    await server.pushEvent(switchEvent('local'));
    await server.updateAgentState(localMode);
    // Assert
    await view.expectTerminalControl(true);
    await expect(view.takeControlButton()).toBeEnabled();
  });
}

test('a message sent while the terminal controls the session should go out without a switch request', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateAgentState(localMode);
  const view = new TerminalControlPage(page);
  await view.openSession();
  await view.expectConnected();
  if (testInfo.project.name.startsWith('mobile')) await page.setViewportSize({ width: 390, height: 360 });
  await view.message().focus();
  await view.message().fill('Continue from the phone');
  // Assert: a short keyboard viewport keeps the field, Send, and Take control reachable.
  await expect(view.message()).toBeInViewport();
  await view.expectReachable(view.takeControlButton());
  // Rayno sizes Send to 44px only for coarse pointers.
  if (testInfo.project.use.hasTouch) await view.expectReachable(page.getByRole('button', { name: 'Send message', exact: true }));
  else await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
  await view.expectNoPageOverflow();
  // Act: claudeLocalLauncher.ts switches to remote mode when a message arrives in its queue.
  await view.press(page.getByRole('button', { name: 'Send message', exact: true }), !!testInfo.project.use.hasTouch);
  // Assert
  await view.expectDraft('');
  expect(server.sends).toHaveLength(1);
  expect(server.switchRequests).toEqual([]);
  // Act
  await server.updateAgentState(remoteMode);
  // Assert
  await view.expectTerminalControl(false);
});

test('a failed switch request should show the encrypted error and allow a retry', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.switchReply = { error: 'The terminal is busy.' };
  await server.install(page);
  await server.updateAgentState(localMode);
  const view = new TerminalControlPage(page);
  await view.openSession();
  await view.expectConnected();
  // Act
  await view.takeControlButton().click();
  // Assert
  await expect(view.notice().getByRole('alert')).toHaveText('The terminal is busy.');
  await expect(view.takeControlButton()).toBeEnabled();
  // Act
  server.switchReply = undefined;
  await view.takeControlButton().click();
  // Assert
  await expect.poll(() => server.switchRequests).toHaveLength(2);
  await expect(view.notice().getByRole('alert')).toHaveCount(0);
});

test('session info should show terminal control and take control', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateAgentState(localMode);
  const view = new TerminalControlPage(page);
  await view.openSession();
  await view.expectConnected();
  await view.info();
  const details = page.getByRole('region', { name: 'Session details', exact: true }).last();
  await expect(details).toContainText('· Terminal control');
  const action = details.getByRole('button', { name: /^Take control/ });
  await view.expectReachable(action);
  // Act
  await view.press(action, !!testInfo.project.use.hasTouch);
  // Assert
  await expect.poll(() => server.switchRequests).toEqual([{ to: 'remote' }]);
  await expect(page.getByText('Rayno asked the terminal to hand over control.')).toBeVisible();
  // Act
  await server.updateAgentState(remoteMode);
  // Assert
  await expect(action).toHaveCount(0);
  await expect(details).not.toContainText('Terminal control');
  await view.expectNoPageOverflow();
});

test('Happy Agent and disconnected sessions should not show terminal control', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.updateAgentState(localMode);
  await server.updateMetadata({ flavor: 'rig', client: { id: 'rig' } });
  const view = new TerminalControlPage(page);
  await view.openSession();
  await view.expectConnected();
  // Assert: the Rig CLI has no terminal mode, so a stray flag does not lock the chat to a terminal.
  await expect(view.notice()).toHaveCount(0);
  await expect(page.getByText('The terminal controls this session', { exact: true })).toHaveCount(0);
  await expect(view.message()).not.toHaveAttribute('placeholder', 'Send a message to take control…');
  // Act
  await server.updateMetadata({ flavor: 'claude', client: undefined });
  await view.page.reload();
  await view.expectConnected();
  await view.expectTerminalControl(true);
  server.setSessionActive('real-session', false);
  // Assert
  await expect(view.notice()).toHaveCount(0);
  await expect(page.getByText('The terminal controls this session', { exact: true })).toHaveCount(0);
});
