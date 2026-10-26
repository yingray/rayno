import { expect, test } from '@playwright/test';
import { ReplyOptionsDemoPage } from './pages/ReplyOptionsDemoPage';

for (const [width, height] of [[320, 568], [360, 640], [390, 844], [430, 932], [390, 360], [844, 390]]) {
  test(`reply options demo should let users select, deselect, edit, and manually send at ${width}x${height}`, async ({ page }, info) => {
    // Arrange
    await page.setViewportSize({ width, height });
    const demo = new ReplyOptionsDemoPage(page), touch = !!info.project.use.hasTouch;
    await demo.open();
    await demo.input().fill('My note');
    // Act / Assert
    await demo.expectReplyTargetsReachable();
    await demo.toggle('Check the mobile layout', touch);
    await demo.toggle('Add a regression test', touch);
    await demo.expectDraft('My note\nCheck the mobile layout\nAdd a regression test');
    await demo.expectUserMessages(0);
    await demo.toggle('Check the mobile layout', touch);
    await demo.expectDraft('My note\nAdd a regression test');
    await expect(demo.option('Check the mobile layout')).toHaveAttribute('aria-pressed', 'false');
    await expect(demo.option('Add a regression test')).toHaveAttribute('aria-pressed', 'true');
    if (touch) {
      await demo.input().press('Enter');
      await demo.input().pressSequentially('One more line');
      await demo.expectDraft('My note\nAdd a regression test\nOne more line');
      await demo.expectUserMessages(0);
    }
    await demo.sendDraft();
    await demo.expectDraft('');
    await demo.expectUserMessages(1);
    await expect(demo.option('Review the copy')).toBeEnabled();
    await demo.toggle('Review the copy', touch);
    await demo.expectDraft('Review the copy');
    await demo.toggle('Review the copy', touch);
    await demo.expectDraft('');
    await demo.expectUserMessages(1);
    await demo.expectNoPageOverflow();
    if (width === 390 && height === 844) await demo.capture(`${info.project.name}-reply-options-demo`);
  });
}

test('reply options demo should work with older saved data and preserve existing drafts', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    if (!localStorage.getItem('rayno.demo.v1')) localStorage.setItem('rayno.demo.v1', JSON.stringify({
      version: 1, sessions: [], preferences: {}, drafts: { untouched: 'Keep this draft' }, newDraft: {}, recentPaths: [],
    }));
  });
  const demo = new ReplyOptionsDemoPage(page);
  // Act / Assert
  await demo.open();
  await demo.toggle('Add a regression test', false);
  await demo.expectDraft('Add a regression test');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).drafts['reply-options-demo'])).toBe('Add a regression test');
  await page.reload();
  await demo.expectDraft('Add a regression test');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rayno.demo.v1')!).drafts.untouched)).toBe('Keep this draft');
  await expect(demo.option('Check the mobile layout')).toBeEnabled();
});


test('reply options demo should be discoverable from the session list', async ({ page }) => {
  // Arrange
  const demo = new ReplyOptionsDemoPage(page);
  await page.goto('/sessions?demo=1');
  // Act / Assert
  await expect(demo.sessionRow('Reply options · Interactive demo')).toBeVisible();
  await demo.openRow('Reply options · Interactive demo');
  await expect(demo.option('Check the mobile layout')).toBeVisible();
  await demo.toggle('Check the mobile layout', false);
  await demo.expectDraft('Check the mobile layout');
  await demo.expectUserMessages(0);
});
