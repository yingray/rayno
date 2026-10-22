import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

// happy-cli SDKToLogConverter stamps the model's window onto assistant usage after the first result.
const claudeReply = (text: string, usage: Record<string, number>) => ({
  role: 'agent',
  content: { type: 'output', data: {
    type: 'assistant', uuid: crypto.randomUUID(), parentUuid: null, isSidechain: false,
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], usage },
  } },
});
// The Codex token_count mapper sends a turn-less service envelope that carries only usage.
const usageOnly = (usage: Record<string, number>) => ({
  role: 'session',
  content: { id: crypto.randomUUID(), time: Date.now(), role: 'agent', usage, ev: { t: 'service', text: '' } },
});

test('Model & effort should show the context use, and the composer should warn only near the limit', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([
    { role: 'user', content: { type: 'text', text: 'Check the build' }, meta: { sentFrom: 'web' } },
    claudeReply('First pass', { input_tokens: 900, output_tokens: 20 }),
    claudeReply('From the real protocol', {
      input_tokens: 4000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 78000,
      output_tokens: 600, context_window: 200000,
    }),
  ]);
  const workspace = new LiveWorkspacePage(page);
  // Act
  await workspace.openSession();
  // Assert
  await expect(workspace.contextWarning()).toHaveCount(0);
  // Act
  await workspace.openModelSettings();
  // Assert
  await expect(workspace.contextMeter()).toHaveAttribute('aria-valuenow', '42');
  await expect(workspace.contextMeter()).toHaveText(/42% used\s*84k \/ 200k tokens/);
  await expect(workspace.contextMeter()).not.toHaveAttribute('data-tone');
  await workspace.expectContextMeterFits();
  await workspace.capture(`${testInfo.project.name}-context-usage`);
  // Act
  await server.pushEvent(usageOnly({ input_tokens: 182000, output_tokens: 300, context_window: 200000 }));
  // Assert
  await expect(workspace.contextMeter()).toHaveAttribute('aria-valuenow', '91');
  await expect(workspace.contextMeter()).toHaveAttribute('data-tone', 'warning');
  // Act
  await page.getByRole('dialog', { name: 'Model & effort' }).getByRole('button', { name: 'Done', exact: true }).click();
  // Assert
  await expect(workspace.contextWarning()).toHaveAttribute('data-tone', 'warning');
  await expect(workspace.contextWarning()).toHaveText(/91% context\s*182k \/ 200k/);
  await expect(page.getByText('First pass', { exact: true })).toBeVisible();
  await workspace.expectContextWarningFits();
  await workspace.capture(`${testInfo.project.name}-context-warning`);
  // Act
  await server.pushEvent({ role: 'agent', content: { id: crypto.randomUUID(), type: 'event', data: { type: 'message', message: 'Context was reset' } } });
  // Assert
  await expect(workspace.contextWarning()).toHaveCount(0);
  // Act
  await workspace.openModelSettings();
  // Assert
  await expect(workspace.contextMeter()).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Model & effort' }).getByRole('heading', { name: 'Context', exact: true })).toHaveCount(0);
});

const sizes = [[320, 568], [360, 640], [390, 844], [430, 932], [390, 420], [844, 390]];

test('the context warning should stay below the composer on phones, short screens, and landscape', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([
    claudeReply('From the real protocol', { input_tokens: 190000, output_tokens: 600, context_window: 200000 }),
  ]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  for (const [width, height] of sizes) {
    // Act
    await page.setViewportSize({ width, height });
    await input.focus();
    await input.fill('A draft that wraps onto a second line on the narrowest phone screens');
    // Assert
    await expect(workspace.contextWarning()).toHaveAttribute('data-tone', 'critical');
    await expect(workspace.contextWarning()).toBeInViewport();
    await workspace.expectContextWarningFits();
  }
});

test('the context meter should fit the Model & effort sheet on phones, short screens, and landscape', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setMessages([
    claudeReply('From the real protocol', { input_tokens: 190000, output_tokens: 600, context_window: 200000 }),
  ]);
  const workspace = new LiveWorkspacePage(page);
  await workspace.openSession();
  await workspace.openModelSettings();
  for (const [width, height] of sizes) {
    // Act
    await page.setViewportSize({ width, height });
    // Assert
    await expect(workspace.contextMeter()).toHaveAttribute('data-tone', 'critical');
    await workspace.expectContextMeterFits();
  }
});
