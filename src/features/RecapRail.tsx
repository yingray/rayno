import { useText } from "../i18n";
import { memo, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { contentOffset, jumpToRecapTarget } from './recapTargets';
import { COARSE_QUERY, DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';
import styles from './recap.module.css';

const PIN = 20;
// A pin on a touch screen has a 46px hit area: the CSS extends it 13px on each side.
const TOUCH_GAP = PIN + 26;
type Layout = { pins: { id: string; index: number; top: number }[]; active?: string; contentHeight: number; thumb: { top: number; height: number } };

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
  replies: { id: string; label: string }[];
  onJump: () => void;
}) {
  const t = useText();
  const desktop = useMediaQuery(DESKTOP_QUERY), coarse = useMediaQuery(COARSE_QUERY);
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !host || !desktop) { setLayout(null); return; }
    let offsets: {id:string; index:number; offset:number}[] = [], frame: number | undefined;
    let changed = true;
    function measure() {
      frame = undefined;
      if (!element || !host) return;
      if (changed) {
        changed = false;
        offsets = replies.flatMap((reply,index) => {
          const target = element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(reply.id)}"]`);
          return target ? [{id:reply.id,index:index+1,offset:contentOffset(element,target)}] : [];
        });
      }
      const height = host.clientHeight, total = Math.max(1,element.scrollHeight);
      const gap=coarse?TOUCH_GAP:PIN+2, inset=coarse?13:0;
      // Dense conversations scroll inside the rail instead of overlapping touch targets.
      const contentHeight=Math.max(height,(offsets.length-1)*gap+PIN+2*inset);
      const tops = railPinTops(offsets.map(item => item.offset / total * (contentHeight-2*inset)), contentHeight-2*inset, gap).map(top=>top+inset);
      const padding = parseFloat(getComputedStyle(element).scrollPaddingTop) || 0;
      const active = offsets.findLast(item => item.offset <= element.scrollTop+padding+1)?.id;
      setLayout(offsets.length ? {pins:offsets.map((item,i)=>({...item,top:tops[i]})),active,contentHeight,
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
  if(!host||!layout)return null;
  return createPortal(<nav className={styles.rail} aria-label={t('Agent replies')} data-response-rail data-testid="response-rail">
    <span className={styles.track}/><span className={styles.thumb} style={{top:layout.thumb.top,height:layout.thumb.height}}/>
    <div className={styles.railScroller} role="group" aria-label={t('Reply anchors')} tabIndex={0}>
    <div className={styles.railContent} style={{height:layout.contentHeight}}>
    {layout.pins.map(pin=><button type="button" key={pin.id} className={styles.railPin} style={{top:pin.top}}
      data-active={layout.active===pin.id} aria-current={layout.active===pin.id?'location':undefined}
      aria-label={`${t('Jump to reply')} ${pin.index}`} title={replies.find(reply=>reply.id===pin.id)?.label}
      onClick={()=>{const element=scroll.current;const target=element?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(pin.id)}"]`);
        if(element&&target){onJump();jumpToRecapTarget(element,target);}}}>{pin.index}</button>)}
    </div></div>
  </nav>,host);
});
