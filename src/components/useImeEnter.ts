import { useMemo, useRef } from 'react';
import type { CompositionEvent, KeyboardEvent } from 'react';

// Safari ends the composition before it sends the keydown for the Enter that confirms an IME choice,
// such as a Zhuyin or Pinyin choice. That keydown has isComposing false and can have keyCode 13.
const CONFIRM_WINDOW_MS = 100;

/** Tells a text field whether an Enter keydown confirms an IME choice. That Enter must not send or start anything. */
export function useImeEnter() {
  const composing = useRef(false);
  const endedAt = useRef(-Infinity);
  return useMemo(() => ({
    composing,
    onCompositionStart() { composing.current = true; },
    onCompositionEnd(event: CompositionEvent) {
      composing.current = false;
      endedAt.current = event.timeStamp;
    },
    confirms(event: KeyboardEvent) {
      const native = event.nativeEvent;
      if (composing.current || native.isComposing || native.keyCode === 229) return true;
      // Only the first keydown after the composition can be the confirming Enter.
      const sinceEnd = event.timeStamp - endedAt.current;
      endedAt.current = -Infinity;
      return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
        && sinceEnd < CONFIRM_WINDOW_MS;
    },
  }), []);
}
