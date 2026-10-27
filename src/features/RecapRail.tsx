import { useText } from "../i18n";
import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { BubbleColor } from '../data/types';
import chatStyles from './chat.module.css';
import type { ResponseAnchor } from '../data/responseAnchors';
import { createPortal } from 'react-dom';
import { contentOffsets, jumpToRecapTarget } from './recapTargets';
import { COARSE_QUERY, DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';
import styles from './recap.module.css';
import { useEventCallback } from '../components/useEventCallback';
import type { TranscriptController } from './TranscriptViewport';

const PIN = 20;
// A pin on a touch screen has a 46px hit area: the CSS extends it 13px on each side.
const TOUCH_GAP = PIN + 26;
type Pin = ResponseAnchor & { index: number; top: number };
type Layout = { pins: Pin[]; active?: string; contentHeight: number; scrollTop: number };

const samePins = (a: readonly Pin[], b: readonly Pin[]) => a.length === b.length && a.every((pin, index) => {
  const other = b[index];
  return pin.id === other.id && pin.top === other.top && pin.index === other.index && pin.size === other.size && pin.label === other.label;
});

type Tip = { id: string; index: number; label: string; top: number };

// A scroll frame changes only the active pin, so the other pins skip their render.
const RailPin = memo(function RailPin({ pin, active, onSelect, onHint }: {
  pin: Pin; active: boolean; onSelect: (id: string) => void; onHint: (pin: Pin, element: HTMLElement | null) => void;
}) {
  const t = useText();
  return <button type="button" className={styles.railPin} style={{top:pin.top}}
    data-size={pin.size} data-active={active} aria-current={active?'location':undefined}
    aria-label={`${t('Jump to reply')} ${pin.index}`}
    onPointerEnter={event=>{ if (event.pointerType === 'mouse') onHint(pin, event.currentTarget); }}
    onPointerLeave={()=>onHint(pin, null)}
    onFocus={event=>{ if (event.currentTarget.matches(':focus-visible')) onHint(pin, event.currentTarget); }}
    onBlur={()=>onHint(pin, null)}
    onClick={()=>onSelect(pin.id)}><span className={styles.railTick} aria-hidden="true" /></button>;
});

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

// Each pin marks the start of one formal agent reply, independent of any recap.
export const ResponseRail = memo(function ResponseRail({ bubble, host, scroll, replies, onJump, viewport, virtual = false }: {
  bubble: BubbleColor;
  host: HTMLElement | null;
  scroll: RefObject<HTMLDivElement | null>;
  replies: ResponseAnchor[];
  onJump: () => void;
  viewport?: RefObject<TranscriptController | null>;
  virtual?: boolean;
}) {
  const t = useText();
  const desktop = useMediaQuery(DESKTOP_QUERY), coarse = useMediaQuery(COARSE_QUERY);
  const [layout, setLayout] = useState<Layout | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  // One shared label sits outside the rail scroller, so the scroller does not clip it.
  const hint = useEventCallback((pin: Pin, target: HTMLElement | null) => {
    const box = nav.current?.getBoundingClientRect();
    if (!target || !box) { setTip(current => current?.id === pin.id ? null : current); return; }
    const rect = target.getBoundingClientRect();
    setTip({ id: pin.id, index: pin.index, label: pin.label, top: rect.top + rect.height / 2 - box.top });
  });
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !host || !desktop) { setLayout(null); return; }
    let offsets: (ResponseAnchor & { index: number; offset: number })[] = [], frame: number | undefined, pins: Pin[] = [];
    let changed = true;
    function measure() {
      frame = undefined;
      if (!element || !host) return;
      if (changed) {
        changed = false;
        if (virtual && viewport?.current) {
          offsets = replies.flatMap((reply, index) => {
            const offset = viewport.current?.offset(`message:${reply.id}`);
            return offset === undefined ? [] : [{ ...reply, index: index + 1, offset }];
          });
        } else {
        // One query for all replies. A query for each reply reads the whole list again.
        const targets = new Map<string, HTMLElement>();
        for (const node of element.querySelectorAll<HTMLElement>('[data-message-id]')) {
          const id = node.dataset.messageId;
          if (id && !targets.has(id)) targets.set(id, node);
        }
        const found = replies.flatMap((reply,index) => {
          const target = targets.get(reply.id);
          return target ? [{reply,index,target}] : [];
        });
        const positions = contentOffsets(element, found.map(item => item.target));
        offsets = found.map(({reply,index},i) => ({...reply,index:index+1,offset:positions[i]}));
        }
      }
      const height = host.clientHeight, total = Math.max(1,element.scrollHeight);
      const gap=coarse?TOUCH_GAP:PIN+2, inset=coarse?13:0;
      const visible = offsets.filter(item => item.size !== 'small');
      // Compress all visible replies into the rail, growing only to preserve hit areas.
      const contentHeight=Math.max(height,(visible.length-1)*gap+PIN+2*inset);
      const tops = railPinTops(visible.map(item => item.offset/total*(contentHeight-2*inset)), contentHeight-2*inset, gap).map(top=>top+inset);
      const progress = element.scrollTop / Math.max(1, total-element.clientHeight);
      const padding = parseFloat(getComputedStyle(element).scrollPaddingTop) || 0;
      // At the bottom the last reply is current, even when its start is still below the top of the view.
      const bottom = element.scrollTop + element.clientHeight >= total - 2;
      const active = (bottom ? offsets.at(-1) : offsets.findLast(item => item.offset <= element.scrollTop+padding+1))?.id;
      // Keep the same pins array while only the scroll position changes.
      const next = visible.map((item,i)=>({...item,top:tops[i]}));
      if (!samePins(pins, next)) pins = next;
      setLayout(offsets.length ? {pins,active,contentHeight,scrollTop:Math.min(1, Math.max(0, progress)) * (contentHeight-height)} : null);
    }
    const schedule = (resize: boolean) => { changed ||= resize; if (frame === undefined) frame=requestAnimationFrame(measure); };
    measure();
    const onScroll = () => schedule(false);
    element.addEventListener('scroll',onScroll,{passive:true});
    const onLayout = () => schedule(true);
    element.addEventListener('rayno:transcript-layout', onLayout);
    const observer=new ResizeObserver(()=>schedule(true));observer.observe(element);observer.observe(host);
    if(element.firstElementChild)observer.observe(element.firstElementChild);
    return()=>{element.removeEventListener('scroll',onScroll);element.removeEventListener('rayno:transcript-layout',onLayout);observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);};
  },[host,scroll,replies,desktop,coarse,virtual,viewport]);
  useLayoutEffect(() => {
    const rail = scroller.current;
    if (rail && layout && Math.abs(rail.scrollTop - layout.scrollTop) > 0.5) {
      rail.scrollTop = layout.scrollTop;
    }
  }, [layout]);
  const select = useEventCallback(async (id: string) => {
    if (viewport?.current) {
      onJump();
      const row = await viewport.current.mount(`message:${id}`);
      const element = scroll.current, target = row?.querySelector<HTMLElement>('article');
      if (element && target) jumpToRecapTarget(element, target, 'auto', () => viewport.current?.capture());
      return;
    }
    const element=scroll.current;const target=element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if(element&&target){onJump();jumpToRecapTarget(element,target);}
  });
  if(!host||!layout)return null;
  return createPortal(<nav ref={nav} className={`${styles.rail} ${chatStyles.bubbleTint}`} data-bubble={bubble} aria-label={t('Agent replies')} data-response-rail data-testid="response-rail">
    <span className={styles.track}/>
    <div ref={scroller} className={styles.railScroller} role="group" aria-label={t('Reply anchors')} tabIndex={0} onScroll={()=>setTip(null)}>
    <div className={styles.railContent} style={{height:layout.contentHeight}}>
    {layout.pins.map(pin=><RailPin key={pin.id} pin={pin} active={layout.active===pin.id} onSelect={select} onHint={hint} />)}
    </div></div>
    {tip && <span className={styles.railTip} style={{top:tip.top}} aria-hidden="true" data-testid="response-rail-tip">
      <span className={styles.railTipIndex}>{String(tip.index).padStart(2,'0')}</span>
      <span className={styles.railTipText}>{tip.label}</span>
    </span>}
  </nav>,host);
});
