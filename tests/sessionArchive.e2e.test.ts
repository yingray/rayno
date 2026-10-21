import { test, expect } from '@playwright/test';
import { HappyServer } from './fixtures/HappyServer';
import { LiveWorkspacePage } from './pages/LiveWorkspacePage';

test('ended CLI sessions should stay in the archive while disconnected Rig sessions remain visible', async ({ page }, testInfo) => {
  // Arrange
  const server = new HappyServer();
  await server.install(page);
  const legacy = server.sessions[1];
  server.sessions.push({
    ...legacy, id: 'disconnected-rig',
    metadata: await server.encryption.encrypt({
      flavor: 'rig', client: { id: 'rig' }, path: '/real/project', machineId: 'computer',
      summary: { text: 'Disconnected Rig workspace' },
    }, null),
  }, {
    ...legacy, id: 'marked-archive', active: true,
    metadata: await server.encryption.encrypt({
      flavor: 'codex', lifecycleState: 'archived', path: '/real/project', machineId: 'computer',
      summary: { text: 'Explicitly archived workspace' },
    }, null),
  });
  await server.setMessages([{
    role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Retained archived history' } },
  }], 'older-session');
  const workspace = new LiveWorkspacePage(page);
  await workspace.route('/sessions');

  // Act / Assert
  await expect(workspace.sessionRows()).toHaveCount(2);
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  await expect(workspace.sessionRow('Disconnected Rig workspace')).toBeVisible();
  await expect(workspace.sessionRow('Older workspace')).toHaveCount(0);
  await workspace.showArchive(true);
  await expect(workspace.sessionRows()).toHaveCount(2);
  await expect(workspace.sessionRow('Older workspace')).toBeVisible();
  await expect(workspace.sessionRow('Explicitly archived workspace')).toBeVisible();
  await workspace.openRow('Older workspace');
  await expect(page.getByText('Retained archived history', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveAttribute(
    'placeholder',
    'Resume this session to send a message',
  );
  await workspace.info();
  await expect(workspace.archiveActions()).toHaveCount(0);

  await workspace.route('/sessions');
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  await workspace.expectWorkspaceReady();
  await expect(workspace.sessionRow('Older workspace')).toHaveCount(0);
  server.setSessionActive('real-session', false);
  await expect(workspace.sessionRow('Connected workspace')).toHaveCount(0);
  await workspace.showArchive(true);
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
  server.setSessionActive('real-session', true);
  await expect(workspace.sessionRow('Connected workspace')).toHaveCount(0);
  await workspace.showArchive(false);
  await expect(workspace.sessionRow('Connected workspace')).toBeVisible();

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 640 });
    await workspace.expectArchiveTouchTarget();
    await workspace.showArchive(true);
    await expect(workspace.sessionRow('Older workspace')).toBeVisible();
    await workspace.showArchive(false);
    await expect(workspace.sessionRow('Connected workspace')).toBeVisible();
    await workspace.expectNoPageOverflow();
  }
  await workspace.capture(`${testInfo.project.name}-archive-filter-phone`);
  expect(server.mutations).toEqual([]);
});
