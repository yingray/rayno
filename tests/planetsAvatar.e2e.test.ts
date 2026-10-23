import { expect, test, type Locator } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';

class PlanetsPage extends PriorityFeaturesPage {
  avatarStyle() { return this.page.getByRole('combobox', { name: 'Avatar style', exact: true }); }
  planet(scope: Locator) { return scope.locator('[data-avatar-style="planets"] img'); }
  headerPlanet() { return this.planet(this.page.getByRole('button', { name: 'Open session info', exact: true })); }
  async expectLoaded(image: Locator, source?: string) {
    await expect(image).toHaveAttribute('src', source || /^data:image\/svg\+xml/);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  }
  async activate(control: Locator) {
    await control.scrollIntoViewIfNeeded();
    if (await this.page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
    else await control.click();
  }
  async selectPlanets() {
    await this.page.goto('/settings/appearance');
    await this.avatarStyle().selectOption('planets');
  }
}

for (const mode of ['live', 'demo']) test(`Planets should identify sessions consistently across views, renames, and reloads in ${mode} mode`, async ({ page }) => {
  let server: HappyServer | undefined;
  if (mode === 'live') {
    server = new HappyServer(); await server.install(page); await server.setWorking(false);
    await server.addSession('peer-session', { flavor: 'claude', summary: { text: 'Another Claude workspace' } });
  } else await page.addInitScript(() => localStorage.setItem('rayno.mode', 'demo'));
  let external = 0;
  page.on('request', request => { if (new URL(request.url()).hostname.endsWith('dicebear.com')) external++; });
  const view = new PlanetsPage(page);
  const title = mode === 'live' ? 'Connected workspace' : 'Build the floating panels layout';
  const peer = mode === 'live' ? 'Another Claude workspace' : 'Review the webhook retry strategy and API contract';
  const session = mode === 'live' ? 'real-session' : 'floating-panels';
  await view.selectPlanets();
  await page.reload();
  await expect(view.avatarStyle()).toHaveValue('planets');
  await page.goto('/sessions');
  const image = view.planet(view.sessionRow(title));
  await view.expectLoaded(image);
  const source = (await image.getAttribute('src'))!;
  const other = view.planet(view.sessionRow(peer));
  await view.expectLoaded(other);
  expect(await other.getAttribute('src')).not.toBe(source);
  await view.openRow(title);
  await view.expectLoaded(view.headerPlanet(), source);
  await view.info();
  const details = page.getByRole('region', { name: 'Session details', exact: true });
  await view.expectLoaded(view.planet(details), source);
  await view.rename('Renamed planet session');
  await view.expectLoaded(view.planet(details), source);
  await view.closeInfo();
  await page.reload();
  await view.expectLoaded(view.headerPlanet(), source);
  if (mode === 'live') {
    await expect.poll(async () => (await view.offlineRecords()).some(record => record.key.endsWith(`history.${session}`))).toBe(true);
    await view.setNetwork(false);
    await page.reload();
    await view.expectLoaded(view.headerPlanet(), source);
    await expect(view.availability('Conversation')).toContainText('Offline');
    await view.setNetwork(true);
  }
  await page.goto('/settings/appearance');
  await view.avatarStyle().selectOption('initials');
  await page.goto(`/session/${session}`);
  await expect(page.getByRole('button', { name: 'Open session info', exact: true }).locator('[data-avatar-style="initials"]')).toBeVisible();
  await page.goto('/settings/appearance'); await view.avatarStyle().selectOption('provider');
  await page.goto(`/session/${session}`);
  await expect(page.getByRole('button', { name: 'Open session info', exact: true }).locator('img')).toHaveAttribute('src', '/icons/claude.png');
  expect(external).toBe(0);
});

test('Planets should fit phone settings and session controls while agent choices retain their provider marks', async ({ page }, info) => {
  const server = new HappyServer(); await server.install(page); await server.setWorking(false);
  const view = new PlanetsPage(page);
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await view.selectPlanets();
    await view.avatarStyle().scrollIntoViewIfNeeded();
    await view.expectTouchTarget(view.avatarStyle());
    await expect(view.avatarStyle()).toHaveCSS('font-size', '16px');
    await view.avatarStyle().focus();
    await expect(view.avatarStyle()).toHaveCSS('outline-width', '1px');
    await view.expectNoPageOverflow();
    await page.goto('/session/real-session');
    await view.expectLoaded(view.headerPlanet());
    const source = (await view.headerPlanet().getAttribute('src'))!;
    await view.info();
    await view.expectLoaded(view.planet(page.getByRole('region', { name: 'Session details', exact: true })), source);
    await view.closeInfo();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill(`Message beside a planet at ${width}x${height}`);
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    if (width < 768 || info.project.use.hasTouch) await view.expectTouchTarget(send);
    await view.activate(send); await expect(input).toHaveValue('');
    await view.expectNoPageOverflow();
    if (width === 390 && height === 844) await view.capture(`${info.project.name}-planets-avatar-390`);
  }
  await page.goto('/new');
  const form = page.getByRole('region', { name: 'Create session', exact: true });
  await expect(form.locator('[data-avatar-style="planets"]')).toHaveCount(0);
  await expect(form.locator('[data-avatar-style="provider"]').first()).toBeVisible();
  expect(server.sends).toHaveLength(7);
});
