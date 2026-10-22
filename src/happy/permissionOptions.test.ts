import { describe, expect, it } from 'vitest';
import { currentPermission, messageMeta } from './normalize';
import { permissionOptions, permissionLabel, canSelectPermission, resolveNewSessionPermission, newSessionCatalog } from './permissionOptions';

describe('Permission mode display and selection', () => {
  it.each([['claude', 'bypassPermissions'], ['codex', 'yolo']])('should select Yolo for a new %s session without a valid saved choice', (flavor, permissionMode) => {
    // Arrange
    const metadata = { flavor };
    // Act / Assert
    expect(resolveNewSessionPermission(metadata, [undefined, null, '', 'removed-mode'])).toBe(permissionMode);
    expect(resolveNewSessionPermission(metadata, ['removed-mode', 'default'])).toBe('default');
    expect(resolveNewSessionPermission(metadata, ['auto'])).toBe('auto');
  });
  it('should prefer the latest supported choice and reject modes from the other agent', () => {
    // Arrange / Act / Assert
    expect(resolveNewSessionPermission({ flavor: 'claude' }, ['acceptEdits', 'plan'])).toBe('acceptEdits');
    expect(resolveNewSessionPermission({ flavor: 'claude' }, ['safe-yolo'])).toBe('bypassPermissions');
    expect(resolveNewSessionPermission({ flavor: 'codex' }, ['plan', 'safe-yolo'])).toBe('safe-yolo');
  });
  it('should display the same inherited mode that an encrypted message uses without guessing a default', () => {
    // Arrange
    const metadata = { permissionMode: 'default', currentOperatingModeCode: 'read',
      lastMode: { permissionMode: 'plan' }, draft: { permissionMode: 'bypassPermissions' } };
    // Act / Assert
    expect(currentPermission(metadata)).toBe('bypassPermissions');
    expect(permissionLabel(metadata, currentPermission(metadata))).toBe('Yolo');
    expect(messageMeta(metadata, {}).permissionMode).toBe(currentPermission(metadata));
    expect(currentPermission({})).toBeUndefined();
    expect(permissionLabel({}, undefined)).toBe('Not reported');
    expect(messageMeta({}, {})).not.toHaveProperty('permissionMode');
    expect(messageMeta({ session: { permissionMode: 'legacy-mode' } }, {}).permissionMode).toBe('legacy-mode');
  });
  it('should offer the correct CLI catalog and exclude auto on an older CLI', () => {
    // Act / Assert
    expect(permissionOptions({ flavor: 'codex' }).map((option) => option.value))
      .toEqual(['auto', 'safe-yolo', 'read-only', 'yolo', 'default']);
    expect(permissionOptions({ flavor: 'claude', version: '1.2.1-beta.1' }).map((option) => option.value))
      .toEqual(['acceptEdits', 'plan', 'bypassPermissions', 'default']);
    expect(permissionOptions({ flavor: 'claude', version: '1.2.1-beta.2' }).map((option) => option.value)).toContain('auto');
  });
  it.each([['claude', 'bypassPermissions'], ['codex', 'yolo']])('should drop a saved %s Auto choice for a computer with an older CLI', (flavor, fallback) => {
    // Arrange
    const older = newSessionCatalog(flavor, '1.2.0'), current = newSessionCatalog(flavor, '1.3.0');
    // Act / Assert
    expect(older).toEqual({ flavor, version: '1.2.0' });
    expect(newSessionCatalog(flavor, undefined)).toEqual({ flavor });
    expect(newSessionCatalog(flavor, 7)).toEqual({ flavor });
    expect(permissionOptions(older).map((option) => option.value)).not.toContain('auto');
    expect(permissionOptions(newSessionCatalog(flavor, 'not-a-version')).map((option) => option.value)).not.toContain('auto');
    expect(resolveNewSessionPermission(older, ['auto'])).toBe(fallback);
    expect(resolveNewSessionPermission(current, ['auto'])).toBe('auto');
  });
  it('should retain daemon labels, selection locks, and an unavailable current mode', () => {
    // Arrange
    const metadata = { client: { id: 'rig' }, currentOperatingModeCode: 'missing',
      capabilities: { permissionModeSelection: false }, operatingModes: [
        { code: 'auto', value: 'Review changes', description: 'Review each proposed change.' },
      ] };
    // Act / Assert
    expect(permissionLabel(metadata, 'auto')).toBe('Review changes');
    expect(permissionOptions(metadata)).toEqual([
      { value: 'auto', label: 'Review changes', description: 'Review each proposed change.' },
      { value: 'missing', label: 'missing', disabled: true, description: 'This mode is not in the current catalog.' },
    ]);
    expect(canSelectPermission(metadata)).toBe(false);
  });
});
