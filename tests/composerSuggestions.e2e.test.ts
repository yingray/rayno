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

test('slash command suggestions should follow the keyboard and insert the command without a send', async ({ page }, info) => {
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
  await workspace.input().press(info.project.use.hasTouch ? 'Tab' : 'Enter');
  // Assert
  await workspace.expectDraft('/pr-review ');
  await expect(workspace.suggestions('Command')).toHaveCount(0);
  expect(server.sends).toHaveLength(0);
  // Act
  await workspace.input().pressSequentially('now');
  if (info.project.use.hasTouch) await workspace.sendButton().tap();
  else await workspace.input().press('Enter');
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

test('picking a command that is already complete should close the list and keep later typing at the caret', async ({ page }, info) => {
  // Arrange
  const { server, workspace } = await open(page);
  await workspace.input().click();
  await workspace.input().pressSequentially('/compact now');
  for (let index = 0; index < 4; index++) await workspace.input().press('ArrowLeft');
  await workspace.expectSelected('Command', '/compact');
  // Act
  await workspace.input().press(info.project.use.hasTouch ? 'Tab' : 'Enter');
  // Assert
  await expect(workspace.suggestions('Command')).toHaveCount(0);
  await workspace.expectDraft('/compact now');
  // Act
  for (let index = 0; index < 4; index++) await workspace.input().press('ArrowRight');
  await workspace.input().pressSequentially('er');
  // Assert
  await workspace.expectDraft('/compact nower');
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
  await workspace.input().press(touch ? 'Tab' : 'Enter');
  // Assert
  await workspace.expectDraft('Read @src/app/app.module.css and @src/components/Panel.tsx ');
  expect(server.ripgrepCalls).toEqual([{ args: ['--files', '--follow'] }]);
  expect(server.sends).toHaveLength(0);
  expect(server.mutations).toEqual([]);
});

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 430], [844, 390]]) {
  test(`phone suggestions should fit above the composer at ${width}x${height}, scroll to every row, keep the keyboard open, and allow a one-tap send`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch keyboards use the mobile projects.');
    // Arrange
    const { server, workspace } = await open(page);
    await page.setViewportSize({ width, height });
    await workspace.input().tap();
    // Act
    await workspace.input().pressSequentially('/');
    // Assert
    await workspace.expectListUsable('Command');
    await workspace.capture(`${testInfo.project.name}-command-suggestions-${width}x${height}`);
    // Act
    await workspace.option('Command', '/design-check').tap();
    // Assert
    await workspace.expectDraft('/design-check ');
    await expect(workspace.input()).toBeFocused();
    // Act
    await workspace.input().pressSequentially(`at ${width}x${height}`);
    await workspace.watchSendFocus();
    await workspace.expectSendReachable();
    await workspace.sendButton().tap();
    // Assert
    await workspace.expectKeyboardDismissedAfterClick();
    await expect.poll(() => server.sends.length).toBe(1);
    await workspace.expectDraft('');
    await workspace.expectNoPageOverflow();
    const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[0].content, server.dataKey);
    expect(message.content.text).toBe(`/design-check at ${width}x${height}`);
  });
}


test('touch composer should insert lines with Enter and send the full draft with the button at phone sizes', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'Touch keyboard behavior.');
  // Arrange
  const { server, workspace } = await open(page);
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.input().fill('First line');
    await expect(workspace.input()).toHaveAttribute('enterkeyhint', 'enter');
    const sent = server.sends.length;
    await workspace.input().press('Enter');
    await workspace.input().pressSequentially('Second line');
    await workspace.expectDraft('First line\nSecond line');
    expect(server.sends).toHaveLength(sent);
    await expect(workspace.input()).toHaveCSS('font-size', '16px');
    await expect(workspace.sendButton()).toHaveCSS('transform', 'none');
    await workspace.expectSendReachable();
    await workspace.sendButton().tap();
    await workspace.expectDraft('');
    await expect.poll(() => server.sends.length).toBe(sent + 1);
    const message = await server.encryption.decrypt<{ content: { text: string } }>(server.sends[sent].content, server.dataKey);
    expect(message.content.text).toBe('First line\nSecond line');
    await workspace.expectNoPageOverflow();
  }
  // Enter must also insert a line when a suggestion is selected.
  await workspace.input().fill('/pr');
  await workspace.expectSelected('Command', '/pr-review');
  await workspace.input().press('Enter');
  await workspace.expectDraft('/pr\n');
  expect(server.sends).toHaveLength(6);
});


test('desktop composer should keep Shift+Enter for lines and Control+Enter for send', async ({ page }, info) => {
  test.skip(!!info.project.use.hasTouch, 'Desktop keyboard shortcuts.');
  // Arrange
  const { server, workspace } = await open(page);
  await workspace.input().fill('First line');
  // Act / Assert
  await workspace.input().press('Shift+Enter');
  await workspace.input().pressSequentially('Second line');
  await workspace.expectDraft('First line\nSecond line');
  expect(server.sends).toHaveLength(0);
  await workspace.input().press('Control+Enter');
  await workspace.expectDraft('');
  await expect.poll(() => server.sends.length).toBe(1);
});
