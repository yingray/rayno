import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { PriorityFeaturesPage } from './pages/PriorityFeaturesPage';
import { base64 } from '../src/happy/crypto';

for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
  test(`AskUserQuestion should submit selected and custom answers at ${width}x${height}`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const workspace = new PriorityFeaturesPage(page);
    await page.setViewportSize({ width, height });
    const questions = [{ question: 'Which implementation should the agent use?', header: 'Implementation', multiSelect: true,
      options: [{ label: 'Small change', description: 'Keep the patch focused.' }, { label: 'Full change', description: 'Update the complete flow.' }] }];
    server.sessions[0].agentState = await server.encryption.encrypt({ requests: { question: { tool: 'AskUserQuestion', arguments: { questions } } } }, server.dataKey);
    await workspace.openSession();
    // Act
    await workspace.chooseQuestion('Small change', 'Keep the public API stable');
    await workspace.expectNoPageOverflow();
    if (width === 320) await workspace.capture('priority-question-320');
    await workspace.submitQuestion();
    // Assert
    await expect.poll(() => server.permissionPayloads.length).toBe(1);
    expect(server.permissionPayloads[0]).toMatchObject({ id: 'question', approved: true, updatedInput: {
      answers: { 'Which implementation should the agent use?': 'Small change, Keep the public API stable' },
    } });
    await expect(workspace.requests()).toHaveCount(0);
  });
}

for (const flavor of ['claude', 'codex']) {
  test(`session approval should send the ${flavor} permission contract`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    await server.install(page);
    const metadata = await server.encryption.decrypt<Record<string, unknown>>(server.sessions[0].metadata, server.dataKey);
    server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, flavor }, server.dataKey);
    const workspace = new PriorityFeaturesPage(page);
    await workspace.openSession();
    // Act
    await workspace.allowForSession();
    // Assert
    await expect.poll(() => server.permissionPayloads.length).toBe(1);
    expect(server.permissionPayloads[0]).toEqual(flavor === 'codex'
      ? { id: 'permission', approved: true, decision: 'approved_for_session' }
      : { id: 'permission', approved: true, decision: 'approved', allowTools: ['Read'] });
  });
}

for (const method of ['PUT', 'POST'] as const) {
  test(`image ${method} should encrypt, retain failed drafts, deduplicate retries, and display after reload`, async ({ page }) => {
    // Arrange
    const server = new HappyServer();
    server.uploadMethod = method;
    server.uploadFailure = true;
    await server.install(page);
    const workspace = new PriorityFeaturesPage(page);
    await workspace.openSession();
    await workspace.attachImage();
    // Act: a failed upload must not send a text-only message.
    await workspace.send('Review the image');
    await expect(page.getByRole('alert')).toContainText('transfer failed');
    expect(server.sends).toHaveLength(0);
    await workspace.expectDraft('Review the image');
    server.uploadFailure = false;
    server.failFirstSend = true;
    await workspace.retrySend();
    await expect(page.getByRole('alert')).toContainText('confirmation lost');
    const uploads = server.uploadRequests.length;
    await workspace.retrySend();
    await workspace.expectDraft('');
    // Assert
    expect(server.uploadRequests).toHaveLength(uploads);
    expect(server.sends).toHaveLength(4);
    expect(server.sends.slice(0, 2)).toEqual(server.sends.slice(2));
    expect(server.uploadHeaders.every(headers => !headers.authorization)).toBe(true);
    const stored = [...server.blobs.values()][0];
    const plain = await server.encryption.decryptBlob(stored, server.dataKey);
    expect([...plain.slice(0, 4)]).toEqual([137, 80, 78, 71]);
    expect([...stored.slice(0, 4)]).not.toEqual([137, 80, 78, 71]);
    const file = await server.encryption.decrypt<Record<string, any>>(server.sends[0].content, server.dataKey);
    expect(file.content.data.ev).toMatchObject({ t: 'file', name: 'pixel.png' });
    await workspace.openImage();
    await page.reload();
    await workspace.expectConnected();
    await workspace.openImage();
    const reads = server.requests.filter(request => request.path.endsWith('/attachments/request-download')).length;
    const records = await workspace.offlineRecords();
    expect(records.some(record => record.key.includes('image.'))).toBe(true);
    expect(records.every(record => !record.value.includes('pixel.png'))).toBe(true);
    await workspace.setNetwork(false);
    await page.reload();
    await workspace.openImage();
    expect(server.requests.filter(request => request.path.endsWith('/attachments/request-download'))).toHaveLength(reads);
    await workspace.expectNoPageOverflow();
  });
}

