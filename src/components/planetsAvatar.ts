import { Avatar, Style } from '@dicebear/core';
import planets from '@dicebear/styles/planets.json' with { type: 'json' };

const style = new Style(planets);

// Keep the session identity stable across views, reloads, and offline use.
export function planetsAvatar(sessionId: string): string {
  return new Avatar(style, { seed: sessionId, idRandomization: false }).toDataUri();
}
