import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { copyText, Icon } from '../components/ui';
import { RECAP_TEXT_LIMIT } from '../data/messageRecap';
import type { MessageRecap } from '../data/recapView';
import {
  cycleRecapRate, estimateSeconds, formatSeconds, recapElapsed, speechSupported,
  toggleRecapSpeech, useRecapClock, useRecapSpeech,
} from './recapSpeech';
import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';
import styles from './recap.module.css';

const OPEN_KEY = 'rayno.recapOpen';
// Open cards for this browser session, by message ID.
let openCards: Set<string> | undefined;
function openSet() {
  if (!openCards) {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(OPEN_KEY) || '[]');
      openCards = new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
    } catch { openCards = new Set(); }
  }
  return openCards;
}
function rememberOpen(id: string, open: boolean) {
  const ids = openSet();
  if (open) ids.add(id); else ids.delete(id);
  try { sessionStorage.setItem(OPEN_KEY, JSON.stringify([...ids])); }
  catch { /* Keep the open state in memory if storage is unavailable. */ }
}

const rateLabel = (rate: number) => `${rate}×`;

export const RecapCard = memo(function RecapCard({ messageId, value, writing, onJump, notify }: {
  messageId: string;
  // Undefined for the placeholder card of a recap that the agent writes now.
  value?: MessageRecap;
  writing: boolean;
  onJump: (messageId: string, index: number) => void;
  notify: (message: string) => void;
}) {
  const bodyId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(() => openSet().has(messageId));
  const [more, setMore] = useState(false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const textRef = useRef<HTMLDivElement>(null);
  const speech = useRecapSpeech();
  const recap = value?.recap;
  const own = !!recap && speech.key === messageId && speech.text === recap.text;
  const status = own ? speech.status : 'idle';
  useRecapClock(status === 'playing');
  const supported = speechSupported();
  const activePoint = own && speech.point !== null ? speech.point
    : speech.selected?.key === messageId ? speech.selected.index : null;
  const total = recap ? estimateSeconds(recap.text, speech.rate) : 0;
  const elapsed = own ? Math.min(total, recapElapsed()) : 0;
  const expanded = open && !!recap;
  const long = !!recap && recap.text.length > RECAP_TEXT_LIMIT;
  function toggleOpen() {
    rememberOpen(messageId, !open);
    setOpen(!open);
  }
  // Show the full text when keyboard focus reaches a point below the 3-line clamp.
  // Otherwise the clamp box scrolls to the point and keeps that offset after the focus moves on.
  function revealFocused(event: FocusEvent<HTMLDivElement>) {
    if (!long || more) return;
    // Chromium scrolls the clamp box before the focus event, WebKit after it.
    const frame = event.currentTarget.getBoundingClientRect();
    const box = event.target.getBoundingClientRect();
    if (event.currentTarget.scrollTop > 0 || box.bottom > frame.bottom + 1 || box.top < frame.top - 1) setMore(true);
  }
  // A clamp box that comes back after "Show less" starts at the first line.
  useLayoutEffect(() => {
    if (textRef.current) textRef.current.scrollTop = 0;
  }, [more, expanded]);
  return (
    <section
      className={styles.card}
      aria-label="Recap"
      data-recap-card
      data-testid="recap-card"
      data-message-id={messageId}
      data-state={expanded ? 'open' : 'closed'}
      data-manual={value?.manual || undefined}
      aria-busy={writing || undefined}
    >
      <div className={styles.row}>
        {supported && recap && !writing && (
          <button
            type="button"
            className={styles.play}
            aria-label={status === 'playing' ? 'Pause recap' : 'Play recap'}
            onClick={() => toggleRecapSpeech(messageId, recap)}
          >
            <Icon name={status === 'playing' ? 'pause' : 'play'} size={15} />
          </button>
        )}
        <span className={styles.label}>
          <Icon name="sparkles" size={13} />
          Recap
        </span>
        {writing ? (
          <span className={`${styles.summary} ${styles.writing}`} role="status">Writing recap…</span>
        ) : expanded ? (
          <span className={styles.meta}>
            {value!.manual ? 'Manual recap' : 'Auto after long replies'} · {recap!.text.length} chars
          </span>
        ) : (
          <span className={styles.summary}>{recap?.text}</span>
        )}
        {supported && recap && !writing && !speech.unreliable && (
          <span className={styles.time} data-testid="recap-time">
            {formatSeconds(elapsed)} / {formatSeconds(total)}
          </span>
        )}
        {recap && !writing && (
          <button
            type="button"
            className={styles.chevron}
            aria-label={expanded ? 'Hide recap details' : 'Show recap details'}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={toggleOpen}
          >
            {/* The design points the chevron up on a closed card and down on an open card. */}
            <Icon name={expanded ? 'chevronDown' : 'chevronUp'} size={15} />
          </button>
        )}
      </div>
      {expanded && !writing && (
        <div className={styles.body} id={bodyId}>
          <div ref={textRef} className={`${styles.text} ${long && !more ? styles.clamped : ''}`} onFocus={revealFocused}>
            {recap.segments.map((segment, index) => {
              if (segment.kind === 'text') return <span key={index}>{segment.text}</span>;
              if (!value!.targets[segment.index - 1]) return <span key={index}>{segment.text}</span>;
              const active = activePoint === segment.index;
              return (
                <span key={index}>
                  <button
                    type="button"
                    className={styles.point}
                    data-active={active}
                    data-recap-jump
                    data-point={segment.index}
                    aria-describedby={hintId}
                    onClick={() => onJump(messageId, segment.index)}
                  >
                    {segment.text}
                  </button>
                  <button
                    type="button"
                    className={styles.pin}
                    data-active={active}
                    data-recap-jump
                    data-point={segment.index}
                    aria-label={`Jump to point ${segment.index}`}
                    onClick={() => onJump(messageId, segment.index)}
                  >
                    {segment.index}
                  </button>
                </span>
              );
            })}
          </div>
          {long && (
            <button type="button" className={styles.more} aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          )}
          <div className={styles.hint}>
            <Icon name="handLeftOutline" size={12} />
            {/* One hint element, so the phrase description matches the layout. Phones have no pin rail. */}
            <span className={styles.hintText} id={hintId}>
              {desktop ? 'Tap a phrase or a pin on the right to jump to that part of the reply' : 'Tap a phrase to jump to that part of the reply'}
            </span>
            {supported && (
              <button
                type="button"
                className={`${styles.tool} ${styles.rate}`}
                aria-label={`Reading speed ${rateLabel(speech.rate)}`}
                title="Change the reading speed"
                onClick={cycleRecapRate}
              >
                {rateLabel(speech.rate)}
              </button>
            )}
            <button
              type="button"
              className={styles.tool}
              aria-label="Copy recap"
              onClick={() => void copyText(recap.text, notify)}
            >
              <Icon name="copyOutline" size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
});

export function RecapButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.ghost}
      aria-label="Recap this reply"
      data-testid="recap-ghost"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="sparkles" size={13} />
      Recap
    </button>
  );
}
