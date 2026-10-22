import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { ComposerSuggestionsPage } from './pages/ComposerSuggestionsPage';

// Claude reports these through the SDK init message (claude/claudeRemote.ts `slash_commands`) into metadata.
const slashCommands = ['compact', 'review', 'pr-review', 'deploy-preview', 'test-plan', 'release-notes', 'lint-fix',
  'changelog', 'security-scan', 'bump-version', 'triage', 'retro'];

async function open(page: import('@playwright/test').Page) {
  const server = new HappyServer();
  await server.install(page);
  await server.updateMetadata({ slashCommands, skills: ['pr-review', 'design-check'] });
  const workspace = new ComposerSuggestionsPage(page);
  await workspace.openSession();
  await workspace.expectConnected();
  return { server, workspace };
}

test('slash command suggestions should follow the keyboard and insert the command without a send', async ({ page }) => {
  // Arrange
  const { server, workspace } = await open(page);
  await workspace.input().click();
  // Act
  await workspace.input().pressSequentially('/pr');
  // Assert
  await workspace.expectSelected('Command', '/pr-review');
  await expect(workspace.option('Command', '/review')).toHaveCount(0);
  // Act
  await workspace.input().press('ArrowUp');
  await workspace.input().press('ArrowDown');
  await workspace.input().press('Enter');
  // Assert
  await workspace.expectDraft('/pr-review ');
  await expect(workspace.suggestions('Command')).toHaveCount(0);
  expect(server.sends).toHaveLength(0);
  // Act
  await workspace.input().pressSequentially('now');
  await workspace.input().press('Enter');
  // Assert
  await expect.poll(() => server.sends.length).toBe(1);
  const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[0].content, server.dataKey);
  expect(message.content.text).toBe('/pr-review now');
});

test('Escape should close suggestions for the current word and Tab should pick the selected one', async ({ page }) => {
  // Arrange
  const { server, workspace } = await open(page);
  await workspace.input().click();
  await workspace.input().pressSequentially('Run /');
  await workspace.expectSelected('Command', '/compact');
  // Act
  await workspace.input().press('Escape');
  // Assert
  await expect(workspace.suggestions('Command')).toHaveCount(0);
  await workspace.expectDraft('Run /');
  // Act
  await workspace.input().pressSequentially('dep');
  await workspace.input().press('Tab');
  // Assert
  await workspace.expectDraft('Run /deploy-preview ');
  await expect(workspace.input()).toBeFocused();
  expect(server.sends).toHaveLength(0);
});

test('file mention suggestions should read the session files once and insert the picked path', async ({ page }, testInfo) => {
  // Arrange
  const { server, workspace } = await open(page);
  const touch = !!testInfo.project.use.hasTouch;
  await (touch ? workspace.input().tap() : workspace.input().click());
  // Act
  await workspace.input().pressSequentially('Read @app');
  // Assert
  await workspace.expectSelected('File', 'app/');
  await expect(workspace.option('File', 'App.tsx')).toBeVisible();
  // Act
  const option = workspace.option('File', 'app.module.css');
  await (touch ? option.tap() : option.click());
  // Assert
  await workspace.expectDraft('Read @src/app/app.module.css ');
  await expect(workspace.input()).toBeFocused();
  // Act
  await workspace.input().pressSequentially('and @pan');
  await workspace.input().press('Enter');
  // Assert
  await workspace.expectDraft('Read @src/app/app.module.css and @src/components/Panel.tsx ');
  expect(server.ripgrepCalls).toEqual([{ args: ['--files', '--follow'] }]);
  expect(server.sends).toHaveLength(0);
  expect(server.mutations).toEqual([]);
});

test('phone suggestions should fit above the composer, scroll to every row, keep the keyboard open, and allow a one-tap send', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch keyboards use the mobile projects.');
  // Arrange
  const { server, workspace } = await open(page);
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.input().tap();
    await workspace.input().pressSequentially('/');
    await workspace.expectListUsable('Command');
    await workspace.capture(`${testInfo.project.name}-command-suggestions-${width}x${height}`);
    await workspace.option('Command', '/design-check').tap();
    await workspace.expectDraft('/design-check ');
    await expect(workspace.input()).toBeFocused();
    await workspace.input().pressSequentially(`at ${width}x${height}`);
    await workspace.watchSendFocus();
    await workspace.expectSendReachable();
    const count = server.sends.length;
    await workspace.sendButton().tap();
    await workspace.expectKeyboardDismissedAfterClick();
    await expect.poll(() => server.sends.length).toBe(count + 1);
    await workspace.expectDraft('');
    await workspace.expectNoPageOverflow();
    const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[count].content, server.dataKey);
    expect(message.content.text).toBe(`/design-check at ${width}x${height}`);
  }
});
