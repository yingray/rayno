import { describe, expect, it } from 'vitest';
import { createInitialState, machines } from './fixtures';
import { draftInWorkspace, recentWorkspaceOptions } from './workspaces';
import { demoReducer, restoreState } from './reducer';

describe('Workspace selection', () => {
  it('should merge home-relative duplicates by computer and order recent checkouts by use', () => {
    // Arrange
    const base = createInitialState(1000000).sessions[0];
    const computers = [{ ...machines[0], homeDir: '/Users/dev' }];
    const sessions = [
      { ...base, id: 'recent', path: '/Users/dev/code/app', lastActivityAt: 900 },
      { ...base, id: 'duplicate', path: '~/code/app', lastActivityAt: 800 },
      { ...base, id: 'worktree', path: '/Users/dev/code/app/.dev/worktree/review', lastActivityAt: 950 },
      { ...base, id: 'other', machineId: 'other-computer', path: '/private/other', lastActivityAt: 1000 },
      { ...base, id: 'side', path: '/side-chat', isSideChat: true, lastActivityAt: 2000 },
    ];
    // Act
    const result = recentWorkspaceOptions(sessions, computers, [{ machineId: 'mbp', path: '~/code/app', usedAt: 1200 }], 'mbp');
    // Assert
    expect(result.map((item) => item.path)).toEqual(['/Users/dev/code/app', '/Users/dev/code/app/.dev/worktree/review']);
    expect(result[0]).toMatchObject({ displayPath: '~/code/app', usedAt: 1200 });
    expect(result[1].checkout).toBe('review');
  });

  it('should prepare a clean draft in the selected checkout without inherited prompt or model choices', () => {
    // Arrange / Act
    const result = draftInWorkspace({ machineId: 'computer', path: '/code/app/.dev/worktree/review' }, 'Codex');
    // Assert
    expect(result).toMatchObject({ path: '/code/app', type: 'Worktree', worktree: '/code/app/.dev/worktree/review',
      agent: 'Codex', model: '', effort: null, prompt: '' });
  });

  it('should retain recent workspace choices across reload without mixing computers', () => {
    // Arrange
    const state = createInitialState(1000000);
    const first = demoReducer(state, { type: 'rememberWorkspace', value: { machineId: 'mbp', path: '/shared/path', usedAt: 100 } });
    const second = demoReducer(first, { type: 'rememberWorkspace', value: { machineId: 'mini', path: '/shared/path', usedAt: 200 } });
    const updated = demoReducer(second, { type: 'rememberWorkspace', value: { machineId: 'mbp', path: '/shared/path', usedAt: 300 } });
    // Act
    const restored = restoreState(JSON.stringify({ ...updated, sessions: [], recentWorkspaces: [
      ...updated.recentWorkspaces!, { machineId: 42, path: false, usedAt: 'invalid' },
    ] }), state);
    // Assert
    expect(restored.recentWorkspaces).toHaveLength(2);
    expect(recentWorkspaceOptions([], machines, restored.recentWorkspaces!, 'mbp')).toMatchObject([{ usedAt: 300, machineId: 'mbp' }]);
    expect(recentWorkspaceOptions([], machines, restored.recentWorkspaces!, 'mini')).toMatchObject([{ usedAt: 200, machineId: 'mini' }]);
  });
});
