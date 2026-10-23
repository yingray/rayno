import { useText } from "../i18n";
import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ResponseAnchor } from '../data/responseAnchors';
import { createPortal } from 'react-dom';
import { contentOffset, jumpToRecapTarget } from './recapTargets';
import { COARSE_QUERY, DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';
import styles from './recap.module.css';

const PIN = 20;
// A pin on a touch screen has a 46px hit area: the CSS extends it 13px on each side.
const TOUCH_GAP = PIN + 26;
type Layout = { pins: (ResponseAnchor & { index: number; top: number })[]; active?: string; contentHeight: number; scrollTop: number; thumb: { top: number; height: number } };

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
export const ResponseRail = memo(function ResponseRail({ host, scroll, replies, onJump }: {
  host: HTMLElement | null;
  scroll: RefObject<HTMLDivElement | null>;
  replies: ResponseAnchor[];
  onJump: () => void;
}) {
  const t = useText();
  const desktop = useMediaQuery(DESKTOP_QUERY), coarse = useMediaQuery(COARSE_QUERY);
  const [layout, setLayout] = useState<Layout | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const syncing = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !host || !desktop) { setLayout(null); return; }
    let offsets: (ResponseAnchor & { index: number; offset: number })[] = [], frame: number | undefined;
    let changed = true;
    function measure() {
      frame = undefined;
      if (!element || !host) return;
      if (changed) {
        changed = false;
        offsets = replies.flatMap((reply,index) => {
          const target = element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(reply.id)}"]`);
          return target ? [{...reply,index:index+1,offset:contentOffset(element,target)}] : [];
        });
      }
      const height = host.clientHeight, total = Math.max(1,element.scrollHeight);
      const gap=coarse?TOUCH_GAP:PIN+2, inset=coarse?13:0;
      // Keep anchors in the same scroll coordinate space as their reply starts.
      const railInset = host.getBoundingClientRect().top - element.getBoundingClientRect().top;
      const contentHeight=Math.max(height,total-railInset+PIN+2*inset,(offsets.length-1)*gap+PIN+2*inset);
      const tops = railPinTops(offsets.map(item => item.offset-railInset-inset), contentHeight-2*inset, gap).map(top=>top+inset);
      const padding = parseFloat(getComputedStyle(element).scrollPaddingTop) || 0;
      const active = offsets.findLast(item => item.offset <= element.scrollTop+padding+1)?.id;
      setLayout(offsets.length ? {pins:offsets.map((item,i)=>({...item,top:tops[i]})),active,contentHeight,scrollTop:element.scrollTop,
        thumb:{top:element.scrollTop/total*height,height:Math.min(1,element.clientHeight/total)*height}} : null);
    }
    const schedule = (resize: boolean) => { changed ||= resize; if (frame === undefined) frame=requestAnimationFrame(measure); };
    measure();
    const onScroll = () => schedule(false);
    element.addEventListener('scroll',onScroll,{passive:true});
    const observer=new ResizeObserver(()=>schedule(true));observer.observe(element);observer.observe(host);
    if(element.firstElementChild)observer.observe(element.firstElementChild);
    return()=>{element.removeEventListener('scroll',onScroll);observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);};
  },[host,scroll,replies,desktop,coarse]);
  useLayoutEffect(() => {
    const rail = scroller.current;
    if (rail && layout && Math.abs(rail.scrollTop - layout.scrollTop) > 0.5) {
      syncing.current = layout.scrollTop;
      rail.scrollTop = layout.scrollTop;
    }
  }, [layout]);
  if(!host||!layout)return null;
  return createPortal(<nav className={styles.rail} aria-label={t('Agent replies')} data-response-rail data-testid="response-rail">
    <span className={styles.track}/><span className={styles.thumb} style={{top:layout.thumb.top,height:layout.thumb.height}}/>
    <div ref={scroller} className={styles.railScroller} role="group" aria-label={t('Reply anchors')} tabIndex={0}
      onScroll={event => {
        const rail = event.currentTarget, element = scroll.current;
        if (!element) return;
        if (syncing.current !== null && Math.abs(rail.scrollTop - syncing.current) < 1) { syncing.current = null; return; }
        syncing.current = null;
        const top = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, rail.scrollTop));
        if (Math.abs(rail.scrollTop - top) > 0.5) { syncing.current = top; rail.scrollTop = top; }
        if (Math.abs(element.scrollTop - top) > 0.5) { onJump(); element.scrollTop = top; }
      }}>
    <div className={styles.railContent} style={{height:layout.contentHeight}}>
    {layout.pins.map(pin=><button type="button" key={pin.id} className={styles.railPin} style={{top:pin.top}}
      data-size={pin.size} data-active={layout.active===pin.id} aria-current={layout.active===pin.id?'location':undefined}
      aria-label={`${t('Jump to reply')} ${pin.index}`} title={pin.label}
      onClick={()=>{const element=scroll.current;const target=element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(pin.id)}"]`);
        if(element&&target){onJump();jumpToRecapTarget(element,target);}}}><span className={styles.railDot} aria-hidden="true" /></button>)}
    </div></div>
  </nav>,host);
});
