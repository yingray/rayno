import { memo, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { Button } from '../components/ui';
import { useDemo, useDraft } from '../data/store';
import { useTextareaSize } from '../components/useTextareaSize';
import styles from './chat.module.css';

// Draft edits must not render the chat header, message list, or model controls.
export const DraftComposer = memo(function DraftComposer({
  sessionId, input, archived, needsResume, disabled, offline, pending, hasAttachments, onSend, children,
}: {
  sessionId: string;
  input: RefObject<HTMLTextAreaElement | null>;
  archived: boolean;
  /** An ended CLI session that only the Happy app can resume. */
  needsResume: boolean;
  disabled: boolean;
  offline: boolean;
  pending: boolean;
  hasAttachments: boolean;
  onSend: (value: string) => Promise<void>;
  children: ReactNode;
}) {
  const value = useDraft(sessionId);
  const { enterToSend, dispatch } = useDemo((store) => ({
    enterToSend: store.state.preferences.enterToSend,
    dispatch: store.dispatch,
  }));
  const composing = useRef(false);
  useTextareaSize(input, value);

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Safari can clear isComposing before the Enter that confirms an IME choice.
    if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229) return;
    if ((enterToSend && !event.shiftKey) || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void onSend(event.currentTarget.value);
    }
  }

  return <>
    <textarea
      ref={input}
      aria-label="Message"
      placeholder={offline && !archived ? 'Draft a message while offline…'
        : disabled ? needsResume ? 'Resume this agent in the Happy app to send a message'
          : archived ? 'Restore this session to send a message' : 'This agent is offline'
          : 'Type a message…'}
      value={value}
      onChange={(event) => dispatch({ type: 'draft', id: sessionId, value: event.target.value })}
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
        onClick={() => { if (!composing.current) void onSend(input.current?.value ?? value); }}
      />
    </div>
  </>;
});
