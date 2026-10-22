import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const agent = (text: string) => ({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } });
const user = (text: string) => ({ role: 'user', content: { type: 'text', text } });
const choices = '<options><option>繼續 ✓</option><option>先等等</option></options>';

test('returning to a visible chat should recover replies missed while the tab was hidden', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  // Act
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await server.pushEvent(agent('A reply missed while the tab was hidden'), 'real-session', false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Assert
  await expect(page.getByText('A reply missed while the tab was hidden', { exact: true })).toBeInViewport();
  await expect(workspace.latestShortcut()).toHaveCount(0);
  await workspace.showSessions();
  await expect(workspace.indicator('Unread')).toHaveCount(0);
});

test('new replies should mark a background session unread, persist across reload, and clear after viewing the latest reply', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  // Act
  await server.pushReply('A new unread reply');
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toBeVisible();
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  // Act
  await page.reload();
  await expect(workspace.indicator('Unread')).toBeVisible();
  await workspace.openRow();
  await expect(page.getByText('A new unread reply', { exact: true })).toBeInViewport();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  await page.reload();
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  expect(server.mutations).toEqual([]);
});

test('options should retain a needs-input indicator while offline and after reading, then clear after a confirmed reply', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  // Act
  await server.pushReply('請選擇下一步：\n\n' + choices);
  server.sessions.find((session) => session.id === 'real-session')!.active = false;
  server.setMachineActive(false);
  await server.setWorking(false);
  await workspace.showSessions(true);
  // Assert
  await expect(workspace.indicator('Unread')).toBeVisible();
  await expect(workspace.indicator('Needs input')).toBeVisible();
  await workspace.capture(`${testInfo.project.name}-offline-session-attention`);
  await page.reload();
  await workspace.showSessions(true);
  await expect(workspace.indicator('Needs input')).toBeVisible();
  // Act
  server.sessions.find((session) => session.id === 'real-session')!.active = true;
  server.setMachineActive(true);
  await server.setWorking(false);
  await workspace.showSessions();
  await workspace.openRow();
  await expect(workspace.replyOptions()).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  await expect(workspace.indicator('Needs input')).toBeVisible();
  // Act
  await workspace.openRow();
  await workspace.selectReply('繼續 ✓');
  await expect(workspace.replyOptions().getByRole('button').first()).toBeDisabled();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  await page.reload();
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  expect(server.sends).toHaveLength(1);
});

test('permission and form requests should retain their own indicator until the matching response succeeds', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  await workspace.showSessions();
  await expect(workspace.indicator('Needs input')).toBeVisible();
  // Act
  await workspace.openRow();
  await workspace.allowOnce();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  // Act
  await server.updateAgentState({ communications: { question: { kind: 'form', form: { questions: [
    { id: 'next', header: 'Next step', question: 'Continue the review?', options: [{ label: 'Continue' }], allowCustom: false },
  ] } } } });
  await expect(workspace.indicator('Needs input')).toBeVisible();
  await workspace.openRow();
  await page.getByRole('radio', { name: 'Continue', exact: true }).check();
  await page.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send answers', exact: true })).toHaveCount(0);
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  await page.reload();
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  expect(server.permissionReplies).toBe(1);
  expect(server.communicationReplies).toMatchObject([{ id: 'question', status: 'answered', answers: { next: { options: ['Continue'] } } }]);
});

test('reload should recover a missed options message behind more than one page of tools without treating code samples as questions', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openOtherSession();
  // Act
  await server.pushEvent(agent(choices), 'real-session', false);
  for (let index = 0; index < 145; index++) await server.pushEvent({ role: 'session', content: { role: 'agent', turn: 't1', ev: {
    t: 'tool-call-start', name: `Tool ${index}`,
  } } }, 'real-session', false);
  await page.reload();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toBeVisible();
  await expect(workspace.indicator('Needs input')).toBeVisible();
  expect(server.requests.some((request) => request.path.includes('before_seq=50'))).toBe(true);
  // Act
  await server.pushEvent(user('Continue from another client'));
  await server.pushReply('```xml\n' + choices + '\n```');
  // Assert
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  await expect(workspace.indicator('Unread')).toBeVisible();
});

test('reading old messages should keep new replies unread until the latest-message shortcut is used', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([user('Start'), agent('From the real protocol'), ...Array.from({ length: 20 }, (_, index) =>
    agent(`### Update ${index}\n\nA detailed workspace update.\n\nKeep the history available while new replies arrive.`))]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  await page.getByRole('textbox', { name: 'Message', exact: true }).click();
  // Act
  await workspace.readHistory();
  await server.pushReply('A reply below the current reading position');
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toBeVisible();
  // Act
  await workspace.openRow();
  await expect(workspace.latestShortcut()).toBeVisible();
  await workspace.returnToLatest();
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toHaveCount(0);
});
