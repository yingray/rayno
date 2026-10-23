import { expect, test } from '@playwright/test';
import { HappyServer } from '../tests/fixtures/HappyServer';
import { toolHeavyHistory } from '../tests/fixtures/toolHeavyHistory';
import { RecapPage } from '../tests/pages/RecapPage';
import { ScalingPage } from './ScalingPage';
import { PerformancePage } from '../tests/pages/PerformancePage';
import { mkdir, writeFile } from 'node:fs/promises';

test('chat probe should report phone interactions and touch targets across viewports', async ({ page }, info) => {
  test.skip(!info.project.use.isMobile, 'A phone probe for the isolated benchmark builds.');
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  await server.setWorking(false);
  await server.setMessages(toolHeavyHistory(600));
  const view = new ScalingPage(page), controls = new PerformancePage(page), recap = new RecapPage(page);
  await view.openSession();
  await view.loadHistory();
  const samples = [];
  // Act / Assert
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await controls.input().fill(`Phone draft ${width}x${height}`);
    await controls.expectSendReachable();
    const group = controls.messages().locator('[data-tool-activity]').last();
    const toggle = group.locator(':scope > button');
    await recap.centerInList(toggle);
    const toolTarget = await view.touchTarget(toggle);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = group.locator('details').first();
    const summary = detail.locator('summary').first();
    await recap.centerInList(summary);
    await summary.tap();
    await expect(detail).toHaveAttribute('open', '');
    await recap.centerInList(summary);
    await summary.tap();
    await expect(detail).not.toHaveAttribute('open');
    await recap.centerInList(toggle);
    await toggle.tap();
    await controls.readHistory();
    await controls.returnToLatest();
    const text = `Phone reply ${width}x${height}`;
    await view.armReply(text);
    await server.pushReply(text);
    const reply = await view.replySample();
    expect(reply.bottomGap).toBeLessThan(4);
    await controls.expectNoPageOverflow();
    samples.push({ width, height, toolTarget, ...reply });
  }
  await controls.sendButton().tap();
  await expect(controls.input()).toHaveValue('');
  expect(server.sends).toHaveLength(1);
  // The tail omits loaded history. This is a measured limitation, not a production acceptance check.
  const tail = process.env.RAYNO_BENCH_VARIANT === 'tail';
  await expect(page.getByText('Task 1: check the build', { exact: true })).toHaveCount(tail ? 0 : 1);
  await info.attach('phone-tail-controls', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  const result = { phone: true, browser: info.project.name, variant: tail ? 'tail' : 'full', samples };
  await mkdir('.performance/samples', { recursive: true });
  await writeFile(`.performance/samples/phone-${result.variant}-${info.project.name}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log('PHONE_TAIL_CONTROLS ' + JSON.stringify(result));
});
