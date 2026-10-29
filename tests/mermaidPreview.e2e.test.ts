import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { MermaidPage } from './pages/MermaidPage';

const flowchart = 'flowchart LR\n  A[讀取需求] --> B[建立計畫] --> C[編寫程式] --> D[測試與驗證] --> E[部署完成]';
const sequence = 'sequenceDiagram\n  participant User\n  participant Agent\n  User->>Agent: Review the workspace\n  Agent-->>User: Done';
const fence = (source: string) => '```mermaid\n' + source + '\n```';

test('Mermaid previews should load their renderer only when needed and preserve images during typing and replies', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const workspace = new MermaidPage(page);
  await workspace.openSession();
  expect(page.workers()).toHaveLength(0);
  expect((await workspace.loadedAssets()).some((name) => name.includes('mermaid.worker-'))).toBe(false);
  // Act
  await server.pushReply(fence(flowchart));
  await workspace.expectRendered();
  // Assert
  expect(page.workers()).toHaveLength(1);
  expect(await workspace.svg()).toContain('讀取需求');
  expect(await workspace.svg()).toContain('部署完成');
  await workspace.capture(`${testInfo.project.name}-mermaid-rendered`);
  await workspace.watchDiagram();
  await workspace.typeDraft('Keep typing while diagrams remain visible');
  await server.pushReply('An ordinary reply without another diagram');
  await workspace.expectDiagramUnchanged();
  await workspace.expectSource(flowchart);
  // Act / Assert
  for (const [width, height] of [[320,568], [360,640], [390,844], [430,932], [390,430], [844,390]]) {
    await page.setViewportSize({ width, height });
    if (width < 768) await workspace.expectPhoneDiagramUsable();
    await workspace.expectCompactChatHeader();
    await workspace.expectDraft('Keep typing while diagrams remain visible');
    await workspace.expectNoPageOverflow();
  }
  await workspace.diagram().scrollIntoViewIfNeeded();
  await workspace.capture(`${testInfo.project.name}-mermaid-phone`);
  // Act
  await server.pushReply(fence(sequence));
  await workspace.expectRendered(1);
  // Assert
  expect(await workspace.svg(1)).toContain('Review the workspace');
  expect(page.workers()).toHaveLength(1);
  expect(server.sends).toHaveLength(0);
});

test('unsupported Mermaid should retain readable source while normal code and untrusted labels stay isolated', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  const unsupported = 'pie title Unsupported\n  "A" : 42';
  const untrusted = 'flowchart TD\n A["&lt;script&gt;window.diagramExecuted=true&lt;/script&gt;"] --> B[Safe]';
  await server.setMessages([
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text:
      'From the real protocol\n\n```ts\nconst value = 42;\n```\n\n' + fence(unsupported) + '\n\n' + fence(untrusted),
    } } },
  ]);
  const workspace = new MermaidPage(page);
  await workspace.openSession();
  // Act / Assert
  await workspace.diagram().scrollIntoViewIfNeeded();
  await expect(workspace.preview().getByRole('status')).toHaveText('Diagram preview unavailable. Read the source below.');
  await workspace.expectSource(unsupported);
  await workspace.expectRendered(1);
  await expect(page.locator('pre code').filter({ hasText: 'const value = 42;' })).toHaveCount(1);
  await expect(workspace.previews().getByRole('region', { name: 'Mermaid diagram', exact: true })
    .locator('svg, script, iframe, object')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).diagramExecuted)).toBeUndefined();
  await workspace.expectNoPageOverflow();
  expect(server.sends).toHaveLength(0);
});

