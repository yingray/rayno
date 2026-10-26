import { describe, expect, it, vi } from 'vitest';
import { createSessionGitStore, gitReportKey, sessionGitSummary } from './sessionGit';
import type { GitSnapshot } from './gitChanges';
import { createUIState } from './uiState';
import { createInitialState } from './fixtures';

const report = { branch: '—', additions: 0, deletions: 0, gitReported: false };
const snapshot: GitSnapshot = { root: '/repo', branch: 'feature/read', ahead: 0, behind: 0,
  files: [{ path: 'a.ts', index: 'M', working: 'M', conflict: false, stagedStat: { added: 2, removed: 1, binary: false }, workingStat: { added: 3, removed: 2, binary: false } }] };
const read = { snapshot, reported: gitReportKey(report), reportedBranch: report.branch, readAt: 1234 };
describe('Session Git summaries', () => {
  it('should distinguish an unreported Git state from a known clean repository', () => {
    // Act / Assert
    expect(sessionGitSummary(report).known).toBe(false);
    expect(sessionGitSummary({ ...report, gitReported: true }).known).toBe(true);
    expect(sessionGitSummary(report, { ...read, snapshot: { ...snapshot, files: [] } })).toMatchObject({ known: true, additions: 0, deletions: 0 });
  });
  it('should reuse a Git read in the chat header and prefer a later changed CLI report', () => {
    // Act / Assert
    expect(sessionGitSummary(report, read)).toMatchObject({ branch: 'feature/read', additions: 5, deletions: 3, known: true });
    const reported = { branch: 'main', additions: 10, deletions: 4, gitReported: true };
    const cached = { ...read, reported: gitReportKey(reported), reportedBranch: reported.branch };
    expect(sessionGitSummary(reported, cached).branch).toBe('feature/read');
    expect(sessionGitSummary({ ...reported, additions: 11 }, cached)).toMatchObject({ branch: 'main', additions: 11, deletions: 4 });
    expect(sessionGitSummary({ ...report, branch: 'feature/another-branch' }, read)).toMatchObject({ branch: 'feature/another-branch', known: false });
  });
  it('should notify only the matching session without publishing a workspace update', () => {
    // Arrange
    const store = createSessionGitStore(), current = vi.fn(), other = vi.fn();
    store.subscribe('a', current); store.subscribe('b', other);
    // Act
    store.publish('a', read);
    // Assert
    expect(current).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
    expect(store.get('a')).toBe(read);
  });
  it('should isolate reads by account and clear them on session removal or demo reset', () => {
    // Arrange
    const account = createUIState(createInitialState(0)), other = createUIState(createInitialState(0));
    account.git.publish('floating-panels', read);
    // Act / Assert
    expect(other.git.get('floating-panels')).toBeUndefined();
    account.dispatch({ type: 'delete', id: 'floating-panels' });
    expect(account.git.get('floating-panels')).toBeUndefined();
    account.git.publish('a', read); account.dispatch({ type: 'reset', state: createInitialState(0) });
    expect(account.git.get('a')).toBeUndefined();
  });
});
