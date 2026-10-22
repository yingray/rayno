import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('the latest-message shortcut should preserve history reading and restore automatic following', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Review the conversation' } },
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'From the real protocol' } } },
    ...Array.from({ length: 18 }, (_, index) => ({
      role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text:
        `### Workspace update ${index + 1}\n\nKeep the session history readable while the agent sends more replies.\n\nEach update stays in this conversation.`,
      } },
    })),
  ]);
  const workspace = new LiveWorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await workspace.openSession();
  await page.evaluate(() => document.fonts.ready);
  await expect(workspace.latestShortcut()).toHaveCount(0);
  await expect.poll(async () => (await workspace.conversationPosition()).remaining).toBeLessThan(1);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unfinished draft');
  // Act
  await workspace.readHistory();
  const position = await workspace.conversationPosition();
  await server.pushReply('A new reply while you read history');
  // Assert
  await expect(page.getByText('A new reply while you read history', { exact: true })).toBeAttached();
  expect((await workspace.conversationPosition()).top).toBeCloseTo(position.top, 0);
  await expect(workspace.latestShortcut()).toBeVisible();
  const shortcut = (await workspace.latestShortcut().boundingBox())!;
  const input = (await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox())!;
  expect(shortcut.y).toBeGreaterThan(0);
  expect(shortcut.y + shortcut.height).toBeLessThan(input.y);
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-latest-message-shortcut`);
  // Act
  await workspace.returnToLatest();
  await server.pushReply('The next reply follows automatically');
  // Assert
  await expect(page.getByText('The next reply follows automatically', { exact: true })).toBeInViewport();
  await expect.poll(async () => (await workspace.conversationPosition()).remaining).toBeLessThan(1);
  await expect(workspace.latestShortcut()).toHaveCount(0);
  await workspace.expectDraft('Keep this unfinished draft');
  expect(server.sends).toEqual([]);
  expect(server.mutations).toEqual([]);
  // Act
  await workspace.readHistory();
  await workspace.latestShortcut().focus();
  await workspace.latestShortcut().press('Enter');
  // Assert
  await expect(workspace.latestShortcut()).toHaveCount(0);
  await expect.poll(async () => (await workspace.conversationPosition()).remaining).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('numbered Markdown should render bold labels next to Chinese punctuation and keep code literal', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const markdown = [
    'From the real protocol', '',
    '1. **第一項**：正常的編號與粗體',
    '2. **模型（Model）**可以隨時切換',
    '3. **推理強度：**選擇 High 或 Max',
    '   - **子項目（說明）**與 `inline code` 保留',
    '4. **English title** with a [reference](https://example.com/reference)', '',
    '7. **接續的清單**', '8. **第二個編號**', '',
    '```md', '1. **程式碼中的清單**', '2. **模型（Model）**這裡要保留星號', '```', '',
    '`1. **inline example**`', '',
    '\\*\\*escaped example\\*\\*', '',
    '<options><option>繼續</option></options>',
  ].join('\n');
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Show a numbered list' } },
    { role: 'agent', content: {
      type: 'codex', data: { type: 'message', message: markdown },
    } },
  ]);
  const workspace = new LiveWorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Act
  await workspace.openSession();
  // Assert
  const lists = page.locator('article ol');
  await expect(lists).toHaveCount(1);
  await expect(lists.locator(':scope > li')).toHaveCount(6);
  await expect(lists.locator('strong')).toHaveText([
    '第一項', '模型（Model）', '推理強度：', '子項目（說明）', 'English title', '接續的清單', '第二個編號',
  ]);
  await expect(lists.locator('li').filter({ hasText: '模型（Model）可以隨時切換' })).toHaveCount(1);
  await expect(lists.getByRole('link', { name: 'reference' })).toHaveAttribute('href', 'https://example.com/reference');
  await expect(workspace.codeExample('1. **程式碼中的清單**')).toContainText('2. **模型（Model）**這裡要保留星號');
  await expect(page.locator('article p code').filter({ hasText: '1. **inline example**' })).toHaveCount(1);
  await expect(page.locator('article p').filter({ hasText: '**escaped example**' })).toHaveCount(1);
  await expect(workspace.replyOptions().getByRole('button', { name: '繼續', exact: true })).toBeVisible();
  await workspace.expectNoPageOverflow();
  await lists.first().scrollIntoViewIfNeeded();
  await workspace.capture(`${testInfo.project.name}-numbered-markdown`);
  expect(errors).toEqual([]);
});

test('chat should group consecutive tool events and keep Markdown tables readable within their scroll area', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const legacyTool = { role: 'agent', content: { type: 'output', data: {
    type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] },
  } } };
  const tool = (name: string) => ({ role: 'session', content: { role: 'agent', turn: 't1', ev: {
    t: 'tool-call-start', name,
  } } });
  const table = [
    '### Verification results',
    '',
    '| Component | Description | Result | Count | Reference | Owner |',
    '| :--- | :--- | :---: | ---: | :--- | :--- |',
    '| **Session list** | Activity dates and stable ordering | Passed | 12 | [Report](https://example.com/report) | Frontend |',
    '| `chat.tsx` | 中文說明與完整的表格內容 | Passed | 3 | Inline code | Frontend |',
    '| Tool groups | Escaped pipe: a \\| b | Passed | 4 | Consecutive activity | Frontend |',
  ].join('\n');
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Check the workspace' } },
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'From the real protocol' } } },
    legacyTool,
    legacyTool,
    tool('Inspect package.json'),
    { role: 'agent', content: { type: 'codex', data: { type: 'message', message: table } } },
    tool('Edit the layout'),
    tool('Validate the layout'),
    { role: 'user', content: { type: 'text', text: 'Review this output' } },
    tool('Read the final report'),
  ]);
  const workspace = new LiveWorkspacePage(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await workspace.openSession();
  // Act
  await workspace.expandToolGroup(0);
  const groups = workspace.toolGroups();
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0).getByRole('listitem')).toHaveText(['Read', 'Read', 'Inspect package.json']);
  await groups.nth(0).getByRole('button').click();
  await expect(groups.nth(0).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await workspace.expandToolGroup(2);
  await server.pushEvent(tool('Check the final report'));
  // Assert
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(2).getByRole('listitem')).toHaveText(['Read the final report', 'Check the final report']);
  const tableRegion = workspace.markdownTable();
  await expect(tableRegion.getByRole('columnheader')).toHaveText([
    'Component', 'Description', 'Result', 'Count', 'Reference', 'Owner',
  ]);
  await expect(tableRegion.getByRole('cell', { name: '12', exact: true })).toHaveCSS('text-align', 'right');
  await expect(tableRegion.getByRole('cell', { name: 'Escaped pipe: a | b', exact: true })).toBeVisible();
  await expect(tableRegion.getByRole('link', { name: 'Report' })).toHaveAttribute('href', 'https://example.com/report');
  await expect(tableRegion.locator('code')).toHaveText('chat.tsx');
  await tableRegion.scrollIntoViewIfNeeded();
  const dimensions = await tableRegion.evaluate((element) => ({
    overflow: getComputedStyle(element).overflowX,
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.overflow).toBe('auto');
  if (testInfo.project.name.startsWith('mobile')) expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
  await workspace.expectNoPageOverflow();
  await workspace.capture(`${testInfo.project.name}-chat-presentation`);
  expect(errors).toEqual([]);
});
