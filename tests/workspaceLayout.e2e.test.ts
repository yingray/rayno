import { expect, test } from '@playwright/test';
import { WorkspaceLayoutPage } from './pages/WorkspaceLayoutPage';

test('new session typing should render only the prompt and submit the latest saved text', async ({ page }) => {
  const demo = new WorkspaceLayoutPage(page);
  await demo.installRenderProbe();
  await demo.openNew();
  await demo.clearRenders();
  await demo.prompt().pressSequentially('keep this task');
  const renders = await demo.renders();
  expect(renders['prompt-0']).toBeGreaterThan(0);
  expect(Object.keys(renders)).toEqual(['prompt-0']);
  await demo.prompt().fill('最新的 task description');
  await page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(demo.prompt()).toHaveValue('最新的 task description');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1') || '{}').newDraft?.prompt)).toBe('最新的 task description');
  await page.reload();
  await expect(demo.prompt()).toHaveValue('最新的 task description');
  await demo.prompt().fill('Submit this exact latest task');
  await demo.activate(demo.start());
  await expect(page).toHaveURL(/\/session\/[^/?]+$/);
  await expect(page.getByText('Submit this exact latest task', { exact: true }).last()).toBeVisible();
});

test('side chats should reach both 7:3 limits and keep drafts when Sessions collapses or expands', async ({ page, browserName }) => {
  const demo = new WorkspaceLayoutPage(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await demo.openDemo(true);
  await demo.mainChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the main draft');
  await demo.sideChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Keep the side draft');
  for (const visible of [true, false, true]) {
    await demo.toggleSessions(visible);
    await demo.drag('side', await demo.panelWidth('side') - await demo.limit('side', 'max') - 20, browserName);
    await demo.expectRatio(0.7);
    await demo.drag('side', await demo.panelWidth('side') - await demo.limit('side', 'min') + 20, browserName);
    await demo.expectRatio(0.3);
    await expect(demo.mainChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the main draft');
    await expect(demo.sideChat().getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep the side draft');
  }
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => demo.limit('side', 'max')).toBeLessThan(800);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    for (const key of ['End', 'Home']) {
      await demo.separator('side').press(key);
      await demo.expectRatio(key === 'End' ? 0.7 : 0.3);
      await demo.mainChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Still editable');
      await demo.sideChat().getByRole('textbox', { name: 'Message', exact: true }).fill('Still editable');
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await demo.activate(page.getByRole('button', { name: 'Expand navigation', exact: true }));
  for (const key of ['End', 'Home']) {
    await demo.separator('side').press(key);
    await demo.expectRatio(key === 'End' ? 0.7 : 0.3);
    await demo.exerciseComposer(demo.mainChat(), `Main send at ${key}`);
    await demo.exerciseComposer(demo.sideChat(), `Side send at ${key}`);
  }
  await demo.toggleSessions(false);
  await page.reload();
  await expect(demo.sessionList()).toBeHidden();
  await page.getByRole('button', { name: 'Close side chats', exact: true }).click();
  await expect(demo.sessionList()).toBeHidden();
  await demo.activate(page.getByRole('button', { name: 'Open session list', exact: true }));
  await expect(demo.sessionList()).toBeVisible();
  await demo.activate(demo.sessionList().getByRole('button', { name: 'Collapse session list', exact: true }));
  await expect(demo.sessionList()).toBeHidden();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(demo.sessionList()).toBeVisible();
  await expect(demo.listOptions().getByRole('textbox', { name: 'Search sessions', exact: true })).toBeFocused();
});

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`workspace demo should create sessions and send side messages at ${width}x${height}`, async ({ page }) => {
    const demo = new WorkspaceLayoutPage(page);
    await page.setViewportSize({ width, height });
    await demo.openNew();
    await demo.prompt().fill(`Task at ${width}x${height}`);
    await demo.prompt().focus();
    await expect(demo.prompt()).toHaveCSS('font-size', '16px');
    await demo.expectInViewport(demo.start());
    await demo.expectTouchTarget(demo.start());
    await demo.activate(demo.start());
    await expect(page).toHaveURL(/\/session\/[^/?]+$/);
    await demo.openDemo(true);
    await expect(page.getByRole('separator', { name: /^Resize / })).toHaveCount(0);
    await demo.activate(demo.row('Side chat 1'));
    await expect(page).toHaveURL(/\/session\/workspace-layout-side-demo$/);
    await expect(page.getByRole('button', { name: 'Open session info', exact: true })).toContainText('Side chat 1');
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(`Side task at ${width}x${height}`);
    await input.focus();
    await demo.expectInViewport(page.getByRole('button', { name: 'Send message', exact: true }));
    if (width < 768 || await page.evaluate(() => navigator.maxTouchPoints > 0))
      await demo.expectTouchTarget(page.getByRole('button', { name: 'Send message', exact: true }));
    await expect(input).toHaveValue(`Side task at ${width}x${height}`);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await demo.activate(page.getByRole('button', { name: 'Send message', exact: true }));
    await expect(input).toHaveValue('');
    await expect(page.getByText(`Side task at ${width}x${height}`, { exact: true }).last()).toBeVisible();
    await demo.expectNoPageOverflow();
  });
}

test('workspace demo should be discoverable and preserve older sessions, drafts, and preferences', async ({ page }) => {
  const demo = new WorkspaceLayoutPage(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [{ id: 'existing-demo', title: 'Keep this session', workspace: 'rayno', project: 'Rayno',
        path: '/demo/rayno', branch: 'main', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5',
        status: 'idle', unread: false, archived: false, createdAt: 1, updatedAt: 1, additions: 0, deletions: 0, messages: [] }],
      preferences: { chatWidth: 'standard' }, drafts: { untouched: 'Keep this draft' },
      newDraft: { prompt: 'Keep this task' }, recentPaths: [],
    }));
  });
  await page.goto('/sessions?demo=1');
  await expect(demo.sessionRow('Workspace layout · Interactive demo')).toBeVisible();
  await demo.sessionRow('Workspace layout · Interactive demo').click();
  await demo.openDemo(true);
  await expect(demo.panel()).toBeVisible();
  await demo.openNew();
  await expect(demo.prompt()).toHaveValue('Keep this task');
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
    return [saved.drafts.untouched, saved.preferences.chatWidth, saved.sessions.find((session: { id: string }) => session.id === 'existing-demo')?.title];
  })).toEqual(['Keep this draft', 'standard', 'Keep this session']);
});
