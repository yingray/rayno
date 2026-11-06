import { expect, test } from '@playwright/test';
import { ModelSelectionDemoPage } from './pages/ModelSelectionDemoPage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`model demo should retain supported choices after a send and reload at ${width}x${height}`, async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const demo = new ModelSelectionDemoPage(page);
    await demo.open();
    // Act / Assert
    await demo.openModelSettings();
    for (const model of ['GPT-6.1 Sol', 'GPT-6.1 Terra', 'GPT-6 Sol']) {
      await demo.chooseModel(model);
      await demo.chooseEffort('Max');
      await demo.expectSelection(model, 'Max');
      await demo.chooseEffort('Ultra');
      await demo.expectSelection(model, 'Ultra');
    }
    await demo.chooseModel('GPT-6 Luna');
    await expect(demo.effortRadio('Ultra')).toHaveCount(0);
    await demo.chooseEffort('Max');
    await demo.expectSelection('GPT-6 Luna', 'Max');
    await demo.closeModelSettings();
    await demo.sendExample();
    await page.reload();
    await demo.openModelSettings();
    await demo.expectSelection('GPT-6 Luna', 'Max');
    await demo.chooseModel('GPT-6.1 Sol');
    await demo.chooseEffort('Ultra');
    await demo.closeModelSettings();
    await demo.openModelSettings();
    await demo.expectSelection('GPT-6.1 Sol', 'Ultra');
    await demo.closeModelSettings();
    await demo.expectNoPageOverflow();
  });
}

test('model demo should migrate older saved data and remain discoverable without replacing user choices', async ({ page }) => {
  // Arrange
  const demo = new ModelSelectionDemoPage(page);
  await demo.open();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rayno.demo.v1'))).toBeTruthy();
  const previous = await page.evaluate(() => {
    const key = 'rayno.demo.v1';
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.sessions = saved.sessions.filter((session: { id: string }) => session.id !== 'model-selection-demo');
    saved.drafts.untouched = 'Keep this draft';
    saved.newDraft.prompt = 'Keep this new session';
    saved.modelChoices = { Codex: { model: 'gpt-6-astra', effort: 'high' } };
    localStorage.setItem(key, JSON.stringify(saved));
    return { sessionIds: saved.sessions.map((session: { id: string }) => session.id), preferences: saved.preferences };
  });
  // Act
  await demo.open();
  await page.goto('/sessions?demo=1');
  await demo.searchSessions('Model & effort');
  await demo.openRow('Model & effort · Interactive demo');
  // Assert
  await expect(page.getByRole('heading', { name: 'Try model and effort selection', exact: true })).toBeVisible();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
  expect(restored.sessions.map((session: { id: string }) => session.id)).toEqual([...previous.sessionIds, 'model-selection-demo']);
  expect(restored.drafts.untouched).toBe('Keep this draft');
  expect(restored.newDraft.prompt).toBe('Keep this new session');
  expect(restored.preferences).toEqual(previous.preferences);
  expect(restored.modelChoices.Codex).toEqual({ model: 'gpt-6-astra', effort: 'high' });
});