test('new session images should retry delivery without spawning a second agent', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.failFirstSend = true;
  await server.install(page);
  const workspace = new PriorityFeaturesPage(page);
  await page.goto('/new');
  await page.getByLabel('Folder', { exact: true }).fill('/real/project');
  await workspace.attachImage(true);
  // Act
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('confirmation lost');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Assert
  await expect(page).toHaveURL(/\/session\/created-session$/);
  expect(server.spawns).toHaveLength(1);
  expect(server.uploadRequests).toHaveLength(1);
  await workspace.openImage();
});

test('session recovery should retry a failure on the original computer and reuse the same session', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.machineMetadata.resumeSupport = { rpcAvailable: true };
  await server.install(page);
  server.sessions[0].active = false;
  const metadata = await server.encryption.decrypt<Record<string, any>>(server.sessions[0].metadata, server.dataKey);
  server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, claudeSessionId: 'original-provider-id' }, server.dataKey);
  server.resumeFailure = true;
  const workspace = new PriorityFeaturesPage(page);
  await workspace.openSession();
  // Act
  await workspace.resume();
  await expect(page.getByRole('alert')).toContainText('Recovery failed');
  server.resumeFailure = false;
  await workspace.resume();
  // Assert
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled(); // empty draft
  await workspace.send('Continue this session');
  await workspace.expectDraft('');
  expect(server.resumeRequests).toHaveLength(2);
  expect(server.spawns).toHaveLength(0);
  expect(server.resumeRequests[0]).toMatchObject({ sessionId: 'real-session', fallback: {
    encryptionKey: base64(server.dataKey), encryptionVariant: 'dataKey', metadata: { machineId: 'computer' },
  } });
  await expect(page).toHaveURL(/\/session\/real-session$/);
});

test('tool details should display arguments, diffs, and a later result without leaving chat', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const workspace = new PriorityFeaturesPage(page);
  await workspace.openSession();
  await server.pushEvent({ role: 'session', content: { type: 'session', data: { role: 'agent', turn: 't1', ev: {
    t: 'tool-call-start', call: 'edit', name: 'Edit', title: 'Edit README', args: { file_path: 'README.md', old_string: 'old line', new_string: 'new line' },
  } } } });
  // Act
  const group = await workspace.expandTool('Edit README');
  await expect(group).toContainText('old_string');
  await expect(group).toContainText('No result reported yet.');
  await server.pushEvent({ role: 'session', content: { type: 'session', data: { role: 'agent', turn: 't1', ev: {
    t: 'tool-call-end', call: 'edit', result: '@@ -1 +1 @@\n-old line\n+new line',
  } } } });
  // Assert
  await expect(group).toContainText('@@ -1 +1 @@');
  await workspace.expectNoPageOverflow();
});

test('image preview, tool details, and new-session controls should remain usable across phone viewports', async ({ page }) => {
  // Arrange
  const server = new HappyServer();
  server.machineMetadata.resumeSupport = { rpcAvailable: true };
  await server.install(page);
  const metadata = await server.encryption.decrypt<Record<string, any>>(server.sessions[0].metadata, server.dataKey);
  server.sessions[0].metadata = await server.encryption.encrypt({ ...metadata, claudeSessionId: 'provider-id' }, server.dataKey);
  const workspace = new PriorityFeaturesPage(page);
  await workspace.openSession();
  await workspace.attachImage();
  await workspace.retrySend();
  await workspace.expectDraft('');
  await server.pushEvent({ role: 'session', content: { type: 'session', data: { role: 'agent', turn: 't1', ev: {
    t: 'tool-call-start', call: 'read', name: 'Read', title: 'Read workspace', args: { file_path: 'a/long/path/to/README.md' },
  } } } });
  // Act / Assert: open and close real controls at each size, including a keyboard-sized viewport.
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.openImage();
    server.setSessionActive('real-session', false);
    await workspace.resume();
    await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toHaveCount(0);
    const group = await workspace.expandTool('Read workspace');
    await expect(group).toContainText('file_path');
    await workspace.expectNoPageOverflow();
    if (width === 320) await workspace.capture('priority-tools-320');
  }
  await page.goto('/new');
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 900], [360, 350], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await workspace.attachImage(true);
    const remove = page.getByRole('button', { name: 'Remove pixel.png', exact: true });
    await remove.scrollIntoViewIfNeeded();
    await workspace.expectTouchTarget(remove);
    await remove.click();
    await workspace.expectStartReachableOnPhone();
    await workspace.expectNoPageOverflow();
  }
});
