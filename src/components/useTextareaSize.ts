import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

// Use native sizing where available. Older browsers measure an isolated mirror
// instead of collapsing the visible textarea and laying out the chat twice.
export function useTextareaSize(input: RefObject<HTMLTextAreaElement | null>, value: string) {
  const schedule = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element || CSS.supports('field-sizing', 'content')) return;
    const mirror = document.createElement('textarea');
    mirror.tabIndex = -1;
    mirror.setAttribute('aria-hidden', 'true');
    document.body.append(mirror);
    let frame: number | undefined;
    let width = 0;
    let maxHeight = Infinity;
    const measure = () => {
      frame = undefined;
      mirror.value = element.value;
      const height = `${Math.min(mirror.scrollHeight, maxHeight)}px`;
      if (element.style.height !== height) element.style.height = height;
    };
    const queue = () => {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    const resize = () => {
      const style = getComputedStyle(element);
      width = element.clientWidth;
      maxHeight = parseFloat(style.maxHeight) || Infinity;
      for (const property of ['font-family', 'font-size', 'font-weight', 'font-style',
        'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'text-transform',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'tab-size',
        'white-space', 'overflow-wrap', 'word-break'])
        mirror.style.setProperty(property, style.getPropertyValue(property));
      Object.assign(mirror.style, {
        position: 'fixed', left: '0', top: '0', width: `${width}px`,
        height: '0', minHeight: '0', maxHeight: 'none', margin: '0', border: '0',
        boxSizing: 'border-box', visibility: 'hidden', pointerEvents: 'none',
        overflow: 'hidden', contain: 'strict', fieldSizing: 'fixed',
      });
      queue();
    };
    schedule.current = queue;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) resize();
    });
    observer.observe(element);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      schedule.current = undefined;
      observer.disconnect();
      window.removeEventListener('resize', resize);
      if (frame !== undefined) cancelAnimationFrame(frame);
      mirror.remove();
    };
  }, [input]);
  useLayoutEffect(() => { schedule.current?.(); }, [value]);
}
