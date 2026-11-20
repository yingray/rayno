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
    for (const model of ['GPT-6.2 Sol', 'GPT-6.2 Astra', 'GPT-6.1 Terra']) {
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
    await demo.chooseModel('GPT-6.2 Astra');
    await demo.chooseEffort('Ultra');
    await demo.closeModelSettings();
    await demo.sendExample();
    await page.reload();
    await demo.openModelSettings();
    await demo.expectSelection('GPT-6.2 Astra', 'Ultra');
    await demo.closeModelSettings();
    await demo.expectNoPageOverflow();
  });
}

for (const existingDemo of [false, true]) {
  test(`model demo should migrate older saved data with existing demo ${existingDemo} and preserve user choices`, async ({ page }) => {
    // Arrange
    const demo = new ModelSelectionDemoPage(page);
    await demo.open();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('rayno.demo.v1'))).toBeTruthy();
    const previous = await page.evaluate((existingDemo) => {
      const key = 'rayno.demo.v1';
      const saved = JSON.parse(localStorage.getItem(key)!);
      if (existingDemo) {
        const demo = saved.sessions.find((session: { id: string }) => session.id === 'model-selection-demo');
        demo.model = 'gpt-6.1-sol';
        demo.effort = 'max';
        demo.messages[0].content = '### Try model and effort selection\n\nTry GPT-6.1 Sol.';
        demo.messages.push({ id: 'saved-message', role: 'user', content: 'Keep this message' });
      } else saved.sessions = saved.sessions.filter((session: { id: string }) => session.id !== 'model-selection-demo');
      saved.drafts.untouched = 'Keep this draft';
      saved.newDraft.prompt = 'Keep this new session';
      saved.modelChoices = { Codex: { model: 'gpt-6-astra', effort: 'high' } };
      saved.drafts['model-selection-demo'] = 'Keep this model demo draft';
      localStorage.setItem(key, JSON.stringify(saved));
      return { sessionIds: saved.sessions.map((session: { id: string }) => session.id), preferences: saved.preferences };
    }, existingDemo);
    // Act
    await demo.open();
    await page.goto('/sessions?demo=1');
    await demo.searchSessions('Model & effort');
    await demo.openRow('Model & effort · Interactive demo');
    // Assert
    await expect(page.getByRole('heading', { name: 'Try model and effort selection', exact: true })).toBeVisible();
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!));
    expect(restored.sessions.map((session: { id: string }) => session.id)).toEqual(existingDemo ? previous.sessionIds : [...previous.sessionIds, 'model-selection-demo']);
    const modelDemo = restored.sessions.find((session: { id: string }) => session.id === 'model-selection-demo');
    expect(modelDemo.messages[0].content).toContain('GPT-6.2 Sol');
    expect(modelDemo.messages[0].content).toContain('GPT-6.2 Astra');
    if (existingDemo) {
      expect(modelDemo).toMatchObject({ model: 'gpt-6.1-sol', effort: 'max' });
      expect(modelDemo.messages).toContainEqual({ id: 'saved-message', role: 'user', content: 'Keep this message' });
    }
    expect(restored.drafts['model-selection-demo']).toBe('Keep this model demo draft');
    expect(restored.drafts.untouched).toBe('Keep this draft');
    expect(restored.newDraft.prompt).toBe('Keep this new session');
    expect(restored.preferences).toEqual(previous.preferences);
    expect(restored.modelChoices.Codex).toEqual({ model: 'gpt-6-astra', effort: 'high' });
    await demo.openModelSettings();
    await demo.chooseModel('GPT-6.2 Sol');
    await demo.chooseEffort('Max');
    await demo.expectSelection('GPT-6.2 Sol', 'Max');
    await demo.closeModelSettings();
  });
}
