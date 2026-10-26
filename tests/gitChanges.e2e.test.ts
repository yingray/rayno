import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { GitChangesPage } from './pages/GitChangesPage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
  test(`Git diff demo should filter files, switch layers and inspect changes at ${width}x${height}`, async ({ page }, info) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const view = new GitChangesPage(page);
    await view.openChanges(true);
    // Act / Assert
    await expect(view.diff()).toContainText('Rayno workspace');
    await view.expectHeaderGit('demo/git-diff', '+19−8');
    await view.expectControlLayout();
    await view.expectDiffContrast();
    await view.source('Staged');
    await expect(view.diff()).toContainText('My workspace');
    await expect(view.diff()).not.toContainText('Rayno workspace');
    await view.layout('Split');
    await view.expectControlLayout();
    await view.expectDiffContrast();
    await expect(view.diff()).toHaveAttribute('data-layout', 'split');
    await view.use(view.screen().getByRole('button', { name: 'Wrap lines', exact: true }));
    await expect(view.diff()).toHaveAttribute('data-wrap', 'false');
    await view.diff().evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await view.layout('Unified');
    await view.selectFile('notes/試用 diff.md');
    await expect(view.diff()).toContainText('Your draft and demo preferences');
    await expect(view.screen()).toContainText('New file · all lines are additions');
    await view.clearSearch();
    await view.filter('Staged');
    await view.selectFile('docs/Guide with spaces.md');
    await expect(view.screen()).toContainText('rename from docs/old-guide.md');
    await view.clearSearch(); await view.filter('All changes');
    await view.selectFile('assets/preview.png');
    await expect(view.screen().getByText('Binary file', { exact: true })).toBeVisible();
    await view.scenario('conflict');
    await expect(view.diff()).toContainText('<<<<<<< HEAD');
    await view.scenario('clean');
    await expect(view.screen().getByRole('heading', { name: 'Working tree clean' })).toBeVisible();
    await view.scenario('error');
    await expect(view.screen().getByRole('alert')).toContainText('Demo: the Git read failed');
    await view.scenario('changes');
    await expect(view.diff()).toContainText('Rayno workspace');
    await view.expectNoPageOverflow();
    if (width === 390 && height === 844) await page.screenshot({ path: info.outputPath('git-diff-phone.png') });
    await view.use(view.screen().getByRole('button', { name: 'Back to chat', exact: true }));
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await view.expectHeaderGit('demo/git-diff', '+19−8');
  });
}

test('live Git diff should retain exact paths and distinguish staged and working layers', async ({ page }) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.updateAgentState({});
  const path = "src/試用 ' $(echo nope) [1].ts";
  server.gitChangesStatus = '## main...origin/main [ahead 1]\0MM ' + path + '\0';
  server.gitWorkingNumstat = '2\t1\t' + path + '\0'; server.gitStagedNumstat = '1\t1\t' + path + '\0';
  server.gitPatches.set(path, '@@ -1 +1,2 @@\n-old\n+new\n+const safe = true;\n');
  const view = new GitChangesPage(page); await view.openChanges();
  // Act / Assert
  await expect(view.diff()).toContainText('const safe = true;');
  await expect(view.screen().getByRole('heading', { name: path, exact: true })).toBeVisible();
  await view.source('Staged'); await expect(view.diff()).toContainText('const safe = true;');
  await expect.poll(() => server.bashCommands.some(call => call.command.includes('--cached --no-relative --no-ext-diff'))).toBe(true);
  expect(server.bashCommands.some(call => call.command.includes(':(top,literal)src/試用'))).toBe(true);
  expect(server.sends).toHaveLength(0);
  const download = page.waitForEvent('download');
  await view.use(view.screen().getByRole('button', { name: 'Download diff', exact: true }));
  expect((await download).suggestedFilename()).toContain('.patch');
});

test('Git diff reads should retry an error, refresh a clean repository and preserve the chat draft', async ({ page }) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.updateAgentState({});
  const view = new GitChangesPage(page); await view.openSession();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my Git review draft');
  server.gitReadError = 'fatal: not a git repository';
  await view.info(); await view.use(page.getByRole('button', { name: /^View changes/ }));
  // Act / Assert
  await expect(view.screen().getByRole('alert')).toContainText('not a git repository');
  server.gitReadError = '';
  await view.use(view.screen().getByRole('button', { name: 'Retry', exact: true }));
  await expect(view.diff()).toContainText('new');
  server.gitChangesStatus = '## main\0'; server.gitWorkingNumstat = '';
  await view.use(view.screen().getByRole('button', { name: 'Refresh', exact: true }));
  await expect(view.screen().getByRole('heading', { name: 'Working tree clean' })).toBeVisible();
  await view.use(view.screen().getByRole('button', { name: 'Back to chat', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my Git review draft');
  expect(server.sends).toHaveLength(0);
});

test('large Git diffs should reveal remaining lines and retain the loaded patch during offline use', async ({ page, context }) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.updateAgentState({});
  server.gitPatches.set('README.md', '@@ -0,0 +1,900 @@\n' + Array.from({ length: 900 }, (_, i) => '+line ' + (i + 1)).join('\n') + '\n');
  const view = new GitChangesPage(page); await view.openChanges();
  // Act / Assert
  await expect(view.diff()).toContainText('line 399'); await expect(view.diff()).not.toContainText('line 900');
  await view.use(view.screen().getByRole('button', { name: /^Show more lines/ }));
  await view.use(view.screen().getByRole('button', { name: /^Show more lines/ }));
  await expect(view.diff()).toContainText('line 900');
  await context.setOffline(true);
  await expect(view.screen()).toContainText('Offline · showing the last loaded changes');
  await expect(view.diff()).toContainText('line 900');
  await expect(view.screen().getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
});

test('saved demo accounts should gain the Git diff example without losing drafts or preferences', async ({ page }) => {
  // Arrange
  await page.goto('/session/git-diff-demo/changes?demo=1');
  const view = new GitChangesPage(page); await expect(view.diff()).toContainText('Rayno workspace');
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('rayno.demo.v1'))).toBe(true);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('rayno.demo.v1')!);
    saved.sessions = saved.sessions.filter((session: { id: string }) => session.id !== 'git-diff-demo');
    saved.drafts['reply-options-demo'] = 'Saved before the Git diff';
    localStorage.setItem('rayno.demo.v1', JSON.stringify(saved));
  });
  // Act / Assert
  await page.reload(); await expect(view.diff()).toContainText('Rayno workspace');
  await page.goto('/session/reply-options-demo?demo=1');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Saved before the Git diff');
});
