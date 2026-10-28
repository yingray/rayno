import { expect, test } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { formatRecoveryKey } from '../src/happy/crypto';

const newHost = 'happy.example.com';
const refusedHost = 'refused.example.com';

test('account settings should copy the recovery key and move the sign-in to another Happy server', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const authHosts: string[] = [];
  await page.route(/^https:\/\/(happy|refused)\.example\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/auth') {
      authHosts.push(url.host);
      if (url.host === refusedHost) return route.fulfill({ status: 401, json: { error: 'Invalid signature' } });
      return route.fulfill({ json: { success: true, token: 'new-server-token' } });
    }
    return route.fulfill({ status: 503, json: { error: 'Not part of this test' } });
  });
  const account = new AccountSettingsPage(page);
  await account.stubClipboard();
  await account.open();
  // Wait for the workspace to cache data for the current server.
  await expect.poll(async () => (await account.accountKeys()).length).toBeGreaterThan(0);
  const oldKeys = await account.accountKeys();
  // Assert
  await expect(account.serverRow()).toContainText(server.credentials.server);
  await account.expectNoPageOverflow();

  // Act
  await account.copyRecoveryKey();
  // Assert
  await expect.poll(() => account.copiedText()).toBe(formatRecoveryKey(server.secret));

  // Act: a server that refuses the account.
  await account.changeServer(`https://${refusedHost}`);
  // Assert: the dialog shows the error, and Rayno stays on the current server.
  await expect(account.dialog().getByRole('alert')).toContainText('401');
  expect(await account.storedServer()).toBe(server.credentials.server);

  // Act: an address that is not HTTPS.
  await account.dialog().getByRole('textbox', { name: 'Happy server', exact: true }).fill(`http://${newHost}`);
  await account.dialog().getByRole('button', { name: 'Connect', exact: true }).click();
  // Assert
  await expect(account.dialog().getByRole('alert')).toHaveText('Use an HTTPS Happy server address.');
  await account.dialog().getByRole('button', { name: 'Cancel', exact: true }).click();

  // Act
  await account.changeServer(`https://${newHost}/`);
  // Assert: Rayno signs in to the new server with the same key and keeps the sign-in after a reload.
  await expect(account.dialog()).toHaveCount(0);
  await expect.poll(() => account.storedServer()).toBe(`https://${newHost}`);
  expect(authHosts).toEqual([refusedHost, newHost]);
  // The cached data of the old server leaves this browser, as on sign-out.
  await expect.poll(async () => (await account.accountKeys()).filter((key) => oldKeys.includes(key))).toEqual([]);
  await page.reload();
  await expect(account.signIn()).toBeVisible();
  await expect(account.serverRow()).toContainText(`https://${newHost}`);
});

test('the demo account should show the sample server and let the user change it', async ({ page }) => {
  // Arrange
  const account = new AccountSettingsPage(page);
  await account.stubClipboard();
  await account.open('?demo=1');
  // Assert
  await expect(account.serverRow()).toContainText('https://your-mac.your-tailnet.ts.net:3007');
  await expect(account.signIn()).toContainText('sample key');
  // Act
  await account.copyRecoveryKey();
  // Assert
  await expect.poll(() => account.copiedText()).toMatch(/^([A-Z2-7]{5}-){10}[A-Z2-7]{2}$/);
  // Act
  await account.changeServer('https://other-mac.your-tailnet.ts.net:3007');
  // Assert
  await expect(account.dialog()).toHaveCount(0);
  await expect(account.serverRow()).toContainText('https://other-mac.your-tailnet.ts.net:3007');
  await account.expectNoPageOverflow();
});
