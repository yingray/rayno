import { useEffect, useSyncExternalStore } from 'react';
import { useEventCallback } from '../components/useEventCallback';

// Command+1–9 on Apple keyboards, Control+1–9 elsewhere, like browser tab shortcuts.
const appleKeyboard = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modifierKey = appleKeyboard ? 'Meta' : 'Control';
export const shortcutPrefix = appleKeyboard ? '⌘' : 'Ctrl+';
const modifierHeld = (event: KeyboardEvent) => (appleKeyboard ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

let hints = false;
// A mounted session list publishes its rows, including its search filter. Without a list, the app shell order applies.
let listed: string[] | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function showHints(value: boolean) {
  if (hints === value) return;
  hints = value;
  listeners.forEach(listener => listener());
}

/** True while the shortcut modifier is held alone. The session list shows row numbers then. */
export function useShortcutHints() {
  return useSyncExternalStore(subscribe, () => hints, () => false);
}

export function publishListedOrder(ids: string[]) {
  listed = ids;
  return () => { if (listed === ids) listed = null; };
}

/** Switches to the nth session row with the modifier and a digit from 1 to 9. */
export function useSessionShortcuts(fallback: string[], select: (id: string) => void) {
  const keydown = useEventCallback((event: KeyboardEvent) => {
    if (event.key === modifierKey) {
      if (!event.repeat) showHints(!event.shiftKey && !event.altKey);
      return;
    }
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (!digit || !modifierHeld(event) || event.shiftKey || event.altKey || event.isComposing) {
      showHints(false);
      return;
    }
    const id = (listed ?? fallback)[Number(digit[1]) - 1];
    if (!id) return;
    event.preventDefault();
    if (!event.repeat) select(id);
  });
  useEffect(() => {
    const hide = () => showHints(false);
    const keyup = (event: KeyboardEvent) => { if (event.key === modifierKey) hide(); };
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      hide();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [keydown]);
}
