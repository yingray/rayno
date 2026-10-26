import type { GitSnapshot } from './gitChanges';
import type { Session } from './types';

type Report = Pick<Session, 'branch' | 'additions' | 'deletions' | 'gitReported'>;
export const gitReportKey = (session: Report) => JSON.stringify([session.branch, session.additions, session.deletions, !!session.gitReported]);
export type SessionGitRead = { snapshot: GitSnapshot; reported: string; reportedBranch: string; readAt: number };
export function createSessionGitStore() {
  const values = new Map<string, SessionGitRead>(), listeners = new Map<string, Set<() => void>>();
  return {
    get: (id: string) => values.get(id),
    subscribe(id: string, listener: () => void) {
      let set = listeners.get(id); if (!set) listeners.set(id, set = new Set());
      set.add(listener); return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
    },
    publish(id: string, value: SessionGitRead) { values.set(id, value); listeners.get(id)?.forEach(listener => listener()); },
    clear(id?: string) {
      if (id !== undefined) { values.delete(id); listeners.get(id)?.forEach(listener => listener()); }
      else { values.clear(); listeners.forEach(set => set.forEach(listener => listener())); }
    },
  };
}
export function sessionGitSummary(session: Report, read?: SessionGitRead, demo = false) {
  // A newer CLI report replaces the previous explicit read. An unchanged report cannot hide that read.
  const branchChanged = read && session.branch && session.branch !== '—' && session.branch !== read.reportedBranch && session.branch !== read.snapshot.branch;
  if (read && !branchChanged && (!session.gitReported || read.reported === gitReportKey(session))) {
    const stats = read.snapshot.files.flatMap(file => [file.workingStat, file.stagedStat]);
    return { branch: read.snapshot.branch || session.branch, additions: stats.reduce((sum, value) => sum + (value?.added ?? 0), 0),
      deletions: stats.reduce((sum, value) => sum + (value?.removed ?? 0), 0), files: read.snapshot.files.length, known: true, readAt: read.readAt };
  }
  return { branch: session.branch, additions: session.additions, deletions: session.deletions, files: undefined,
    known: (demo || !!session.gitReported) && Number.isFinite(session.additions) && Number.isFinite(session.deletions), readAt: undefined };
}
