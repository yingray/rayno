import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, copyText, Dialog, Icon } from '../components/ui';
import { renderDiagram } from './mermaidClient';
import styles from './mermaid.module.css';

// Below this scale, labels get too small to read, so the preview scrolls instead.
const minimumFitScale = 0.7;
const maximumZoom = 3;
const zoomStep = 1.5;

const DiagramViewer = memo(function DiagramViewer({ url, naturalWidth, onClose }: {
  url: string; naturalWidth: number; onClose: () => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  // Scale is relative to the diagram's own size, so 100% shows labels at their real size.
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = view.current;
    if (!element) return;
    let previousFit: number | undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const fit = Math.min(1, width / naturalWidth);
      // After a rotation, a fitted diagram stays fitted and zoom never drops below the new fit.
      setScale((value) => previousFit === undefined ? 1 : value === previousFit ? fit : Math.max(fit, value));
      setFitScale(fit);
      previousFit = fit;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [naturalWidth]);
  const zoom = (next: number) => setScale(Math.min(maximumZoom, Math.max(fitScale, next)));
  return <Dialog title="Mermaid diagram" className={styles.fullscreen} onClose={onClose}>
    <div ref={view} className={styles.fullscreenView} role="region" aria-label="Full screen diagram" tabIndex={0}>
      <img src={url} alt="Mermaid diagram" style={{ width: `${Math.round(naturalWidth * scale)}px` }} />
    </div>
    <footer className={styles.zoomBar}>
      <Button icon="remove" aria-label="Zoom out" disabled={scale <= fitScale}
        onClick={() => zoom(scale / zoomStep)} />
      <Button aria-label="Fit diagram to screen" disabled={scale === fitScale} onClick={() => zoom(fitScale)}>
        Fit
      </Button>
      <span aria-live="polite">{Math.round(scale * 100)}%</span>
      <Button icon="add" aria-label="Zoom in" disabled={scale >= maximumZoom}
        onClick={() => zoom(scale * zoomStep)} />
    </footer>
  </Dialog>;
});

export const MermaidDiagram = memo(function MermaidDiagram({ source, notify }: {
  source: string; notify: (message: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ source: string; url?: string; error?: boolean }>();
  const current = result?.source === source ? result : undefined;
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [fit, setFit] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let url: string | undefined;
    // Coalesce partial Mermaid fences while an agent streams a response.
    const timer = window.setTimeout(() => {
      void renderDiagram(source).then((svg) => {
        if (!active) return;
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setResult({ source, url });
      }).catch(() => { if (active) setResult({ source, error: true }); });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, visible]);

  // Fit the preview to the chat width when labels stay readable; otherwise scroll.
  useEffect(() => {
    const element = viewport.current;
    if (!element || !naturalWidth) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setFit(width / naturalWidth >= minimumFitScale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [naturalWidth]);

  const scrolls = !!current?.url && !fit;
  return <figure className={styles.diagram} aria-label="Mermaid preview" aria-busy={!current}
    data-fit={fit ? 'fit' : 'scroll'}>
    <div className={styles.header}>
      <span>Mermaid</span>
      <span className={styles.actions}>
        {scrolls && (
          <button ref={expand} aria-label="Open diagram full screen" onClick={() => setExpanded(true)}>
            <Icon name="expandOutline" size={13} />Expand
          </button>
        )}
        <button aria-label="Copy diagram source" onClick={() => void copyText(source, notify)}>
          <Icon name="copyOutline" size={13} />Copy
        </button>
      </span>
    </div>
    <div ref={viewport} className={styles.viewport} role="region" aria-label="Mermaid diagram" tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const offset = { ArrowLeft: [-64, 0], ArrowRight: [64, 0], ArrowUp: [0, -64], ArrowDown: [0, 64] }[event.key];
        if (!offset) return;
        event.preventDefault();
        event.currentTarget.scrollBy({ left: offset[0], top: offset[1] });
      }}>
      {current?.url ? <img src={current.url} alt="Mermaid diagram" decoding="async"
        onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
        onError={() => setResult({ source, error: true })} />
        : <p role="status">{current?.error ? 'Diagram preview unavailable. Read the source below.' : 'Render diagram…'}</p>}
    </div>
    {scrolls && <p className={styles.swipeHint}>Swipe for more <Icon name="arrowForward" size={12} /></p>}
    {expanded && current?.url && (
      <DiagramViewer url={current.url} naturalWidth={naturalWidth} onClose={() => {
        setExpanded(false);
        // Safari does not focus tapped buttons, and a rotation can remove Expand.
        requestAnimationFrame(() => {
          if (!viewport.current?.closest('figure')?.contains(document.activeElement))
            (expand.current ?? viewport.current)?.focus();
        });
      }} />
    )}
    <details className={styles.source} open={!!current?.error}>
      <summary>Mermaid source</summary>
      <pre><code>{source}</code></pre>
    </details>
  </figure>;
});
