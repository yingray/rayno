import type { Session } from './types';

// Happy CLI side chats start without a summary, so the list numbers them like Happy Web does.
export const SIDE_CHAT_TITLE = 'Side chat';

/** The side chats of one parent, oldest first, so that labels and tabs keep their order (sync/storage.ts useSideChatSessions). */
export function sideChatsOf(sessions: Session[], parentId: string): Session[] {
  return sessions.filter((session) => session.isSideChat && session.parentSessionId === parentId && session.id !== parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Happy Web numbers the open side chats only. Closed ones take their own numbers so that the two lists never share a label. */
export function sideChatLabel(session: Session, index: number, name = SIDE_CHAT_TITLE) {
  if (session.customTitle) return session.customTitle;
  return session.title && session.title !== SIDE_CHAT_TITLE ? session.title : `${name} ${index + 1}`;
}

/** The open side chat to show: the requested one, else the newest open one. */
export function activeSideChat(open: Session[], requested?: string | null) {
  return open.find((session) => session.id === requested) || open[open.length - 1];
}

export const countOpenSideChats = (sessions: Session[], parentId: string) =>
  sessions.reduce((count, session) => count + (session.isSideChat && !session.archived && session.parentSessionId === parentId ? 1 : 0), 0);
