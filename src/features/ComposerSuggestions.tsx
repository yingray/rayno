import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Icon } from '../components/ui';
import styles from './chat.module.css';

export type Suggestion = { key: string; text: string; kind: 'command' | 'file' | 'folder'; label: string; detail?: string };

// Rows keep the 48px pitch of v1 `AgentInputAutocomplete`. The list never takes focus, so the phone keyboard stays open.
export const ComposerSuggestions = memo(function ComposerSuggestions({ id, input, items, selected, onPick }: {
  id: string; input: RefObject<HTMLTextAreaElement | null>; items: Suggestion[]; selected: number; onPick: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(320);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const measure = () => {
      const frame = input.current?.closest('[data-focus-frame]');
      if (!frame) return;
      const header = frame.closest('[aria-label="Chat session"]')?.querySelector('header');
      const top = Math.max(viewport?.offsetTop ?? 0, header?.getBoundingClientRect().bottom ?? 0);
      setMaxHeight(Math.max(96, Math.min(320, frame.getBoundingClientRect().top - top - 16)));
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [input, items.length]);
  useLayoutEffect(() => {
    // Scroll only the list. scrollIntoView can also move the conversation behind it.
    const element = list.current, row = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !row) return;
    if (row.offsetTop < element.scrollTop) element.scrollTop = row.offsetTop - 6;
    else if (row.offsetTop + row.offsetHeight > element.scrollTop + element.clientHeight)
      element.scrollTop = row.offsetTop + row.offsetHeight - element.clientHeight + 6;
  }, [selected, items]);
  return (
    <div ref={list} id={id} role="listbox" className={styles.suggestions} style={{ maxHeight }}
      aria-label={items[0]?.kind === 'command' ? 'Command suggestions' : 'File suggestions'}
      onMouseDown={(event) => event.preventDefault()}>
      {items.map((item, index) => (
        <div key={item.key} id={`${id}-${index}`} role="option" aria-selected={index === selected}
          className={styles.suggestion} onClick={() => onPick(index)}>
          <Icon name={item.kind === 'command' ? 'terminalOutline' : item.kind === 'folder' ? 'folderOutline' : 'documentTextOutline'} size={16} />
          <strong>{item.label}</strong>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </div>
  );
});
