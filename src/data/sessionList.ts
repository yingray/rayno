import type { Session, SessionListMode } from './types';

// Live sessions use the agent's published activity time. Demo sessions use their local update time.
export const sessionActivityAt = (session: Session) => session.lastActivityAt ?? session.updatedAt;

export function compareSessionActivity(a: Session, b: Session): number {
  return sessionActivityAt(b) - sessionActivityAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const isSessionFaded = (session: Session) =>
  session.archived || (session.machineOffline ?? session.status === 'offline');

export function formatSessionTimestamp(timestamp: number, now: number): string {
  const time = Math.min(timestamp, now);
  const age = now - time;
  if (age >= 86400000) {
    return new Date(time).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (age < 60000) return 'just now';
  const unit = age < 3600000 ? 'minute' : 'hour';
  const count = Math.floor(age / (unit === 'minute' ? 60000 : 3600000));
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

// The session list shows these rows: one archive view, filtered by the search text, newest activity first.
export function listedSessions(sessions: Session[], archived: boolean, query = ''): Session[] {
  const text = query.trim().toLowerCase();
  return sessions
    .filter(session => !session.isSideChat && session.archived === archived
      && `${session.workspace} ${session.customTitle || session.title} ${session.project}`.toLowerCase().includes(text))
    .sort(compareSessionActivity);
}

// Project mode groups rows by project in the order of each project's newest session. Flat mode has one group.
export function sessionGroups(sessions: Session[], mode: SessionListMode): string[] {
  return mode === 'projects' ? Array.from(new Set(sessions.map(session => session.project))) : [''];
}

// The rows from top to bottom, as the list draws them group by group.
export function sessionListOrder(sessions: Session[], groups: string[]): Session[] {
  return groups.flatMap(group => sessions.filter(session => !group || session.project === group));
}
