import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate, compareBuild, currentBuild, forceUpdate, formatBuildTime, isChunkError, parseBuild, recoverShell,
} from './appUpdate';

const latest = { commit: 'abc1234', builtAt: '2026-10-22T09:17:22.000Z' };
const serve = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App update', () => {
  it('should accept only a version file with a commit and a build time', () => {
    // Arrange
    const values = [latest, { commit: 'abc1234' }, { commit: '', builtAt: 'x' }, null, 'abc1234'];
    // Act
    const builds = values.map(parseBuild);
    // Assert
    expect(builds).toEqual([latest, null, null, null, null]);
  });

  it('should report a new release only when the commit differs', () => {
    // Arrange
    const running = { commit: 'abc1234', builtAt: '2026-10-21T00:00:00.000Z' };
    // Act
    const same = compareBuild(running, latest).status;
    const changed = compareBuild(running, { ...latest, commit: 'def5678' }).status;
    // Assert
    expect([same, changed]).toEqual(['current', 'available']);
  });

  it('should show a build time in the given locale and keep an invalid time as given', () => {
    // Arrange
    const times = [latest.builtAt, 'not a date'];
    // Act
    const shown = times.map((time) => formatBuildTime(time, 'en-US'));
    // Assert
    expect(shown[0]).toMatch(/Oct 22, 2026/);
    expect(shown[1]).toBe('not a date');
  });

  it('should treat a missing or unreadable version file as offline', async () => {
    // Arrange
    serve(latest, false);
    const failed = await checkForUpdate();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    // Act
    const unreachable = await checkForUpdate();
    // Assert
    expect([failed.status, unreachable.status]).toEqual(['offline', 'offline']);
  });

  it('should keep the page and its cached shell when the server cannot be reached', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const reload = vi.fn();
    // Act
    const result = await forceUpdate(reload);
    // Assert
    expect(result.status).toBe('offline');
    expect(reload).not.toHaveBeenCalled();
  });

  it('should reload when the server answers and no service worker controls the page', async () => {
    // Arrange
    serve({ ...latest, commit: currentBuild.commit === 'abc1234' ? 'def5678' : 'abc1234' });
    const reload = vi.fn();
    // Act
    const result = await forceUpdate(reload);
    // Assert
    expect(result.status).toBe('available');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('should treat only screen chunk load failures as chunk errors', () => {
    // Arrange
    const errors = [
      new TypeError('Failed to fetch dynamically imported module: https://rayno.test/assets/Chat-old.js'),
      new TypeError('Importing a module script failed.'),
      new TypeError("'text/html' is not a valid JavaScript MIME type."),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      'Importing a module script failed.',
    ];
    // Act
    const results = errors.map(isChunkError);
    // Assert
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('should clear the shell caches and reload when the page is online', async () => {
    // Arrange
    const names = ['rayno-precache-v2', 'rayno-diagrams', 'workbox-runtime', 'account-data'];
    const remove = vi.fn(async (_name: string) => true);
    vi.stubGlobal('caches', { keys: async () => names, delete: remove });
    vi.stubGlobal('navigator', { onLine: true });
    const reload = vi.fn();
    // Act
    await recoverShell(reload);
    // Assert
    expect(remove.mock.calls.map(([name]) => name)).toEqual(names.slice(0, 3));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('should keep the cached shell and only reload when the page is offline', async () => {
    // Arrange
    const remove = vi.fn(async (_name: string) => true);
    vi.stubGlobal('caches', { keys: async () => ['rayno-precache-v2'], delete: remove });
    vi.stubGlobal('navigator', { onLine: false });
    const reload = vi.fn();
    // Act
    await recoverShell(reload);
    // Assert
    expect(remove).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
