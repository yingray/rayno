import type { Session } from '../data/types';

export type TabAttention = { count: number; needsInput: boolean };

const listed = (session: Session) => !session.archived && !session.isSideChat;

// The count uses the same unread and needs-input states as the session list.
export function tabAttention(sessions: Session[]): TabAttention {
  let count = 0, needsInput = false;
  for (const session of sessions) {
    if (!listed(session)) continue;
    if (session.unread || session.needsReply) count++;
    // As in v1, only a connected session that waits for the user changes the icon.
    if (session.needsReply && session.status !== 'offline') needsInput = true;
  }
  return { count, needsInput };
}

export const attentionTitle = (title: string, count: number) =>
  count > 0 ? `(${count > 99 ? '99+' : count}) ${title}` : title;

export const faviconFor = (needsInput: boolean) => needsInput ? '/icons/rayno-attention.svg' : '/icons/rayno.svg';

export function applyFavicon(needsInput: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const href = faviconFor(needsInput);
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
}