test('phone Mermaid previews should preserve text size and always offer full screen', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout check');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text:
      'From the real protocol\n\n' + fence(flowchart) + '\n\nNext:\n\n' + fence(sequence) } } },
  ]);
  const workspace = new MermaidPage(page);
  await workspace.openSession();
  await workspace.expectRendered();
  await workspace.expectRendered(1);
  for (const [width, height] of [[320,568], [360,640], [390,844], [430,932]]) {
    await page.setViewportSize({ width, height });
    // Assert
    await expect.poll(() => workspace.layout(0).then((value) => value.scrolls)).toBe(true);
    expect((await workspace.layout(0)).shown).toBeCloseTo(1, 2);
    await expect(workspace.expandButton(0)).toBeVisible();
    await expect(workspace.preview(0).getByText('Swipe for more', { exact: true })).toBeVisible();
    await expect(workspace.expandButton(1)).toBeVisible();
    const sequenceLayout = await workspace.layout(1);
    expect(sequenceLayout.shown).toBeCloseTo(1, 2);
    await workspace.expectTouchTarget(workspace.expandButton(0));
    await workspace.expectNoPageOverflow();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Act
  await workspace.expandButton(0).scrollIntoViewIfNeeded();
  await workspace.expandButton(0).tap();
  // Assert
  const viewer = workspace.viewer();
  await expect(viewer).toBeVisible();
  const natural = await workspace.image(0).evaluate((image: HTMLImageElement) => image.naturalWidth);
  await expect(viewer.getByText('150%', { exact: true })).toBeVisible();
  expect(await workspace.viewerImageWidth()).toBe(Math.round(natural * 1.5));
  for (const name of ['Zoom in', 'Zoom out', 'Fit diagram to screen', 'Close Mermaid diagram'])
    await workspace.expectTouchTarget(viewer.getByRole('button', { name, exact: true }));
  await workspace.capture(`${testInfo.project.name}-mermaid-viewer`);
  // Act
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  // Assert
  await expect(viewer.getByText('225%', { exact: true })).toBeVisible();
  const region = viewer.getByRole('region', { name: 'Full screen diagram', exact: true });
  await region.evaluate((element) => element.scrollBy({ left: 200 }));
  expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  // Act
  await viewer.getByRole('button', { name: 'Fit diagram to screen', exact: true }).tap();
  // Assert
  const fitted = await workspace.viewerImageWidth();
  const room = await region.evaluate((element) => element.clientWidth);
  expect(fitted).toBeLessThanOrEqual(room);
  expect(fitted).toBeGreaterThan(room - 40);
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 844, height: 390 });
  // Assert
  await expect.poll(async () => (await workspace.viewerImageWidth()) / natural).toBeGreaterThan(0.6);
  const landscapeRoom = await region.evaluate((element) => element.clientWidth);
  expect(await workspace.viewerImageWidth()).toBeLessThanOrEqual(landscapeRoom);
  await expect(viewer.getByRole('button', { name: 'Close Mermaid diagram', exact: true })).toBeInViewport();
  await expect(viewer.getByRole('button', { name: 'Zoom in', exact: true })).toBeInViewport();
  await workspace.capture(`${testInfo.project.name}-mermaid-viewer-landscape`);
  // Act
  await viewer.getByRole('button', { name: 'Close Mermaid diagram', exact: true }).tap();
  // Assert
  await expect(viewer).toHaveCount(0);
  await expect(workspace.expandButton(0)).toBeFocused();
  // Act
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace.expandButton(0).tap();
  await workspace.viewer().getByRole('button', { name: 'Close Mermaid diagram', exact: true }).tap();
  // Assert
  await expect(workspace.expandButton(0)).toBeFocused();
  expect(server.sends).toHaveLength(0);
});

test('desktop Mermaid previews should preserve text size and offer full screen', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout check');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages([
    { role: 'session', content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'From the real protocol\n\n' + fence(flowchart) } } },
  ]);
  const workspace = new MermaidPage(page);
  // Act
  await workspace.openSession();
  await workspace.expectRendered();
  // Assert
  await expect.poll(() => workspace.layout().then((value) => value.scrolls)).toBe(false);
  await expect(workspace.expandButton()).toBeVisible();
  await expect(workspace.preview().getByText('Swipe for more', { exact: true })).toHaveCount(0);
});

for (const [width, height] of [[320,568], [360,640], [390,844], [430,932], [390,360], [844,390]]) {
  test(`Mermaid demo - ${width}x${height} - should keep long diagrams readable and restore zoom`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Touch layout check');
    // Arrange
    await page.setViewportSize({ width, height });
    const workspace = new MermaidPage(page);
    await workspace.openReadingDemo();
    // Act / Assert
    await workspace.readLongDiagram();
    await workspace.readLongDiagram();
  });
}
