import type { Session } from './types';

// Happy CLI side chats start without a summary, so the list numbers them like Happy Web does.
export const SIDE_CHAT_TITLE = 'Side chat';

/** The side chats of one parent, oldest first, so that labels and tabs keep their order (sync/storage.ts useSideChatSessions). */
export function sideChatsOf(sessions: Session[], parentId: string): Session[] {
  return sessions.filter((session) => session.isSideChat && session.parentSessionId === parentId && session.id !== parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Happy Web closes a side chat only by its lifecycle (storage.ts useSideChatSessions). A lost connection only ends it. */
export const isSideChatClosed = (session: Session) => !!session.sideChatClosed;

/** Happy Web numbers the open side chats only. Closed ones take their own numbers so that the two lists never share a label. */
export function sideChatLabel(session: Session, index: number, name = SIDE_CHAT_TITLE) {
  if (session.customTitle) return session.customTitle;
  return session.title && session.title !== SIDE_CHAT_TITLE ? session.title : `${name} ${index + 1}`;
}

/** The labels of one parent's side chats as its panel and list show them (sideChatsOf order). */
export function sideChatLabels(chats: Session[]) {
  const open = chats.filter((chat) => !isSideChatClosed(chat)), closed = chats.filter(isSideChatClosed);
  return new Map([...open.map((chat, index) => [chat.id, sideChatLabel(chat, index)] as const),
    ...closed.map((chat, index) => [chat.id, sideChatLabel(chat, index, 'Closed side chat')] as const)]);
}

/** The full-view title of a side chat, numbered like the parent's list (Happy Web SideChatModal). */
export function sideChatTitle(sessions: Session[], id: string | undefined) {
  const session = id ? sessions.find((item) => item.id === id) : undefined;
  return session?.isSideChat && session.parentSessionId ? sideChatLabels(sideChatsOf(sessions, session.parentSessionId)).get(session.id) : undefined;
}

export const SIDE_CHAT_AGENT_LIMIT = 'This agent cannot start side chats.';

/**
 * Show the side chat entry unless the agent can never start one (a Rig, bot, or other agent) and none exist.
 * Happy Web offers side chats only for a session that it can fork (utils/sessionFork.ts getSessionForkSource).
 */
export function showSideChatEntry(sessions: Session[], session: Session, live?: { branchUnavailable(id: string, kind: 'side'): string } | null) {
  if (session.isSideChat) return false;
  if (sessions.some((item) => item.isSideChat && item.parentSessionId === session.id)) return true;
  if (!live) return session.agent !== 'Happy Agent';
  try { return live.branchUnavailable(session.id, 'side') !== SIDE_CHAT_AGENT_LIMIT; } catch { return true; }
}

/** The open side chat to show: the requested one, else the newest open one. */
export function activeSideChat(open: Session[], requested?: string | null) {
  return open.find((session) => session.id === requested) || open[open.length - 1];
}

export const countOpenSideChats = (sessions: Session[], parentId: string) =>
  sessions.reduce((count, session) => count + (session.isSideChat && !isSideChatClosed(session) && session.parentSessionId === parentId ? 1 : 0), 0);

/** A closed or deleted side chat returns to its parent's side chat list, when the parent is still known. */
export const leaveRoute = (session: Session, parentKnown: boolean) =>
  session.isSideChat && parentKnown ? `/session/${session.parentSessionId}/side` : '/sessions';

/**
 * The archive action for the session menu and info panel, or none when only a resume helps.
 * An ended side chat can still close because a lost connection does not close it.
 */
export function archiveAction(session: Session, ended: boolean) {
  if (session.isSideChat && !isSideChatClosed(session)) return 'Close side chat';
  if (ended) return null;
  return session.archived ? 'Restore session' : 'Archive session';
}

/** Unread replies in open side chats keep the parent's entry marked. */
export const hasUnreadSideChats = (sessions: Session[], parentId: string) =>
  sessions.some((session) => session.isSideChat && !isSideChatClosed(session) && session.parentSessionId === parentId && session.unread);
