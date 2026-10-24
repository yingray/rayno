import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { InvocationsPage } from './pages/InvocationsPage';

test('invocations should show command and skill names with usable details across viewports', async ({ page }, testInfo) => {
  // Arrange: the command and meta prompt follow the design-sync JSONL record format.
  const server = new HappyServer();
  await server.install(page);
  const output = (data: object) => ({ role: 'agent', content: { type: 'output', data } });
  const command = '<command-message>design-sync</command-message>\n<command-name>/design-sync</command-name>';
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Earlier context' } },
    output({ type: 'user', uuid: 'command', message: { role: 'user', content: command } }),
    output({ type: 'user', uuid: 'meta', isMeta: true, message: { role: 'user', content: 'Base directory for this skill: /private/skills/design-sync\nHidden skill instructions' } }),
    { role: 'user', content: { type: 'text', text: 'Explain ' + command } },
    { role: 'user', content: { type: 'text', text: '<command-message>unfinished' } },
    { role: 'user', content: { type: 'text', text: '<command-message>review</command-message>\n<command-name>/engineering-suite:review</command-name>\n<command-args>--scope frontend</command-args>\nKeep this follow-up' } },
    output({ type: 'assistant', uuid: 'skill', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'skill-call', name: 'Skill', input: { skill: 'engineering-suite:review', args: '--scope frontend' } },
    ] } }),
    output({ type: 'user', uuid: 'result', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'skill-call', content: 'Skill instructions loaded.' },
    ] } }),
    output({ type: 'assistant', uuid: 'reply', message: { role: 'assistant', content: [
      { type: 'text', text: 'From the real protocol' },
    ] } }),
  ]);
  const view = new InvocationsPage(page);
  await view.openSession();

  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
    // Act: read the calls with tool activity collapsed, then open and close the skill details.
    await page.setViewportSize({ width, height });
    await view.collapseTools();
    await expect(view.skill()).toBeVisible();
    await expect(view.skill()).toHaveText('Skillengineering-suite:review');
    await view.command().first().scrollIntoViewIfNeeded();
    await expect(view.command().first()).toHaveText('Command/design-sync');
    await expect(view.command()).toHaveCount(2);
    await expect(view.userMessage('--scope frontend')).toContainText('Keep this follow-up');
    await expect(view.userMessage('Explain')).toContainText(command);
    await expect(view.userMessage('unfinished')).toContainText('<command-message>unfinished');
    await expect(page.getByText('Hidden skill instructions', { exact: false })).toHaveCount(0);
    const row = await view.openTool('Skill · engineering-suite:review');

    // Assert: the call keeps its arguments and result, and controls remain reachable.
    await expect(row).toContainText('--scope frontend');
    await expect(row).toContainText('Skill instructions loaded.');
    await view.toggleSkill();
    await expect(row).not.toHaveAttribute('open', '');
    await view.expectNoPageOverflow();
    if (width === 320) await view.capture(`${testInfo.project.name}-invocations-320`);
  }
});
