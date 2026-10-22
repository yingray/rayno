import { memo, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { MessageRecap } from '../data/recapView';
import { contentOffset, findRecapTarget } from './recapTargets';
import { useRecapSpeech } from './recapSpeech';
import { COARSE_QUERY, DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';
import styles from './recap.module.css';

const PIN = 20;
// A pin on a touch screen has a 46px hit area: the CSS extends it 13px on each side.
const TOUCH_GAP = PIN + 26;
type Layout = { pins: { index: number; top: number }[]; thumb: { top: number; height: number } };

/**
 * The top of each pin in a rail of the given height.
 * Pins keep the gap between them, and the last pin stays inside the rail.
 * When the pins do not fit with that gap, they share the height equally.
 */
export function railPinTops(positions: readonly number[], height: number, gap: number): number[] {
  const bottom = Math.max(0, height - PIN);
  let previous = -Infinity;
  const tops = positions.map((position) => (previous = Math.max(previous + gap, Math.max(0, position - PIN / 2))));
  for (let index = tops.length - 1; index >= 0; index--)
    tops[index] = Math.min(tops[index], index === tops.length - 1 ? bottom : tops[index + 1] - gap);
  if (tops.length && tops[0] < 0) return tops.map((_, index) => tops.length > 1 ? index * bottom / (tops.length - 1) : 0);
  return tops;
}

/**
 * Numbered pins at the scroll positions of the recap targets, like marks on a scroll bar.
 * Target elements are found again only when the content changes size. A scroll moves only the thumb.
 */
export const RecapRail = memo(function RecapRail({ host, scroll, messageId, value, onJump }: {
  host: HTMLElement | null;
  scroll: RefObject<HTMLDivElement | null>;
  messageId: string;
  value: MessageRecap;
  onJump: (messageId: string, index: number) => void;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const coarse = useMediaQuery(COARSE_QUERY);
  const speech = useRecapSpeech();
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !host || !desktop) { setLayout(null); return; }
    const points = value.recap.segments.flatMap((segment) =>
      segment.kind === 'point' && value.targets[segment.index - 1] ? [segment] : []);
    let targets: { index: number; element: HTMLElement }[] = [];
    let offsets: { index: number; offset: number }[] = [];
    let frame: number | undefined;
    let measureTargets = true;
    function measure() {
      frame = undefined;
      if (!element || !host) return;
      if (measureTargets) {
        measureTargets = false;
        targets = points.flatMap((point) => {
          const target = findRecapTarget(element, messageId, point.quote);
          return target ? [{ index: point.index, element: target }] : [];
        });
        offsets = targets.map((target) => ({ index: target.index, offset: contentOffset(element, target.element) }));
      }
      const height = host.clientHeight;
      const total = Math.max(1, element.scrollHeight);
      // Keep pins apart when targets are close together. Touch hit areas must not cover the pin above.
      const tops = railPinTops(offsets.map(({ offset }) => offset / total * height), height, coarse ? TOUCH_GAP : PIN + 2);
      const pins = offsets.map(({ index }, position) => ({ index, top: tops[position] }));
      setLayout(pins.length ? {
        pins,
        thumb: { top: element.scrollTop / total * height, height: Math.min(1, element.clientHeight / total) * height },
      } : null);
    }
    const schedule = (targetsChanged: boolean) => {
      measureTargets ||= targetsChanged;
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    measure();
    const onScroll = () => schedule(false);
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(() => schedule(true));
    observer.observe(element);
    observer.observe(host);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [host, scroll, messageId, value, desktop, coarse]);

  if (!host || !layout) return null;
  const active = speech.key === messageId && speech.point !== null ? speech.point
    : speech.selected?.key === messageId ? speech.selected.index : null;
  return createPortal(
    <nav className={styles.rail} aria-label="Recap points" data-recap-rail data-testid="recap-rail">
      <span className={styles.track} />
      <span className={styles.thumb} style={{ top: layout.thumb.top, height: layout.thumb.height }} />
      {layout.pins.map((pin) => (
        <button
          type="button"
          key={pin.index}
          className={styles.railPin}
          style={{ top: pin.top }}
          data-active={active === pin.index}
          aria-label={`Jump to point ${pin.index}`}
          onClick={() => onJump(messageId, pin.index)}
        >
          {pin.index}
        </button>
      ))}
    </nav>,
    host,
  );
});
