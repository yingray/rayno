import { expect, test, type Locator, type Page } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

const phoneSizes = [[320, 568], [360, 640], [390, 844], [430, 932], [390, 500], [844, 390]];
const desktopSizes = [[1440, 900], [1024, 768]];
// claude/utils/sessionProtocolMapper.ts sends { role: 'session', content: envelope }; toolTitle() gives '<name> call'.
const toolCall = (call: string, name: string, time: number) => ({
  role: 'session',
  content: { id: `e-${call}`, time, role: 'agent', turn: 't1', ev: { t: 'tool-call-start', call, name, title: `${name} call`, description: `${name} call`, args: {} } },
});
const card = (page: Page, tool: string) =>
  page.getByLabel('Agent requests', { exact: true }).locator('section').filter({ has: page.getByText(tool, { exact: true }) });

async function expectReachable(page: Page, control: Locator) {
  await control.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const viewport = page.viewportSize()!;
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

test('edit requests should offer no session approval and keep every request action reachable', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  server.sessions[0].agentState = await server.encryption.encrypt({ requests: {
    edit: { tool: 'Edit', arguments: { file_path: '/real/project/src/app.ts', old_string: 'a', new_string: 'b' }, createdAt: 1 },
    read: { tool: 'Read', arguments: { file_path: '/real/project/README.md' }, createdAt: 2 },
  } }, server.dataKey);
  const workspace = new LiveWorkspacePage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await workspace.openSession();
  // Act / Assert
  for (const [width, height] of touch ? phoneSizes : desktopSizes) {
    await page.setViewportSize({ width, height });
    await expect(card(page, 'Edit').getByRole('button', { name: 'Allow for this session', exact: true })).toHaveCount(0);
    for (const name of ['Deny', 'Allow once']) await expectReachable(page, card(page, 'Edit').getByRole('button', { name, exact: true }));
    for (const name of ['Deny', 'Allow once', 'Allow for this session'])
      await expectReachable(page, card(page, 'Read').getByRole('button', { name, exact: true }));
    await workspace.expectNoPageOverflow();
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-edit-request-${width}x${height}`);
  }
  // Act
  const allow = card(page, 'Edit').getByRole('button', { name: 'Allow once', exact: true });
  await allow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  if (touch) await allow.tap(); else await allow.click();
  // Assert
  await expect.poll(() => server.permissionPayloads.length).toBe(1);
  expect(server.permissionPayloads[0]).toEqual({ id: 'edit', approved: true, decision: 'approved' });
  await expect(card(page, 'Edit')).toHaveCount(0);
  await expect(card(page, 'Read')).toHaveCount(1);
});

test('a plan exit request should show plan mode, stay reachable, and return to the mode from before plan', async ({ page }, testInfo) => {
  // Arrange: Claude enters plan mode in a Yolo session and asks to exit it.
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([{ role: 'user', content: { type: 'text', text: 'Plan the change' }, meta: { sentFrom: 'web', permissionMode: 'bypassPermissions' } },
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'From the real protocol' } } }]);
  await server.pushEvent(toolCall('toolu_enter', 'EnterPlanMode', 1700000002000), 'real-session', false, 1700000002000);
  await server.pushEvent(toolCall('toolu_exit', 'ExitPlanMode', 1700000003000), 'real-session', false, 1700000003000);
  server.sessions[0].agentState = await server.encryption.encrypt({ requests: {
    toolu_exit: { tool: 'ExitPlanMode', arguments: { plan: 'Change the README title.' }, createdAt: 1700000003000 },
  } }, server.dataKey);
  const workspace = new LiveWorkspacePage(page);
  const touch = !!testInfo.project.use.hasTouch;
  await workspace.openSession();
  const exit = card(page, 'ExitPlanMode');
  // Act / Assert
  for (const [width, height] of touch ? phoneSizes : desktopSizes) {
    await page.setViewportSize({ width, height });
    await expect(workspace.permissionMode()).toHaveText('Mode: Plan');
    await expect(workspace.permissionMode()).toBeInViewport();
    await expect(exit.getByRole('button', { name: 'Allow for this session', exact: true })).toHaveCount(0);
    for (const name of ['Deny', 'Allow once']) await expectReachable(page, exit.getByRole('button', { name, exact: true }));
    await workspace.expectNoPageOverflow();
    if (width === 320 || width === 844 || width === 1440) await workspace.capture(`${testInfo.project.name}-plan-exit-${width}x${height}`);
  }
  // Act
  const allow = exit.getByRole('button', { name: 'Allow once', exact: true });
  await allow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  if (touch) await allow.tap(); else await allow.click();
  // Assert
  await expect.poll(() => server.permissionPayloads.length).toBe(1);
  expect(server.permissionPayloads[0]).toEqual({ id: 'toolu_exit', approved: true, decision: 'approved', mode: 'bypassPermissions' });
  await expect(exit).toHaveCount(0);
  // Act: claude/utils/permissionHandler.ts stores the approval with its mode in completedRequests.
  await server.updateAgentState({ requests: {}, completedRequests: {
    toolu_exit: { tool: 'ExitPlanMode', arguments: {}, createdAt: 1700000003000, completedAt: 1700000004000, status: 'approved', mode: 'bypassPermissions' },
  } });
  // Assert
  await expect(workspace.permissionMode()).toHaveText('Mode: Yolo');
});
