import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { MarkdownAppearancePage } from './pages/MarkdownAppearancePage';
import { defaultMarkdownAppearance, markdownBackgroundThemes, markdownElements, markdownTextThemes, type MarkdownAppearancePreferences } from '../src/data/markdownAppearance';
import { createMarkdownAppearanceDemo } from '../src/data/markdownAppearanceDemo';
import { createInitialState } from '../src/data/fixtures';

const separateThemes: MarkdownAppearancePreferences = {
  markdownBoldText: 'amber', markdownBoldBackground: 'blue',
  markdownQuoteText: 'emerald', markdownQuoteBackground: 'green',
  markdownLinkText: 'blue', markdownLinkBackground: 'purple',
};

for (const mode of ['live', 'demo']) {
  test(`Markdown presets should save each element independently and preserve drafts in ${mode} mode`, async ({ page }) => {
    test.setTimeout(60000);
    if (mode === 'live') {
      const server = new HappyServer();
      await server.install(page); await server.setWorking(false); server.sessions[0].agentState = null;
      await server.setMessages([{ role: 'session', content: { role: 'agent', turn: 'markdown-turn', ev: { t: 'text', text: createMarkdownAppearanceDemo().messages[0].content } } }]);
    } else await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
    const view = new MarkdownAppearancePage(page), session = mode === 'live' ? 'real-session' : 'markdown-appearance-demo';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/session/${session}`);
    await view.input().fill('Keep my draft through appearance changes');
    for (const text of markdownTextThemes.filter(theme => ['neutral', 'mauve', 'olive', 'mist', 'taupe', 'red', 'amber', 'emerald', 'indigo', 'violet', 'rose'].includes(theme.value))) {
      const themes = { ...defaultMarkdownAppearance };
      for (const element of markdownElements) {
        themes[element.textKey] = text.value;
        themes[element.backgroundKey] = markdownBackgroundThemes.find(theme => theme.value === text.value)!.value;
      }
      await page.goto('/settings/appearance');
      await view.choose(themes);
      await view.expectColors(view.preview(), themes);
      await page.goto(`/session/${session}`);
      await view.expectColors(view.sample(), themes);
      await expect(view.input()).toHaveValue('Keep my draft through appearance changes');
    }
    await page.goto('/settings/appearance');
    await view.choose(separateThemes);
    await page.reload();
    await view.expectChoices(separateThemes);
    await view.expectColors(view.preview(), separateThemes);
    await page.goto(`/session/${session}`);
    await view.expectColors(view.sample(), separateThemes);
    await expect(view.input()).toHaveValue('Keep my draft through appearance changes');
  });
}

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`Markdown settings and the demo should stay usable at ${width}x${height}`, async ({ page }, info) => {
    const view = new MarkdownAppearancePage(page);
    await page.setViewportSize({ width, height });
    await view.openDemo();
    await view.input().fill(`Draft at ${width}x${height}`);
    await view.openDemoSettings();
    await view.choose(separateThemes);
    await view.expectControlsUsable();
    await view.expectColors(view.preview(), separateThemes);
    await view.returnToDemo();
    await view.expectColors(view.sample(), separateThemes);
    await expect(view.input()).toHaveValue(`Draft at ${width}x${height}`);
    const link = view.sample().getByRole('link', { name: 'sample link', exact: true });
    await link.focus();
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await expect(link).toHaveAttribute('href', 'https://example.com');
    const copy = view.sample().getByRole('button', { name: 'Copy code', exact: true });
    await view.activate(copy);
    await expect(page.getByRole('status').filter({ hasText: /Copied to clipboard|Could not copy/ })).toBeVisible();
    await view.expectNoPageOverflow();
    if (width === 390 && height === 844) await view.capture(`${info.project.name}-markdown-presets`);
  });
}

test('Markdown demo should appear in older saved accounts without replacing sessions, drafts, or preferences', async ({ page }) => {
  const old = createInitialState(1);
  old.sessions = old.sessions.filter(session => session.id !== 'markdown-appearance-demo');
  old.preferences.bubble = 'rose';
  old.drafts['floating-panels'] = 'Keep this saved draft';
  old.newDraft.prompt = 'Keep this new task';
  const raw = JSON.parse(JSON.stringify(old));
  raw.preferences.markdownBoldText = 'sand'; raw.preferences.markdownBoldBackground = 'midnight';
  raw.preferences.markdownQuoteText = 'mint'; raw.preferences.markdownQuoteBackground = 'forest';
  raw.preferences.markdownLinkText = 'blue'; raw.preferences.markdownLinkBackground = 'plum';
  await page.addInitScript(state => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify(state));
  }, raw);
  const view = new MarkdownAppearancePage(page);
  await page.goto('/sessions?demo=1');
  await expect(view.sessionRow('Markdown appearance · Interactive demo')).toBeVisible();
  await view.sessionRow('Markdown appearance · Interactive demo').click();
  await expect(view.sample()).toBeVisible();
  await view.openDemoSettings();
  await view.expectChoices(separateThemes);
  await view.expectColors(view.preview(), separateThemes);
  await view.choose(defaultMarkdownAppearance);
  await view.expectColors(view.preview(), defaultMarkdownAppearance);
  await view.choose(separateThemes);
  await view.returnToDemo();
  await view.expectColors(view.sample(), separateThemes);
  await page.reload();
  await view.expectColors(view.sample(), separateThemes);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(saved.preferences.bubble).toBe('rose');
  expect(saved.drafts['floating-panels']).toBe('Keep this saved draft');
  expect(saved.newDraft.prompt).toBe('Keep this new task');
  expect(saved.sessions.some((session: { id: string }) => session.id === 'floating-panels')).toBe(true);
});

test('Markdown themes should apply to both chats and remain readable at both width limits', async ({ page }) => {
  const view = new MarkdownAppearancePage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await view.openDemo(); await view.openDemoSettings();
  await view.choose(separateThemes); await view.returnToDemo();
  await page.goto('/session/markdown-appearance-demo/side?demo=1');
  await view.activate(page.getByRole('button', { name: 'Start a side chat', exact: true }));
  const side = page.getByRole('region', { name: 'Side chat conversation', exact: true });
  await side.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare **bold emphasis**, a quote, and a link.');
  await view.activate(side.getByRole('button', { name: 'Send message', exact: true }));
  await expect(side.getByText(/simulated response/)).toBeVisible();
  const strong = side.locator('[data-markdown-content] strong').first();
  const mainStrong = view.sample().locator('strong').first();
  await expect(strong).toHaveCSS('color', await mainStrong.evaluate(element => getComputedStyle(element).color));
  await expect(strong).toHaveCSS('background-color', await mainStrong.evaluate(element => getComputedStyle(element).backgroundColor));
  for (const key of ['Home', 'End']) {
    await page.getByRole('separator', { name: 'Resize side chat', exact: true }).press(key);
    await view.expectColors(view.sample(), separateThemes);
    await view.expectNoPageOverflow();
    await view.input().fill(`Still editable at ${key}`);
    await expect(view.input()).toHaveValue(`Still editable at ${key}`);
  }
});
