import { expect, test } from '@playwright/test';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import { HappyServer } from './fixtures/HappyServer';

const customHost = 'happy.example.com';
// Base64 of 32 bytes with the value 7: a valid recovery key format.
const recoveryKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

test('a custom Happy server should be checked on blur and stay after sign-out', async ({ page }) => {
  // Arrange
  let authHost = '';
  await page.route(/^https:\/\/[^/]+\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/auth') {
      authHost = url.host;
      return route.fulfill({ json: { token: 'custom-token' } });
    }
    return route.fulfill({ status: 503, json: { error: 'Not part of this test' } });
  });
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/');
  await workspace.expectSignIn();
  await workspace.openServerField();
  // Assert: no server is filled in, and an empty field is not an error before connecting.
  await expect(workspace.serverField()).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Copy git clone/ })).toBeVisible();
  await workspace.serverField().focus();
  await workspace.serverField().press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Happy recovery key', exact: true }).fill(recoveryKey);
  await expect(page.getByRole('button', { name: 'Connect account', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Happy recovery key', exact: true }).fill('');

  // Act
  await workspace.serverField().fill(`http://${customHost}`);
  await workspace.serverField().press('Enter');
  // Assert
  await expect(page.getByRole('alert')).toHaveText('Use an HTTPS Happy server address.');

  // Act
  await workspace.serverField().fill(`https://${customHost}/`);
  await workspace.serverField().press('Tab');
  // Assert
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(workspace.serverField()).toHaveValue(`https://${customHost}`);
  expect(authHost).toBe('');

  // Act
  await workspace.signInWithKey(recoveryKey);
  // Assert
  await expect.poll(() => authHost).toBe(customHost);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('rayno.server')))
    .toBe(`https://${customHost}`);

  // Act
  await page.evaluate(() => localStorage.removeItem('rayno.credentials'));
  await page.goto('/');
  await workspace.openServerField();
  // Assert
  await expect(workspace.serverField()).toHaveValue(`https://${customHost}`);
  await workspace.expectNoPageOverflow();
});

// PERFORMANCE-PLAN.md 6.5: a remembered sign-in asks the browser to keep the offline data, inside the click.
test('sign-in and the first click of a remembered session should ask the browser to keep offline data', async ({ page }) => {
  // Arrange
  await page.addInitScript(() => {
    const calls = { persist: 0 };
    Object.assign(window, { __persist: calls });
    // WebKit can give the page a new StorageManager after this script, so stub the prototype.
    Object.assign(StorageManager.prototype, { persist: async () => { calls.persist++; return false; }, persisted: async () => false });
  });
  await page.route(/^https:\/\/[^/]+\/v1\//, (route) => route.fulfill({ status: 503, json: { error: 'Not part of this test' } }));
  const workspace = new LiveWorkspacePage(page);
  const calls = () => page.evaluate(() => (window as unknown as { __persist: { persist: number } }).__persist.persist);
  await page.goto('/');
  await workspace.expectSignIn();
  // Act
  await workspace.signInWithKey(recoveryKey);
  // Assert
  await expect.poll(calls).toBe(1);
  await expect(page.getByRole('alert')).toBeVisible();
  // Arrange: a session that signed in on an earlier visit.
  const server = new HappyServer();
  await server.install(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  expect(await calls()).toBe(0);
  // Act
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Sessions', exact: true }).click();
  // Assert
  await expect.poll(calls).toBe(1);
});
