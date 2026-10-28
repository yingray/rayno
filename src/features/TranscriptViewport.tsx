import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ChatBlock } from '../data/chatBlocks';
import type { TranscriptAnchor, TranscriptMemory } from '../data/transcript';
import { useEventCallback } from '../components/useEventCallback';
import styles from './transcript.module.css';

export type TranscriptController = {
  enabled: boolean;
  latest(): void;
  unpin(): void;
  capture(actual?: boolean): TranscriptAnchor | undefined;
  mount(id: string, inset?: number): Promise<HTMLElement | null>;
  offset(id: string): number | undefined;
};
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function TranscriptViewport({ blocks, enabled, full, scroll, pinned, controller, memory, layoutKey, ready,
  render, onMode, onPinned, persist }: {
  blocks: ChatBlock[]; enabled: boolean; full: boolean;
  scroll?: RefObject<HTMLDivElement | null>; pinned: RefObject<boolean>;
  controller: RefObject<TranscriptController | null>; memory: TranscriptMemory; layoutKey: string;
  ready: boolean;
  render: (block: ChatBlock) => ReactNode;
  onMode: (enabled: boolean) => void;
  onPinned: (pinned: boolean) => void;
  persist: (anchor: TranscriptAnchor) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ origin: 0, tail: 0, top: 80, bottom: 160, width: 0, height: 0 });
  const [forced, setForced] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState<string>();
  // Scroll ownership changes before the next render or animation frame.
  const manualRef = useRef(false);
  const followFrame = useRef<number | undefined>(undefined);
  const generation = useRef(0), jumping = useRef(false), initialized = useRef(false);
  const saved = useRef(memory.anchor);
  const anchored = useRef(memory.anchor?.id);
  const userScrolling = useRef(false);
  const anchorRevision = useRef(0);
  const pendingMount = useRef<{ id: string; inset: number; run: Promise<HTMLElement | null> } | undefined>(undefined);
  const indices = useMemo(() => new Map(blocks.map((block, index) => [block.id, index])), [blocks]);
  const notifyLayout = useEventCallback(() => scroll?.current?.dispatchEvent(new Event('rayno:transcript-layout')));
  const currentLayout = `${Math.round(geometry.width)}:${layoutKey}`;
  const estimate = (index: number) => {
    const block = blocks[index];
    const measured = memory.layout === currentLayout ? memory.heights.get(block.id) : undefined;
    if (measured !== undefined) return measured;
    return block.kind === 'tools' ? 120 : block.kind === 'message'
      ? Math.min(1200, 72 + Math.ceil(block.message.content.length / Math.max(25, geometry.width / 8)) * 22) : 64;
  };
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: blocks.length, enabled,
    getScrollElement: () => scroll?.current || null,
    getItemKey: useCallback((index: number) => blocks[index].id, [blocks]),
    estimateSize: estimate,
    overscan: 8,
    paddingStart: geometry.origin, paddingEnd: geometry.tail,
    scrollPaddingStart: geometry.top, scrollPaddingEnd: geometry.bottom,
    anchorTo: 'start', followOnAppend: false,
    scrollEndThreshold: 90,
    rangeExtractor: useCallback(range => {
      const extra = [...forced, ...(focused ? [focused] : [])].flatMap(id => indices.has(id) ? [indices.get(id)!] : []);
      return [...new Set([...defaultRangeExtractor(range), ...extra])].sort((a, b) => a - b);
    }, [forced, focused, indices]),
    measureElement: (element, entry) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
      if (memory.layout === currentLayout && element.dataset.transcriptBlock) memory.heights.set(element.dataset.transcriptBlock, height);
      return height;
    },
    onChange: (_instance, sync) => {
      if (!sync) notifyLayout();
      if (followFrame.current !== undefined) return;
      followFrame.current = requestAnimationFrame(() => {
        followFrame.current = undefined;
        const element = scroll?.current;
        if (element && initialized.current && pinned.current && !manualRef.current && !jumping.current
          && element.scrollHeight - element.clientHeight - element.scrollTop > 1) element.scrollTop = element.scrollHeight;
      });
    },
  });
  // The visible fold starts below the overlay header.
  // The library's default predicate uses the scroll box top instead.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (jumping.current) return false;
    const anchorIndex = anchored.current ? indices.get(anchored.current) : undefined;
    return anchorIndex !== undefined ? item.index < anchorIndex
      : item.end <= (instance.scrollOffset || 0) + geometry.top + 1;
  };
  const mounted = useEventCallback((id: string) => root.current?.querySelector<HTMLElement>(`[data-transcript-block="${CSS.escape(id)}"]`) || null);
  const capture = useEventCallback((measure = false) => {
    const element = scroll?.current;
    if (!ready || !element || !root.current || jumping.current) return memory.anchor;
    if (!measure && !userScrolling.current && anchored.current && memory.anchor?.id === anchored.current)
      return memory.anchor;
    const top = element.getBoundingClientRect().top + (parseFloat(getComputedStyle(element).scrollPaddingTop) || 0);
    const rows = [...root.current.querySelectorAll<HTMLElement>('[data-transcript-block]')];
    // Retain the explicit target through late measurements. A few pixels of the prior row must not replace it.
    const target = !userScrolling.current && anchored.current ? mounted(anchored.current) : null;
    const row = target || rows.find(row => {
      const box = row.getBoundingClientRect();
      return box.bottom > top + 16 && box.top < element.getBoundingClientRect().bottom;
    });
    if (!row) return memory.anchor;
    const anchor: TranscriptAnchor = { id: row?.dataset.transcriptBlock,
      inset: row ? row.getBoundingClientRect().top - top : 0,
      pinned: pinned.current, full };
    memory.anchor = anchor; anchored.current = anchor.id;
    return anchor;
  });
  const latest = useEventCallback(() => {
    generation.current++; jumping.current = false; anchored.current = undefined; userScrolling.current = false; pinned.current = true; onPinned(true); manualRef.current = false; setForced(new Set());
    if (ready && initialized.current && !memory.anchor?.pinned) {
      memory.anchor = { inset: 0, pinned: true, full };
      persist(memory.anchor);
    }
    if (enabled) virtualizer.scrollToEnd({ behavior: 'auto' });
    else if (scroll?.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  });
  const unpin = useEventCallback(() => {
    const token = ++generation.current;
    jumping.current = false; anchored.current = undefined; userScrolling.current = true;
    pinned.current = false; onPinned(false); manualRef.current = true; virtualizer.cancelScroll();
    if (memory.anchor) memory.anchor = { ...memory.anchor, pinned: false };
    // Focus can scroll the browser after its focus event. Capture that final position on the next frame.
    const revision = anchorRevision.current;
    requestAnimationFrame(() => {
      if (generation.current !== token || anchorRevision.current !== revision) return;
      const anchor = capture(true); if (anchor) persist(anchor);
      if (anchored.current) userScrolling.current = false;
    });
  });
  const mount = useEventCallback((id: string, inset: number = 0): Promise<HTMLElement | null> => {
    // A viewport resize can request the same target during a search or rail jump.
    if (jumping.current && pendingMount.current?.id === id && pendingMount.current.inset === inset)
      return pendingMount.current.run;
    const run = (async () => {
      const index = indices.get(id), element = scroll?.current;
      if (index === undefined || !element) return null;
      const token = ++generation.current;
      jumping.current = true; userScrolling.current = false; anchored.current = id; pinned.current = false; onPinned(false); manualRef.current = true;
      memory.anchor = { id, inset, pinned: false, full }; persist(memory.anchor);
      setForced(new Set([id]));
      virtualizer.cancelScroll();
      if (enabled) virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' });
      let stable = 0, target: HTMLElement | null = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        await frame();
        if (generation.current !== token) return null;
        target = mounted(id);
        if (!target) continue;
        const top = element.getBoundingClientRect().top + (parseFloat(getComputedStyle(element).scrollPaddingTop) || 0);
        const delta = target.getBoundingClientRect().top - top - inset;
        virtualizer.cancelScroll();
        if (Math.abs(delta) > 1) {
          const before = element.scrollTop;
          element.scrollTop = before + delta;
          stable = Math.abs(element.scrollTop - before) < 1 ? stable + 1 : 0;
        } else stable++;
        if (stable >= 3) break;
      }
      if (generation.current === token) { jumping.current = false; const anchor = capture(); if (anchor) persist(anchor); notifyLayout(); }
      return target;
    })();
    pendingMount.current = { id, inset, run };
    void run.then(() => { if (pendingMount.current?.run === run) pendingMount.current = undefined; });
    return run;
  });
  const offset = useEventCallback((id: string) => {
    const index = indices.get(id);
    if (index === undefined) return;
    if (enabled) return virtualizer.measurementsCache[index]?.start;
    const element = scroll?.current, target = mounted(id);
    if (element && target) return target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
  });
  const remember = useEventCallback((actual = false) => {
    anchorRevision.current++;
    // Rail mounts retain their target through measurements. DOM jumps record the row that is visible now.
    if (actual && !jumping.current) anchored.current = undefined;
    const anchor = capture(true); if (anchor) persist(anchor); return anchor;
  });
  const api = useMemo<TranscriptController>(() => ({ enabled, latest, unpin, capture: remember, mount, offset }), [enabled, latest, unpin, remember, mount, offset]);
  useLayoutEffect(() => {
    controller.current = api; onMode(enabled); notifyLayout();
    return () => { if (controller.current === api) controller.current = null; };
  }, [api, controller, enabled, onMode, notifyLayout]);

  // The parent scroll ref can still be null in child layout effects on a warm session open.
  // Attach after all refs commit, even when the lazy message module is already loaded.
  useEffect(() => {
    const element = scroll?.current, content = root.current;
    if (!element || !content) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const origin = content.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
      const next = { origin, tail: Math.max(0, element.scrollHeight - origin - content.offsetHeight),
        top: parseFloat(style.scrollPaddingTop) || 0, bottom: parseFloat(style.scrollPaddingBottom) || 0,
        width: content.clientWidth, height: element.clientHeight };
      setGeometry(previous => Object.keys(next).every(key => Math.abs(next[key as keyof typeof next] - previous[key as keyof typeof next]) < 1) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: 'border-box' });
    // Composer and safe-area spacing can change only the parent's padding.
    if (content.parentElement) observer.observe(content.parentElement, { box: 'border-box' });
    return () => observer.disconnect();
  }, [scroll, enabled]);
  useLayoutEffect(() => {
    if (!ready) { initialized.current = false; return; }
    if (!geometry.width || !blocks.length) return;
    const changed = memory.layout !== currentLayout;
    if (changed) { memory.layout = currentLayout; memory.heights.clear(); if (enabled) virtualizer.measure(); }
    if (!initialized.current || changed && (!userScrolling.current || manualRef.current)) {
      initialized.current = true;
      const anchor = saved.current || memory.anchor;
      saved.current = undefined;
      if (!anchor || anchor.pinned || !anchor.id || !indices.has(anchor.id)) latest();
      else void mount(anchor.id, anchor.inset);
    }
  }, [currentLayout, geometry.width, blocks.length, enabled, memory, indices, latest, mount, virtualizer, ready]);
  // Deferred message rendering can prepend rows after the history loading flag settles.
  const previousFirst = useRef(blocks[0]?.id);
  useLayoutEffect(() => {
    const first = blocks[0]?.id, previous = previousFirst.current;
    previousFirst.current = first;
    if (!previous || previous === first || !ready || !initialized.current || userScrolling.current && !manualRef.current) return;
    const anchor = memory.anchor;
    if (anchor?.pinned) latest();
    else if (anchor?.id && indices.has(anchor.id)) void mount(anchor.id, anchor.inset);
  }, [blocks, ready, memory, indices, latest, mount]);
  // Loading banners, the keyboard, and the composer can change outside the virtual rows.
  const previousGeometry = useRef(geometry);
  useLayoutEffect(() => {
    const previous = previousGeometry.current;
    previousGeometry.current = geometry;
    if (!initialized.current || !ready || jumping.current || userScrolling.current && !manualRef.current) return;
    if (pinned.current) latest();
    else if (previous.origin !== geometry.origin || previous.top !== geometry.top) {
      const anchor = memory.anchor;
      if (anchor?.id) void mount(anchor.id, anchor.inset);
    }
  }, [geometry, ready, memory, latest, mount, pinned]);
  useLayoutEffect(() => {
    const content = root.current;
    if (enabled || !content) return;
    const observer = new ResizeObserver(() => { if (ready && initialized.current && pinned.current) latest(); });
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, latest, pinned, ready]);
  const previousMode = useRef(enabled);
  useLayoutEffect(() => {
    if (previousMode.current === enabled) return;
    previousMode.current = enabled;
    const anchor = memory.anchor;
    if (!anchor || anchor.pinned) latest();
    else if (anchor.id) void mount(anchor.id, anchor.inset);
  }, [enabled, memory, latest, mount]);
  useEffect(() => {
    const element = scroll?.current;
    if (!element || !ready) return;
    let timer: number | undefined;
    let previousTop = element.scrollTop;
    let previousHeight = element.scrollHeight, previousClientHeight = element.clientHeight;
    let pointerActive = false;
    const save = () => { const anchor = capture(); if (anchor) persist(anchor); userScrolling.current = false; };
    const scrolled = () => {
      const gap = element.scrollHeight - element.clientHeight - element.scrollTop;
      const atEnd = gap <= 1;
      // Large browser jumps also leave follow. Small layout corrections do not claim user intent.
      const layoutChanged = element.scrollHeight !== previousHeight || element.clientHeight !== previousClientHeight;
      const movedUp = !enabled && !layoutChanged && gap >= 90 && element.scrollTop < previousTop - 1;
      const movedDown = element.scrollTop > previousTop + 1;
      previousTop = element.scrollTop;
      previousHeight = element.scrollHeight; previousClientHeight = element.clientHeight;
      // Layout and virtual measurements can change offsets without a reader gesture.
      if (initialized.current && !jumping.current && !manualRef.current && (userScrolling.current || pointerActive || movedUp || atEnd)) {
        if (movedUp) { anchored.current = undefined; userScrolling.current = true; }
        // A small upward gesture owns the viewport even inside the former 90px threshold.
        // Only a downward move to the actual end resumes follow after user input.
        pinned.current = atEnd && (!userScrolling.current || movedDown);
        onPinned(pinned.current);
        if (pinned.current) { userScrolling.current = false; anchored.current = undefined; }
      }
      // Navigation can detach the rows before the debounced save or the child cleanup runs.
      // Keep the anchor in account memory on each scroll; only the encrypted write waits.
      if (initialized.current && !jumping.current) capture();
      clearTimeout(timer); timer = window.setTimeout(save, 250);
    };
    const input = (towardEarlier = true) => {
      clearTimeout(timer);
      generation.current++; jumping.current = false; anchored.current = undefined;
      // A downward gesture at the end cannot produce a scroll event that restores follow.
      const atEnd = element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
      pinned.current = atEnd && !towardEarlier;
      userScrolling.current = !pinned.current;
      onPinned(pinned.current); manualRef.current = false;
      if (followFrame.current !== undefined) { cancelAnimationFrame(followFrame.current); followFrame.current = undefined; }
      virtualizer.cancelScroll(); setForced(new Set());
    };
    const pointer = (event: PointerEvent) => {
      if (!(event.target as Element).closest('button, summary, input, textarea, select, [contenteditable]')) {
        pointerActive = true; input(false);
      }
    };
    const pointerEnd = () => { pointerActive = false; };
    const keyboard = (event: KeyboardEvent) => {
      if (['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)
        && !(event.target as Element).closest('input, textarea, select, button, summary, [contenteditable]'))
        input(['Home', 'PageUp', 'ArrowUp'].includes(event.key) || event.key === ' ' && event.shiftKey);
    };
    const wheel = (event: WheelEvent) => { if (event.deltaY) input(event.deltaY < 0); };
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const touchMove = (event: TouchEvent) => {
      const nextY = event.touches?.[0]?.clientY;
      if (nextY === undefined || touchY === undefined) input();
      else if (nextY !== touchY) input(nextY > touchY);
      touchY = nextY;
    };
    const browserFind = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && ['f', 'g'].includes(event.key.toLowerCase())) input(); };
    document.addEventListener('keydown', browserFind);
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', hidden);
    element.addEventListener('pointerdown', pointer, { passive: true });
    document.addEventListener('pointerup', pointerEnd, { passive: true });
    document.addEventListener('pointercancel', pointerEnd, { passive: true });
    element.addEventListener('keydown', keyboard);
    element.addEventListener('scroll', scrolled, { passive: true });
    element.addEventListener('wheel', wheel, { passive: true });
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: true });
    return () => {
      clearTimeout(timer); if (memory.anchor) persist(memory.anchor); generation.current++; jumping.current = false;
      document.removeEventListener('keydown', browserFind);
      window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', hidden);
      element.removeEventListener('pointerdown', pointer); element.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerup', pointerEnd); document.removeEventListener('pointercancel', pointerEnd);
      element.removeEventListener('scroll', scrolled); element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchstart', touchStart); element.removeEventListener('touchmove', touchMove);
    };
  }, [scroll, capture, persist, virtualizer, ready, enabled]);
  useLayoutEffect(() => () => { const anchor = capture(); if (anchor) persist(anchor); }, [capture, persist]);
  useLayoutEffect(() => () => { if (followFrame.current !== undefined) cancelAnimationFrame(followFrame.current); }, []);
  const items = enabled ? virtualizer.getVirtualItems() : blocks.map((block, index) => ({ key: block.id, index, start: 0 }));
  const height = enabled ? Math.max(0, virtualizer.getTotalSize() - geometry.origin - geometry.tail) : undefined;
  return <div ref={root} className={styles.viewport} data-transcript-mode={enabled ? 'virtual' : 'full'}
    style={enabled ? { height, position: 'relative' } : undefined}
    onFocusCapture={event => {
      if (!root.current?.contains(event.target as Node)) return;
      setFocused((event.target as HTMLElement).closest<HTMLElement>('[data-transcript-block]')?.dataset.transcriptBlock);
      if (!jumping.current) unpin();
    }}
    onBlurCapture={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) setFocused(undefined); }}>
    {items.map(item => <div key={item.key} data-index={item.index} data-transcript-block={blocks[item.index].id}
      ref={enabled ? virtualizer.measureElement : undefined} className={styles.row}
      style={enabled ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - geometry.origin}px)` } : undefined}>
      {render(blocks[item.index])}
    </div>)}
  </div>;
}
