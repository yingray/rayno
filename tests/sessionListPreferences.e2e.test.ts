import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { SessionListPreferencesPage } from './pages/SessionListPreferencesPage';

for (const mode of ['live', 'demo'] as const) {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932], [390, 360], [844, 390], [1440, 900]]) {
    test(`${mode} session list should retain both choices across navigation and reload at ${width}x${height}`, async ({ page }) => {
      const server = mode === 'live' ? new HappyServer() : undefined;
      if (server) await server.install(page);
      const list = new SessionListPreferencesPage(page, mode);
      await page.setViewportSize({ width, height });

      await list.exercisePersistence();

      if (server) { expect(server.sends).toEqual([]); expect(server.spawns).toEqual([]); }
    });
  }
}

test('session list should keep choices across responsive layouts and separate demo from the live account', async ({ page }) => {
  const server = new HappyServer();
  await server.install(page);
  const live = new SessionListPreferencesPage(page, 'live');
  const demo = new SessionListPreferencesPage(page, 'demo');
  await page.setViewportSize({ width: 1440, height: 900 });
  await live.openList();
  await live.activate(live.grouping('projects'));
  await live.activate(live.archiveToggle());

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(live.mainChat()).toHaveCount(0);
  await live.expectChoices('projects', true);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(live.mainChat()).toBeVisible();
  await live.expectChoices('projects', true);
  if (await live.sessionSearch().isVisible()) await live.closeSessionSearch();
  const drawer = page.getByRole('dialog', { name: 'Sessions', exact: true });
  if (await drawer.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(live.separator('sessions')).toBeVisible();
  await live.expectChoices('projects', true);
  await demo.openList();
  await demo.expectChoices('flat', false);
  await demo.activate(demo.grouping('projects'));
  await demo.reloadAndExpect('projects', false);
  await live.openList();
  await live.expectChoices('projects', true);
  await live.activate(live.grouping('flat'));
  await demo.openList();
  await demo.expectChoices('projects', false);
  await live.openList();
  await live.expectChoices('flat', true);
});
