import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { Button } from '../components/ui';
import { useDemo, useDraft } from '../data/store';
import { useTextareaSize } from '../components/useTextareaSize';
import { applySuggestion, findActiveWord } from '../happy/suggestions';
import { ComposerSuggestions, type Suggestion } from './ComposerSuggestions';
import styles from './chat.module.css';

type Found = { word: string; items: Suggestion[]; selected: number };

// Draft edits must not render the chat header, message list, or model controls.
export const DraftComposer = memo(function DraftComposer({
  sessionId, input, archived, needsResume, disabled, offline, pending, hasAttachments, onSend, suggest, children,
}: {
  sessionId: string;
  input: RefObject<HTMLTextAreaElement | null>;
  archived: boolean;
  /** An ended CLI session that requires recovery before sending. */
  needsResume: boolean;
  disabled: boolean;
  offline: boolean;
  pending: boolean;
  hasAttachments: boolean;
  onSend: (value: string, dismissKeyboard?: boolean) => Promise<void>;
  /** `/` command and `@` file suggestions for the word at the caret. */
  suggest?: (word: string) => Promise<Suggestion[]>;
  children: ReactNode;
}) {
  const value = useDraft(sessionId);
  const { enterToSend, dispatch } = useDemo((store) => ({
    enterToSend: store.state.preferences.enterToSend,
    dispatch: store.dispatch,
  }));
  const composing = useRef(false);
  const listId = useId();
  const [caret, setCaret] = useState<{ start: number; end: number } | null>(null);
  const [dismissed, setDismissed] = useState('');
  const [found, setFound] = useState<Found>({ word: '', items: [], selected: -1 });
  const nextCaret = useRef<number | null>(null);
  useTextareaSize(input, value);
  const active = useMemo(() => suggest && caret && caret.end <= value.length ? findActiveWord(value, caret) : undefined,
    [suggest, value, caret]);
  const word = active?.activeWord || '';
  const wordKey = active ? `${active.offset}:${word}` : '';
  useEffect(() => {
    if (!word || !suggest) return;
    let current = true;
    suggest(word).then((items) => {
      if (current) setFound((previous) => ({ word, items, selected: !items.length ? -1
        : previous.word[0] === word[0] && previous.selected >= 0 ? Math.min(previous.selected, items.length - 1) : 0 }));
    }, () => { if (current) setFound({ word, items: [], selected: -1 }); });
    return () => { current = false; };
  }, [word, suggest]);
  // Keep the last list while a newer query of the same kind loads, as v1 `useActiveSuggestions` does.
  const open = !!word && dismissed !== wordKey && found.items.length > 0 && found.word[0] === word[0];
  useLayoutEffect(() => {
    const element = input.current;
    if (nextCaret.current === null || !element) return;
    element.setSelectionRange(nextCaret.current, nextCaret.current);
    setCaret({ start: nextCaret.current, end: nextCaret.current });
    nextCaret.current = null;
  }, [value, input]);

  function readCaret(element: HTMLTextAreaElement) {
    setCaret((previous) => previous?.start === element.selectionStart && previous.end === element.selectionEnd
      ? previous : { start: element.selectionStart, end: element.selectionEnd });
  }
  function pick(index: number) {
    const item = found.items[index];
    if (!item || !caret) return;
    const result = applySuggestion(value, caret, item.text);
    const element = input.current;
    // The reducer drops a same-value draft, so the caret effect would not run and would move the next edit.
    if (result.text === value) {
      element?.setSelectionRange(result.cursorPosition, result.cursorPosition);
      const next = { start: result.cursorPosition, end: result.cursorPosition };
      const picked = findActiveWord(value, next);
      setCaret(next);
      if (picked) setDismissed(`${picked.offset}:${picked.activeWord}`);
    } else {
      nextCaret.current = result.cursorPosition;
      dispatch({ type: 'draft', id: sessionId, value: result.text });
    }
    element?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Safari can clear isComposing before the Enter that confirms an IME choice.
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (open && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const move = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (move) {
        event.preventDefault();
        setFound((previous) => ({ ...previous, selected: previous.selected < 0 ? move > 0 ? 0 : previous.items.length - 1
          : (previous.selected + move + previous.items.length) % previous.items.length }));
        return;
      }
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault();
        pick(Math.max(0, found.selected));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(wordKey);
        return;
      }
    }
    if (event.key !== 'Enter') return;
    if ((enterToSend && !event.shiftKey) || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void onSend(event.currentTarget.value);
    }
  }

  return <>
    {open && <ComposerSuggestions id={listId} input={input} items={found.items} selected={found.selected} onPick={pick} />}
    <textarea
      ref={input}
      aria-label="Message"
      aria-autocomplete={suggest ? 'list' : undefined}
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && found.selected >= 0 ? `${listId}-${found.selected}` : undefined}
      placeholder={offline && !archived ? 'Draft a message while offline…'
        : disabled ? needsResume ? 'Resume this session to send a message'
          : archived ? 'Restore this session to send a message' : 'This agent is offline'
          : 'Type a message…'}
      value={value}
      onChange={(event) => {
        dispatch({ type: 'draft', id: sessionId, value: event.target.value });
        readCaret(event.target);
      }}
      onSelect={(event) => readCaret(event.currentTarget)}
      onFocus={(event) => readCaret(event.currentTarget)}
      onBlur={() => setCaret(null)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={keyDown}
      disabled={archived}
      rows={1}
    />
    <div className={styles.composerActions}>
      {children}
      <Button
        variant="accent"
        className={styles.send}
        icon="arrowUp"
        aria-label="Send message"
        disabled={pending || disabled || (!value.trim() && !hasAttachments)}
        // Keep focus until the click so the phone keyboard cannot move the button before the tap completes.
        onMouseDown={(event) => { if (document.activeElement === input.current) event.preventDefault(); }}
        onClick={() => {
          if (!composing.current)
            void onSend(input.current?.value ?? value, window.matchMedia('(pointer: coarse)').matches);
        }}
      />
    </div>
  </>;
});
