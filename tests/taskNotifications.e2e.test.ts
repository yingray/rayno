import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('stored task notifications should stay hidden while following user text stays visible', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const notification = '<task-notification>\n<task-id>agent-1</task-id>\n<status>completed</status>\n'
    + '<summary>Agent "Review round 10 takes" finished</summary>\n<note>A task can notify more than once.</note>\n</task-notification>';
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: notification } },
    { role: 'session', content: { role: 'user', ev: { t: 'text', text: notification } } },
    { role: 'session', content: { role: 'agent', ev: { t: 'text', text: notification } } },
    { role: 'session', content: { role: 'agent', ev: { t: 'text', text: 'From the real protocol' } } },
    { role: 'session', content: { role: 'user', ev: { t: 'text', text: `${notification}\nContinue with the fix` } } },
  ]);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await workspace.openSession();
  // Assert
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.getByText('Continue with the fix', { exact: true })).toBeVisible();
  await expect(page.getByText('Review round 10 takes', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
