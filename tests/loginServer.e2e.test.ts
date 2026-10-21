import { expect, test } from '@playwright/test';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

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
