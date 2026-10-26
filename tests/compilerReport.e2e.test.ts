import { expect, test } from '@playwright/test';
import { CompilerReportPage } from './pages/CompilerReportPage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`compiler report should open without sign-in and support sample disclosure and download at ${width}x${height}`, async ({ page }, info) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const report = new CompilerReportPage(page), touch = !!info.project.use.hasTouch;
    // Act / Assert
    await report.open();
    await report.expectReadable(width);
    await report.expandSamples(touch);
    await report.downloadData(touch);
    const data = await page.request.get('/reports/react-compiler-paired.json');
    expect(data.ok()).toBe(true);
    expect(await data.json()).toMatchObject({ baseCommit: '8400406', compilerVersion: '1.0.0', date: '2026-10-26', method: { sessions: 128 } });
    await report.expectNoPageOverflow();
    if (width === 390 && height === 844) await report.capture(`${info.project.name}-compiler-report`);
  });
}
