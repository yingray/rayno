import { memo, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { highlightCode } from './syntaxHighlight';
import { copyText, Icon } from '../components/ui';
import styles from './chat.module.css';

type Tokens = NonNullable<ReturnType<typeof highlightCode>>;

function renderToken(token: Tokens[number], index: number): ReactNode {
  if (token.type === 'text') return token.value;
  if (token.type !== 'element') return null;
  const classes = token.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(' ') : undefined}>
    {token.children.map(renderToken)}
  </span>;
}

export const CodeBlock = memo(function CodeBlock({ source, language, filename, notify }: {
  source: string; language: string; filename: string; notify: (message: string) => void;
}) {
  const frame = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [highlight, setHighlight] = useState<{ source: string; language: string; tokens?: Tokens }>();
  const current = highlight?.source === source && highlight.language === language ? highlight : undefined;

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Keep long or incomplete streaming blocks readable without blocking input.
    if (!visible || !language || source.length > 40000) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void import('./syntaxHighlight').then(({ highlightCode }) => {
        if (active) setHighlight({ source, language, tokens: highlightCode(source, language) });
      }).catch(() => { /* Keep plain code if a grammar or chunk is unavailable. */ });
    }, 100);
    return () => { active = false; clearTimeout(timer); };
  }, [source, language, visible]);

  const label = language || 'Plain text';
  return <figure ref={frame} className={styles.codeBlock} aria-label={`${label} code block`}>
    <figcaption className={styles.codeHeader}>
      <span className={styles.codeTitle}>
        <Icon name="codeSlash" size={15} />
        <span>{filename === 'Code' ? label : filename}</span>
        {filename !== 'Code' && language && <small>{language}</small>}
      </span>
      <button type="button" aria-label="Copy code" onClick={() => void copyText(source, notify)}>
        <Icon name="copyOutline" size={15} />Copy
      </button>
    </figcaption>
    <pre role="region" aria-label={`${label} code`} tabIndex={0} onKeyDown={event => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const left = event.key === 'ArrowLeft' ? -64 : event.key === 'ArrowRight' ? 64 : 0;
      if (!left) return;
      event.preventDefault();
      event.currentTarget.scrollBy({ left });
    }}>
      <code className={language ? `language-${language}` : undefined}>
        {current?.tokens ? current.tokens.map(renderToken) : source}
      </code>
    </pre>
  </figure>;
});
