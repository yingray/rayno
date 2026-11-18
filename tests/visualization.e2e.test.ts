import { expect, test } from '@playwright/test';
import { visualizationReference } from '../src/data/visualizationReferences';
import { loadDemoVisualization } from '../src/data/visualizationDemoData';
import { HappyServer } from './fixtures/HappyServer';
import { VisualizationPage } from './pages/VisualizationPage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`chart demo should select both charts’ points and reopen at ${width}x${height}`, async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const demo = new VisualizationPage(page);
    await demo.openDemo();
    // Act / Assert
    await demo.openChart();
    await expect(demo.plot('Intelligence Index v5.0.1')).toBeVisible();
    await demo.tapPoint(3);
    await demo.expectValues('0.9', '50');
    await demo.choosePoint(6);
    await demo.expectValues('1.53', '49');
    await demo.expectLayout();
    await demo.closeChart();
    await demo.openChart();
    await demo.choosePoint(1);
    await demo.expectValues('0.57', '45');
    await demo.closeChart();
  });
}

test('an older demo account should find the chart in its session list and keep its draft', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [], preferences: {}, drafts: { untouched: 'Keep this draft' }, newDraft: {}, recentPaths: [],
    }));
  });
  const demo = new VisualizationPage(page);
  // Act / Assert
  await demo.openDemo();
  await page.goto('/sessions?demo=1');
  await demo.searchSessions('Chart preview');
  await demo.openRow('Chart preview · Interactive demo');
  await demo.openChart();
  await expect(demo.plot()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).drafts.untouched)).toBe('Keep this draft');
});

test('a live chart should load workspace data on demand and reopen from the encrypted cache', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const path = '/real/project/.performance/visualizations/codex-cost-vs-score.html';
  server.localImages.set(path, new TextEncoder().encode(loadDemoVisualization()
    + '<p>Chart markup example</p><script>document.title = "Chart script example"</script><img src="/chart-example.png">'));
  const text = 'Chart results\n\n' + visualizationReference({ path, title: 'Codex cost vs. score' });
  await server.setMessages([{ role: 'session', content: { role: 'agent', turn: 'chart-turn', ev: { t: 'text', text } } }]);
  const workspace = new VisualizationPage(page);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/session/real-session');
  await workspace.expectConnected();
  await expect(workspace.openButton()).toBeVisible();
  expect(server.localImageReads).toEqual([]);
  // Act
  await workspace.openChart();
  await workspace.choosePoint(3);
  await workspace.expectValues('0.9', '50');
  // Assert
  expect(server.localImageReads).toEqual([path]);
  expect(server.uploadRequests).toEqual([]);
  expect(requests.some(url => url.endsWith('/chart-example.png'))).toBe(false);
  await expect(page).not.toHaveTitle('Chart script example');
  await expect(page.getByText('Chart markup example')).toHaveCount(0);
  expect((await workspace.offlineRecords()).every(record => !record.value.includes('Coding Agent Index'))).toBe(true);
  await workspace.closeChart();
  await workspace.setNetwork(false);
  await page.reload();
  await workspace.openChart();
  await workspace.choosePoint(3);
  await workspace.expectValues('0.9', '50');
  expect(server.localImageReads).toEqual([path]);
});

test('a reference outside the workspace should offer an error without reading the file', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const text = visualizationReference({ path: '/elsewhere/chart.html', title: 'Codex cost vs. score' });
  await server.setMessages([{ role: 'session', content: { role: 'agent', turn: 'chart-turn', ev: { t: 'text', text } } }]);
  const workspace = new VisualizationPage(page);
  await page.goto('/session/real-session');
  await workspace.expectConnected();
  // Act / Assert
  await workspace.openChart();
  await expect(workspace.viewer().getByRole('alert')).toContainText('HTML file in this session’s workspace');
  expect(server.localImageReads).toEqual([]);
});
