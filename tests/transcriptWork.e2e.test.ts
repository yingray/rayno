import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { TranscriptPage } from './pages/TranscriptPage';
import { agentSubagentWork } from '../src/happy/subagentEnvelopes.fixture';

const phones = [[320, 740], [360, 800], [390, 844], [430, 932], [390, 360], [844, 390]];
const answer = 'The config is config.json.';
const stop = agentSubagentWork.findIndex((raw) => raw.content.ev.t === 'stop');

test('subagent work and thinking should stay collapsed while the main answer and its options show', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages(agentSubagentWork);
  const chat = new TranscriptPage(page);
  const touch = !!testInfo.project.use.hasTouch;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Act
  await chat.openChat(answer);
  // Assert
  await expect(chat.replyOptions()).toHaveCount(1);
  await expect(chat.replyOptions().getByRole('button', { name: 'Open it', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Child option', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Subagent found config\.json/)).toBeHidden();
  await expect(chat.toolGroups()).toHaveCount(1);
  await expect(chat.toolGroups().getByRole('button').first()).toContainText('· 1 tool');
  await expect(chat.thinking()).toHaveCount(2);
  await expect(page.getByText('I should delegate the search.', { exact: true })).toBeHidden();
  const standalone = chat.thinking().first().locator('summary');
  const agent = chat.toolRow('Find config');
  const row = chat.toolRow('Thinking');
  // Act
  await chat.toggle(standalone, touch);
  await chat.expandToolGroup(0);
  await chat.toggle(agent, touch);
  await chat.toggle(row, touch);
  // Assert
  await expect(page.getByText('I should delegate the search.', { exact: true })).toBeVisible();
  await expect(chat.subagentWork()).toBeVisible();
  await expect(chat.subagentWork().getByRole('listitem')).toHaveCount(2);
  await expect(chat.subagentWork()).toContainText('Glob call');
  await expect(chat.subagentWork()).toContainText('Subagent found config.json <options><option>Child option</option></options>');
  await expect(chat.toolGroups().getByRole('group', { name: 'Reply options' })).toHaveCount(0);
  await expect(page.getByText('Now answer the user.', { exact: true })).toBeVisible();
  // Open rows must stay reachable without page overflow at every size, including a keyboard-height and a landscape phone.
  for (const [width, height] of touch ? phones : [[1440, 900], [1024, 600]]) {
    await page.setViewportSize({ width, height });
    for (const summary of [standalone, agent, row]) await chat.expectTarget(summary, touch);
    await chat.expectNoPageOverflow();
    if (width === (touch ? 390 : 1440) && height === (touch ? 844 : 900)) await chat.capture(`${testInfo.project.name}-subagent-work`);
  }
  // Act
  for (const summary of [standalone, agent, row]) {
    await summary.focus();
    await summary.press('Enter');
  }
  // Assert
  await expect(chat.subagentWork()).toBeHidden();
  await expect(page.getByText('I should delegate the search.', { exact: true })).toBeHidden();
  await expect(page.getByText('Now answer the user.', { exact: true })).toBeHidden();
  expect(server.sends).toEqual([]);
  expect(errors).toEqual([]);
});

test('options from a running subagent should not ask for input until the main answer offers them', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new TranscriptPage(page);
  await workspace.openOtherSession();
  // Act
  for (const raw of agentSubagentWork.slice(0, stop)) await server.pushEvent(raw);
  await workspace.showSessions();
  // Assert
  await expect(workspace.indicator('Unread')).toHaveCount(0);
  await expect(workspace.indicator('Needs input')).toHaveCount(0);
  // Act
  for (const raw of agentSubagentWork.slice(stop)) await server.pushEvent(raw);
  // Assert
  await expect(workspace.indicator('Needs input')).toBeVisible();
  await page.reload();
  await expect(workspace.indicator('Needs input')).toBeVisible();
  await workspace.openRow();
  await expect(workspace.replyOptions().getByRole('button', { name: 'Open it', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Child option', exact: true })).toHaveCount(0);
});
