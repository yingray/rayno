import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const agent = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
const icon = (page: import('@playwright/test').Page) => page.locator('link[rel="icon"]');

test('the tab title should count background sessions that need attention and clear after the user views them', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  await expect(page).toHaveTitle('Rayno · Older workspace');
  await expect(icon(page)).toHaveAttribute('href', '/icons/rayno.svg');
  // Act
  await server.pushReply('A finished background reply');
  // Assert
  await expect(page).toHaveTitle('(1) Rayno · Older workspace');
  await expect(icon(page)).toHaveAttribute('href', '/icons/rayno.svg');
  // Act
  await server.updateAgentState({ requests: { ask: { tool: 'Bash', arguments: { command: 'ls' } } } });
  // Assert
  await expect(icon(page)).toHaveAttribute('href', '/icons/rayno-attention.svg');
  await expect(page).toHaveTitle('(1) Rayno · Older workspace');
  // Act
  await page.reload();
  // Assert
  await expect(page).toHaveTitle('(1) Rayno · Older workspace');
  // Act
  await workspace.showSessions();
  await workspace.openRow();
  await expect(page.getByText('A finished background reply', { exact: true })).toBeInViewport();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  await server.updateAgentState({});
  // Assert
  await expect(page).toHaveTitle('Rayno · Connected workspace');
  await expect(icon(page)).toHaveAttribute('href', '/icons/rayno.svg');
  expect(server.mutations).toEqual([]);
});

test('a session-event should surface a reply that the realtime update missed', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  await expect(page).toHaveTitle('Rayno · Older workspace');
  // Act
  await server.pushEvent(agent('A reply without a realtime update'), 'real-session', false);
  server.sendSessionEvent('real-session', 'done');
  // Assert
  await expect(page).toHaveTitle('(1) Rayno · Older workspace');
  await workspace.showSessions();
  await expect(workspace.indicator('Unread')).toBeVisible();
});
