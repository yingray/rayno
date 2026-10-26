import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PerformancePage } from './pages/PerformancePage';

test('chat should preserve existing Markdown during input, activity events, and new replies', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Prepare a report' } },
    ...Array.from({ length: 100 }, (_, index) => ({ role: 'session', content: {
      role: 'agent', turn: 't1', ev: { t: 'text', text: `${index === 99 ? 'From the real protocol\n\n' : ''}### Report ${index}\n\nA **result** with a [reference](https://example.com).\n\n| Item | Status |\n| --- | --- |\n| Chat | Ready |` },
    } })),
  ]);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  await workspace.watchExistingMarkdown();
  // Act
  await workspace.typeDraft('Keep this draft while the agent works');
  await server.setWorking(true);
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
  await server.pushReply('The next result is ready');
  await expect(page.getByText('The next result is ready', { exact: true })).toBeAttached();
  // Assert
  await workspace.expectExistingMarkdownUntouched();
  await workspace.expectDraft('Keep this draft while the agent works');
  expect(server.sends).toHaveLength(0);
  // Act
  await workspace.expectDraftAfterReload('Keep this draft while the agent works');
});

test('chat should load file tools on demand and retain the draft across the lazy route', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PerformancePage(page);
  await workspace.openSession();
  await workspace.expectLazyScreensAbsent();
  await workspace.typeDraft('Draft before file preview');
  // Act
  await workspace.openFiles();
  // Assert
  expect((await workspace.loadedAssets()).some((name) => /\/GitChanges-.*\.js$/.test(name))).toBe(true);
  // Act
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  // Assert
  await workspace.expectDraft('Draft before file preview');
  expect(server.sends).toHaveLength(0);
});
