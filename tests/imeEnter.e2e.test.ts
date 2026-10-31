import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

// Safari order for the Enter that confirms a Zhuyin choice: compositionend first, then a keydown with isComposing false.
async function confirmChoiceLikeSafari(field: Locator, text: string) {
  await field.evaluate((element, value) => {
    const area = element as HTMLTextAreaElement;
    area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(area, area.value + value);
    area.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertCompositionText' }));
    area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    area.dispatchEvent(enter);
    area.dataset.enterPrevented = String(enter.defaultPrevented);
  }, text);
}

test('chat composer should keep the draft when Enter confirms a Zhuyin choice', async ({ page }, testInfo) => {
  // Arrange
  await page.goto('/session/floating-panels?demo=1');
  const field = page.getByRole('textbox', { name: 'Message', exact: true });
  await field.click();
  // Act
  await confirmChoiceLikeSafari(field, '換行測試');
  // Assert
  await expect(field).toHaveValue('換行測試');
  await expect(field).toHaveAttribute('data-enter-prevented', 'true');
  await page.waitForTimeout(300);
  await expect(field).toHaveValue('換行測試');
  test.skip(!!testInfo.project.use.hasTouch, 'Return always adds a line on touch keyboards.');
  // Act
  await page.waitForTimeout(150);
  await field.press('Shift+Enter');
  await field.pressSequentially('second line');
  // Assert
  await expect(field).toHaveValue('換行測試\nsecond line');
  // Act
  await field.press('Enter');
  // Assert
  await expect(field).toHaveValue('');
  await expect(page.getByText('second line')).toBeVisible();
});

test('new session task should not start when Enter confirms a Zhuyin choice', async ({ page }, testInfo) => {
  // Arrange
  await page.goto('/new?demo=1');
  const field = page.getByRole('textbox', { name: 'Task description' });
  await field.click();
  // Act
  await confirmChoiceLikeSafari(field, '整理換行');
  // Assert
  await expect(field).toHaveAttribute('data-enter-prevented', 'true');
  await expect(page).toHaveURL(/\/new/);
  await expect(field).toHaveValue('整理換行');
  test.skip(!!testInfo.project.use.hasTouch, 'Return always adds a line on touch keyboards.');
  // Act
  await page.waitForTimeout(150);
  await field.press('Shift+Enter');
  await field.pressSequentially('second line');
  // Assert
  await expect(field).toHaveValue('整理換行\nsecond line');
  await expect(page).toHaveURL(/\/new/);
});
