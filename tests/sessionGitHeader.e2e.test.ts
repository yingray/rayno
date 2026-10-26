import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { GitChangesPage } from './pages/GitChangesPage';

test('chat Git header should retain the branch and distinguish unread, reported and explicitly read changes', async ({ page }) => {
  // Arrange
  const server = new HappyServer(); await server.install(page); await server.updateAgentState({});
  const branch = 'feature/a-long-branch-name-for-narrow-headers';
  await server.updateMetadata({ gitBranch: branch, git: { branch }, workspace: { name: 'a-long-workspace-name-that-must-not-hide-git' },
    summary: { text: 'A long session title must leave room for branch and changes' } });
  const view = new GitChangesPage(page); await view.openSession();
  // Act / Assert: the mobile header keeps all three rows without hiding Git information.
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await view.expectCompactChatHeader();
    await view.expectHeaderGit(branch, 'Git not read');
    await view.expectNoPageOverflow();
  }
  await server.updateMetadata({ git: { branch, insertions: 1234, deletions: 56 } });
  await view.expectHeaderGit(branch, '+1.2K−56');
  // The explicit Git read remains available through the mobile Session info route.
  await page.setViewportSize({ width: 320, height: 568 });
  server.gitChangesStatus = '## feature/read-from-git\0 M README.md\0';
  server.gitWorkingNumstat = '7\t3\tREADME.md\0';
  await view.info(); await view.use(page.getByRole('button', { name: /^View changes/ }));
  await expect(view.diff()).toContainText('new');
  await view.use(view.screen().getByRole('button', { name: 'Back to chat', exact: true }));
  await view.expectHeaderGit('feature/read-from-git', '+7−3');
  await view.info();
  await expect(page.getByRole('button', { name: /^Branch/ })).toContainText('feature/read-from-git');
  await expect(page.getByRole('button', { name: /^View changes/ })).toContainText('+7 −3');
});

test('Git diff controls should fit a narrow desktop panel and translated phone labels', async ({ page }) => {
  // Arrange
  const view = new GitChangesPage(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/session/git-diff-demo/changes?demo=1');
  await expect(view.diff()).toContainText('Rayno workspace');
  // Act / Assert
  await view.expectControlLayout();
  await view.selectFile('src/styles/tokens.css');
  await view.layout('Split'); await view.expectControlLayout();
  await page.goto('/settings/advanced?demo=1');
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-TW');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/session/git-diff-demo/changes?demo=1');
  await expect(page.getByRole('region', { name: '檔案 diff', exact: true })).toContainText('Rayno workspace');
  const controls = page.locator('[data-diff-toolbar]');
  await expect(controls.getByRole('button', { name: '工作區', exact: true })).toBeVisible();
  const issues = await controls.evaluate(element => [...element.querySelectorAll('button')].filter(button => {
    const range = document.createRange(); range.selectNodeContents(button);
    const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
    return text.width > 0 && (text.left < box.left - 1 || text.right > box.right + 1);
  }).map(button => button.textContent));
  expect(issues).toEqual([]);
  await controls.getByRole('button', { name: '雙欄', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '變更前', exact: true })).toBeVisible();
  await view.expectNoPageOverflow();
});
