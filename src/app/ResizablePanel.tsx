import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, PropsWithChildren } from 'react';
import { useDemo } from '../data/store';
import { useText } from '../i18n';
import { useEventCallback } from '../components/useEventCallback';
import { clampPanelWidth, defaultPanelWidth, panelWidthBounds, savedPanelWidth, type PanelKind } from './panelWidths';
import styles from './app.module.css';

export function ResizablePanel({ kind, children }: PropsWithChildren<{ kind: PanelKind }>) {
  const t = useText();
  const live = useDemo(store => store.live);
  const key = `panelWidth.${kind}`;
  const [preferred, setPreferred] = useState<number | null>(() => {
    try { return savedPanelWidth(live ? live.readLocal(key) : localStorage.getItem('rayno.demo.' + key), kind); }
    catch { return null; }
  });
  const [space, setSpace] = useState({ available: Infinity, viewport: window.innerWidth });
  const [resizing, setResizing] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const separator = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number; preferred: number | null } | null>(null);
  const panelId = useId();
  const bounds = panelWidthBounds(kind, space.available);
  const width = clampPanelWidth(preferred ?? defaultPanelWidth(kind, space.viewport), bounds);
  const currentWidth = useRef(width);
  currentWidth.current = width;
  const persist = (value: number) => {
    try {
      if (live) live.writeLocal(key, String(value));
      else localStorage.setItem('rayno.demo.' + key, String(value));
    } catch { /* A blocked browser store must not prevent resizing. */ }
  };
  useLayoutEffect(() => {
    const panel = frame.current!, main = panel.previousElementSibling as HTMLElement;
    const shell = panel.parentElement!;
    const measure = () => {
      const available = main.clientWidth + panel.getBoundingClientRect().width;
      setSpace(previous => Math.abs(previous.available - available) < 0.5 && previous.viewport === window.innerWidth
        ? previous : { available, viewport: window.innerWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell); observer.observe(main); observer.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const finish = useEventCallback((cancel = false) => {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    if (cancel) setPreferred(start.preferred);
    else persist(currentWidth.current);
    setResizing(false);
    if (separator.current?.hasPointerCapture(start.pointer)) separator.current.releasePointerCapture(start.pointer);
  });
  useLayoutEffect(() => {
    const cancel = () => finish(true);
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, [finish]);
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, width, preferred };
    setResizing(true);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const next = clampPanelWidth(start.width + start.x - event.clientX, bounds);
    currentWidth.current = next;
    setPreferred(next);
  }
  function reset() {
    finish(true);
    const value = clampPanelWidth(defaultPanelWidth(kind, window.innerWidth), bounds);
    setPreferred(null);
    try {
      if (live) live.writeLocal(key, ''); else localStorage.removeItem('rayno.demo.' + key);
    } catch { /* Retain the default for this visit when storage is unavailable. */ }
    currentWidth.current = value;
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    if (event.key === 'Enter') { event.preventDefault(); reset(); return; }
    const step = event.shiftKey ? 50 : 10;
    const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step
      : event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const value = clampPanelWidth(next, bounds);
    setPreferred(value); persist(value);
  }
  return <div ref={frame} className={styles.resizablePanel} style={{ width }} data-resizing={resizing || undefined} data-panel-kind={kind}>
    <button ref={separator} type="button" role="separator" aria-orientation="vertical" aria-controls={panelId}
      aria-label={t(kind === 'info' ? 'Resize session info' : 'Resize side chat')}
      aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width} aria-valuetext={t('{width} pixels', { width: String(width) })}
      title={t('Drag to resize. Use arrow keys to adjust. Double-click or press Enter to reset.')}
      className={styles.panelSeparator} onPointerDown={start} onPointerMove={move}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) finish(); }}
      onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) finish(true); }}
      onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) finish(); }}
      onKeyDown={keyboard} onDoubleClick={reset} />
    <aside id={panelId} className={kind === 'info' ? styles.infoPanel : styles.sidePanel}>{children}</aside>
  </div>;
}
