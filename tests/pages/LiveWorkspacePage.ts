import { expect } from '@playwright/test';
import { WorkspacePage } from './WorkspacePage';
export class LiveWorkspacePage extends WorkspacePage {
  async expectCompactChatHeader() {
    const chat = this.page.getByRole('region', { name: 'Chat session', exact: true });
    const header = chat.locator('header');
    await expect(chat.getByRole('group', { name: /^(Session shortcuts|Session view)$/ })).toHaveCount(0);
    await expect(chat.getByText('Main conversation', { exact: true })).toHaveCount(0);
    await expect(chat.getByRole('button', { name: /^(New session in same workspace|Hand off this session|Chat|Changes|Files)$/ })).toHaveCount(0);
    const bounds = (await header.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(72);
    const chatBounds = (await chat.boundingBox())!;
    const messages = (await this.conversation().boundingBox())!;
    expect(Math.abs(messages.y - chatBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(messages.height - chatBounds.height)).toBeLessThanOrEqual(1);
    const gapReachesMessages = await header.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return !!document.elementFromPoint(rect.left + 2, rect.top + 20)
        ?.closest('[aria-label="Conversation messages"]');
    });
    expect(gapReachesMessages).toBe(true);
    for (const button of await header.getByRole('button').all()) {
      const target = (await button.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.x).toBeGreaterThanOrEqual(0);
      expect(target.x + target.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
    }
    await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  }
  connectionError() { return this.page.getByRole('alert', { name: 'Connection error', exact: true }); }
  availability(area: 'Session list' | 'Conversation') {
    return this.page.getByRole('status', { name: `${area} availability`, exact: true });
  }
  async resizeChat(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    await expect(this.page.getByRole('button', {
      name: width < 768 ? 'Back to sessions' : 'Open session list', exact: true,
    })).toBeVisible();
  }
  async setNetwork(online: boolean) {
    await this.page.evaluate((online) => {
      localStorage.setItem('fixture.online', String(online));
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
      window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    }, online);
  }
  async offlineRecords(): Promise<{ key: string; value: string }[]> {
    return this.page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('rayno-offline', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('records');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('records', 'readonly');
        const store = transaction.objectStore('records');
        const keys = store.getAllKeys();
        const values = store.getAll();
        transaction.oncomplete = () => {
          db.close();
          resolve(keys.result.map((key, i) => ({ key: String(key), value: values.result[i] })));
        };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    }));
  }
  async addOfflineRecord(key: string, value: string) {
    await this.page.evaluate(({ key, value }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('rayno-offline', 1);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('records', 'readwrite');
        transaction.objectStore('records').put(value, key);
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
      open.onerror = () => reject(open.error);
    }), { key, value });
  }
  async setForeground(visible: boolean, focused: boolean) {
    await this.page.evaluate(({ visible, focused }) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
    }, { visible, focused });
  }
  async goToSection(name: 'Sessions' | 'Monitor' | 'Settings') {
    await this.page.getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('button', { name, exact: true }).click();
  }
  async showArchive(archived: boolean) {
    await this.setListVisibility(archived);
    await expect(this.page.getByRole('heading', { name: archived ? 'Archived' : 'Sessions', exact: true })).toBeVisible();
  }
  async expectArchiveTouchTarget() {
    await this.openListOptions();
    for (const button of [this.listOptionsButton(), ...await this.listOptions().getByRole('group', { name: 'Session visibility', exact: true }).getByRole('button').all()]) {
      await button.scrollIntoViewIfNeeded();
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await this.closeListOptions();
  }
  newModelPicker() { return this.page.getByRole('dialog', { name: 'Choose model', exact: true }); }
  async expectNewSessionFullscreen() {
    const viewport = this.page.viewportSize()!;
    for (const panel of [this.page.getByRole('main'), this.page.getByRole('region', { name: 'Create session', exact: true })]) {
      await expect(panel).toBeVisible();
      const bounds = (await panel.boundingBox())!;
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
      expect(bounds.width).toBe(viewport.width);
      expect(bounds.height).toBe(viewport.height);
    }
    await expect(this.page.getByRole('main')).toHaveCSS('border-radius', '0px');
    await expect(this.page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    for (const field of [this.taskDescription(), this.page.getByLabel('Folder', { exact: true })]) {
      expect(await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    }
  }
  async closeNewSession(touch: boolean) {
    const button = this.page.getByRole('button', { name: 'Close new session', exact: true });
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    if (touch) await button.tap();
    else await button.click();
    await expect(this.page).toHaveURL(/\/sessions$/);
  }
  newPermissionMode() { return this.page.getByRole('combobox', { name: 'Permission mode', exact: true }); }
  async chooseNewPermission(value: string) { await this.newPermissionMode().selectOption(value); }
  async chooseNewAgent(name: 'Claude' | 'Codex') {
    await this.page.getByRole('group', { name: 'Agent', exact: true }).getByRole('button', { name, exact: true }).click();
  }
  async expectPermissionPickerUsableOnPhone(touch: boolean) {
    const control = this.newPermissionMode();
    await control.scrollIntoViewIfNeeded();
    if (touch) await control.tap();
    else await control.click();
    await control.press('Escape');
    await control.focus();
    const appearance = await control.evaluate((element) => ({
      fontSize: parseFloat(getComputedStyle(element).fontSize),
      frame: getComputedStyle(element.closest('[data-focus-frame]')!).borderColor,
      outline: getComputedStyle(element).outlineStyle,
    }));
    expect(appearance.fontSize).toBeGreaterThanOrEqual(16);
    expect(appearance.frame).toBe('rgb(139, 92, 246)');
    expect(appearance.outline).toBe('none');
    const target = (await control.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y + target.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
  }
  async chooseNewModel(label: string) {
    await this.page.getByRole('button', { name: 'Choose model', exact: true }).click();
    await this.newModelPicker().getByRole('radiogroup', { name: 'Model', exact: true }).getByRole('radio', { name: label, exact: true }).click();
    await this.newModelPicker().getByRole('button', { name: 'Done', exact: true }).click();
  }
  async chooseNewEffort(label: string) {
    await this.page.getByRole('button', { name: 'Choose effort', exact: true }).click();
    await this.newModelPicker().getByRole('radiogroup', { name: 'Effort', exact: true }).getByRole('radio', { name: label, exact: true }).click();
    await this.newModelPicker().getByRole('button', { name: 'Done', exact: true }).click();
  }
  workspacePicker() { return this.page.getByRole('dialog', { name: 'Choose workspace', exact: true }); }
  async openWorkspacePicker() { await this.page.getByRole('button', { name: 'Choose workspace', exact: true }).click(); }
  async expectPickerUsableOnPhone() {
    const dialog = this.newModelPicker();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
    for (const control of [dialog.getByRole('button', { name: 'Codex', exact: true }),
      dialog.getByRole('radio', { name: 'High', exact: true }), dialog.getByRole('button', { name: 'Done', exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const target = (await control.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.y + target.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
    }
  }
  async expectStartReachableOnPhone() {
    const button = this.page.getByRole('button', { name: 'Start', exact: true });
    await button.scrollIntoViewIfNeeded();
    const target = (await button.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y + target.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
    expect(await button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  handoffAction() { return this.page.getByRole('button', { name: /^Hand Off/ }); }
  taskDescription() { return this.page.getByRole('textbox', { name: 'Task description', exact: true }); }
  async handOff() {
    await this.info();
    await this.handoffAction().click();
    await expect(this.page).toHaveURL(/\/new$/);
    await expect(this.taskDescription()).toBeFocused();
  }
  async expectTaskCaretAtEnd() {
    const caret = await this.taskDescription().evaluate((element: HTMLTextAreaElement) => ({
      start: element.selectionStart, end: element.selectionEnd, length: element.value.length,
    }));
    expect(caret.start).toBe(caret.length);
    expect(caret.end).toBe(caret.length);
  }
  async expectTaskFocusFrame() {
    const frame = await this.taskDescription().evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      border: getComputedStyle(element.parentElement!).borderColor,
    }));
    expect(frame.outline).toBe('none');
    expect(frame.border).toBe('rgb(139, 92, 246)');
  }
  folderDialog() { return this.page.getByRole('dialog', { name: 'Create this folder?', exact: true }); }
  async expectFolderDialogUsable(path: string) {
    const dialog = this.folderDialog();
    const viewport = this.page.viewportSize()!;
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(path, { exact: true })).toBeVisible();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    for (const name of ['Close Create this folder?', 'Cancel', 'Create folder']) {
      const control = dialog.getByRole('button', { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      const target = (await control.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.y + target.height).toBeLessThanOrEqual(viewport.height);
      expect(await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
  }
  async answerFolderDialog(name: 'Cancel' | 'Create folder', touch: boolean) {
    const button = this.folderDialog().getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    if (touch) await button.tap();
    else await button.click();
    await expect(this.folderDialog()).toBeHidden();
  }
  async startDraft() {
    await this.page.getByRole('button', { name: 'Start', exact: true }).click();
  }
  usageSummary() { return this.page.getByRole('button', { name: 'Agent usage summary', exact: true }); }
  usageDetails() { return this.page.getByRole('region', { name: 'Usage details', exact: true }); }
  async openUsage() { await this.usageSummary().click(); await expect(this.usageDetails()).toBeVisible(); }
  async expectUsageDetailsFit() {
    const details = this.usageDetails();
    const viewport = this.page.viewportSize()!;
    const box = (await details.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await details.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    const monitor = details.getByRole('button', { name: 'Open Monitor', exact: true });
    await monitor.scrollIntoViewIfNeeded();
    await expect(monitor).toBeInViewport();
    await details.evaluate((element) => { element.scrollTop = 0; });
    await this.expectNoPageOverflow();
  }
  async refreshUsage() { await this.usageDetails().getByRole('button', { name: 'Refresh usage', exact: true }).click(); }
  async expectUsagePlacement() {
    await this.sessionRows().last().scrollIntoViewIfNeeded();
    const usage = (await this.usageSummary().boundingBox())!;
    const lastRow = (await this.sessionRows().last().boundingBox())!;
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(usage.y);
    expect(usage.y + usage.height).toBeLessThan(this.page.viewportSize()!.height);
    if (this.page.viewportSize()!.width < 768) {
      const tabs = (await this.page.getByRole('navigation', { name: 'Main navigation' }).boundingBox())!;
      const fab = (await this.page.getByRole('button', { name: 'New session', exact: true }).boundingBox())!;
      expect(usage.y + usage.height).toBeLessThan(tabs.y);
      expect(fab.y + fab.height).toBeLessThan(usage.y);
    }
  }
  sessionRow(title = 'Connected workspace') {
    return this.sessionRows().filter({ hasText: title });
  }
  indicator(kind: 'Unread' | 'Needs input', title = 'Connected workspace') {
    return this.sessionRow(title).getByRole('img', { name: kind, exact: true });
  }
  async showSessions(archived = false) {
    await expect(this.page.locator('main, [aria-label="Session list"]').first()).toBeVisible();
    const width = this.page.viewportSize()!.width;
    const chatRoute = new URL(this.page.url()).pathname.startsWith('/session/');
    const drawerOpen = await this.page.getByRole('dialog', { name: 'Sessions', exact: true }).isVisible();
    if (chatRoute && (width < 768 || width < 1024 && !drawerOpen) ||
      !await this.page.getByRole('region', { name: 'Session list', exact: true }).isVisible())
      await this.page.getByRole('button', { name: /^(Back to sessions|Open session list)$/ }).click();
    await expect(this.page.getByRole('region', { name: 'Session list', exact: true })).toBeVisible();
    await this.expectWorkspaceReady();
    const showingArchive = await this.page.getByRole('region', { name: 'Session list', exact: true })
      .getByRole('heading', { name: 'Archived', exact: true }).count() > 0;
    if (showingArchive !== archived) await this.showArchive(archived);
    await expect(this.sessionRow()).toBeVisible();
  }
  async openOtherSession() {
    await this.page.goto('/session/older-session');
    await expect(this.page.getByRole('button', { name: 'Open session info', exact: true }).first()).toContainText('Older workspace');
    await this.expectConnected();
  }
  async openRow(title = 'Connected workspace') {
    await this.sessionRow(title).click();
    await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  }
  permissionMode() {
    return this.page.getByRole('button', { name: /^Permission mode:/ });
  }
  async expectPermissionLabelReadable() {
    const dimensions = await this.permissionMode().locator('span').last().evaluate((element) => ({
      visible: element.clientWidth, text: element.scrollWidth,
    }));
    expect(dimensions.text).toBeLessThanOrEqual(dimensions.visible);
  }
  async openPermissionSettings() {
    await this.permissionMode().click();
    await expect(this.page.getByRole('dialog', { name: 'Permission mode', exact: true })).toBeVisible();
  }
  async choosePermission(label: string) {
    await this.page.getByRole('radiogroup', { name: 'Permission mode', exact: true })
      .getByRole('radio', { name: label, exact: true }).click();
  }
  conversation() {
    return this.page.getByRole('region', { name: 'Conversation messages', exact: true });
  }
  latestShortcut() {
    return this.page.getByRole('button', { name: 'Scroll to latest messages', exact: true });
  }
  async readHistory() {
    await this.conversation().evaluate((element) => { element.scrollTop = 0; });
    await expect(this.latestShortcut()).toBeVisible();
  }
  async conversationPosition() {
    return this.conversation().evaluate((element) => ({
      top: element.scrollTop,
      remaining: element.scrollHeight - element.scrollTop - element.clientHeight,
    }));
  }
  async returnToLatest() {
    await this.latestShortcut().click();
    await expect(this.latestShortcut()).toHaveCount(0);
    await expect.poll(async () => (await this.conversationPosition()).remaining).toBeLessThan(1);
  }
  async openModelSettings() {
    await this.page.getByRole('button', { name: 'Model and effort', exact: true }).click();
    await expect(this.page.getByRole('dialog', { name: 'Model & effort' })).toBeVisible();
  }
  async chooseModel(label: string) {
    await this.page.getByRole('radiogroup', { name: 'Model', exact: true })
      .getByRole('radio', { name: label, exact: true }).click();
  }
  async chooseEffort(label: string) {
    await this.page.getByRole('radiogroup', { name: 'Effort', exact: true })
      .getByRole('radio', { name: label, exact: true }).click();
  }
  async closeModelSettings() {
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  replyOptions() {
    return this.page.getByRole('group', { name: 'Reply options', exact: true });
  }
  async selectReply(text: string) {
    await this.replyOptions().getByRole('button', { name: text, exact: true }).click();
  }
  async expectReplyTargetsReachable() {
    for (const button of await this.replyOptions().getByRole('button').all()) {
      // Scroll past the floating composer before checking the touch target.
      await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const target = (await button.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.x).toBeGreaterThanOrEqual(0);
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.x + target.width).toBeLessThanOrEqual(this.page.viewportSize()!.width);
      expect(target.y + target.height).toBeLessThanOrEqual(this.page.viewportSize()!.height);
      expect(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
  }
  async tapReply(text: string) {
    await this.replyOptions().getByRole('button', { name: text, exact: true }).tap();
  }
  codeExample(text: string) {
    return this.page.locator('pre').filter({ hasText: text });
  }
  toolGroups() {
    return this.page.getByRole('region', { name: 'Tool activity', exact: true });
  }
  async expandToolGroup(index: number) {
    const button = this.toolGroups().nth(index).getByRole('button');
    if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  }
  markdownTable() {
    return this.page.getByRole('region', { name: 'Markdown table', exact: true });
  }
  sessionRows() {
    return this.page.getByRole('region', { name: 'Session list' }).getByRole('button').filter({
      has: this.page.locator('time'),
    });
  }
  async expectWorkspaceLoading(loading: boolean) {
    await expect(this.page.getByRole('progressbar', { name: 'Load workspace' })).toHaveCount(loading ? 1 : 0);
  }
  async openSession() {
    await this.page.goto('/session/real-session');
    await expect(this.page.getByText('From the real protocol', { exact: true })).toBeVisible();
  }
  async expectConnected() {
    await expect(this.page.getByRole('region', { name: 'Chat session', exact: true })).toHaveAttribute('data-connection', 'connected');
  }
  async expectWorkspaceReady() {
    await this.expectWorkspaceLoading(false);
    await expect(this.page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  }
  async loadEarlier() {
    await this.page.getByRole('button', { name: 'Load earlier messages' }).click();
  }
  async expectDraft(text: string) {
    await expect(this.page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      text,
    );
  }
  async retrySend() {
    await this.page.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  async allowOnce() {
    await this.page.getByRole('button', { name: 'Allow once', exact: true }).click();
  }
  async previewFile() {
    await this.page.goto('/session/real-session/files');
    await this.page.getByRole('button', { name: 'README.md', exact: true }).click();
  }
  async refreshMonitor() {
    await this.page.goto('/monitor');
    await this.page.getByRole('button', { name: 'Refresh', exact: true }).click();
  }
  async signOut() {
    await this.page.goto('/settings/account');
    await this.page.getByRole('button', { name: 'Sign out of Rayno' }).click();
  }
  async startRealSession(prompt: string) {
    await this.page.goto('/new');
    await this.page.getByLabel('Folder', { exact: true }).fill('/real/project');
    await this.page.getByRole('textbox', { name: 'Task description' }).fill(prompt);
    await this.page.getByRole('button', { name: 'Start', exact: true }).click();
  }
  async expectSignIn() {
    await expect(
      this.page.getByRole('heading', { name: 'Your agents, in a new space.' }),
    ).toBeVisible();
  }
  async expectQr() {
    await expect(this.page.getByRole('img', { name: 'Authorize Rayno in Happy' })).toBeVisible();
  }
  async showSignIn() {
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async showQrSignIn() {
    await this.showSignIn();
    await this.page.getByRole('button', { name: 'Scan QR code', exact: true }).click();
  }
  async restore() {
    await this.page.getByRole('button', { name: /^Restore( session)?$/, exact: true }).click();
  }
  serverField() {
    return this.page.getByRole('textbox', { name: 'Happy server', exact: true });
  }
  async openServerField() {
    await this.showSignIn();
    await this.page.getByText('Happy server', { exact: true }).click();
    await expect(this.serverField()).toBeVisible();
  }
  async signInWithKey(key: string) {
    await this.showSignIn();
    await this.page.getByRole('button', { name: 'Recovery key', exact: true }).click();
    await this.page.getByRole('textbox', { name: 'Happy recovery key', exact: true }).fill(key);
    await this.page.getByRole('button', { name: 'Connect account', exact: true }).click();
  }
  /** An ended CLI session uses recovery instead of the archive or restore action. */
  archiveActions() {
    return this.page.getByRole('button', { name: /^(Archive|Restore)( session)?$/ });
  }
}
