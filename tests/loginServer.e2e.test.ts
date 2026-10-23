import { expect, test } from '@playwright/test';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';
import { HappyServer } from './fixtures/HappyServer';

const customHost = 'happy.example.com';
// Base64 of 32 bytes with the value 7: a valid recovery key format.
const recoveryKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

test('a custom Happy server should apply on blur and stay after sign-out', async ({ page }) => {
  // Arrange
  const pairingHosts: string[] = [];
  let authHost = '';
  await page.route(/^https:\/\/[^/]+\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/auth/account/request') {
      pairingHosts.push(url.host);
      return route.fulfill({ json: { state: 'requested' } });
    }
    if (url.pathname === '/v1/auth') {
      authHost = url.host;
      return route.fulfill({ json: { token: 'custom-token' } });
    }
    return route.fulfill({ status: 503, json: { error: 'Not part of this test' } });
  });
  const workspace = new LiveWorkspacePage(page);
  await page.goto('/');
  await workspace.expectSignIn();
  await workspace.showQrSignIn();
  await expect.poll(() => pairingHosts.length).toBeGreaterThan(0);
  await workspace.openServerField();
  // Act
  await workspace.serverField().fill('');
  await workspace.serverField().pressSequentially(`https://${customHost}`);
  const hostsWhileTyping = new Set(pairingHosts);
  await workspace.serverField().press('Tab');
  // Assert
  expect(hostsWhileTyping).toEqual(new Set(['api.cluster-fluster.com']));
  await expect.poll(() => pairingHosts.at(-1)).toBe(customHost);

  // Act
  await workspace.serverField().fill(`http://${customHost}`);
  await workspace.serverField().press('Enter');
  // Assert
  await expect(page.getByRole('alert')).toHaveText('Use an HTTPS Happy server address.');

  // Act
  await workspace.serverField().fill(`https://${customHost}`);
  await workspace.serverField().press('Tab');
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
  await page.route(/^https:\/\/[^/]+\/v1\//, (route) => new URL(route.request().url()).pathname === '/v1/auth/account/request'
    ? route.fulfill({ json: { state: 'requested' } }) : route.fulfill({ status: 503, json: { error: 'Not part of this test' } }));
  const workspace = new LiveWorkspacePage(page);
  const calls = () => page.evaluate(() => (window as unknown as { __persist: { persist: number } }).__persist.persist);
  await page.goto('/');
  await workspace.expectSignIn();
  // Act
  await workspace.showQrSignIn();
  // Assert
  await expect.poll(calls).toBe(1);
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
