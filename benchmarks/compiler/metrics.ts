import type { ProfilerOnRenderCallback } from 'react';
import { isCompilerEnabled } from './gate';

export type Kind = 'live' | 'input' | 'option';
export type Sample = {
  kind: Kind; label: string; renderMs: number; commits: number; maxRenderMs: number;
  domMs: number; nextFrameMs: number;
};
type Active = Omit<Sample, 'domMs' | 'nextFrameMs'> & {
  start?: number; domAt?: number; id?: string; button?: HTMLElement; pressed?: boolean; input?: HTMLTextAreaElement;
};
let active: Active | undefined;
let done: Sample | null = null;
let mounted = 0;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export const recordRender: ProfilerOnRenderCallback = (_id, phase, duration) => {
  if (phase === 'mount') mounted++;
  if (active?.start === undefined) return;
  active.renderMs += duration; active.commits++; active.maxRenderMs = Math.max(active.maxRenderMs, duration);
};
function start() { if (active && active.start === undefined) active.start = performance.now(); }
function committed() {
  const sample = active;
  if (!sample || sample.start === undefined || sample.domAt !== undefined) return;
  sample.domAt = performance.now();
  // Two rAF callbacks bracket a rendering opportunity, not a physical display timestamp.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (sample !== active) return;
    done = { kind: sample.kind, label: sample.label, renderMs: sample.renderMs, commits: sample.commits,
      maxRenderMs: sample.maxRenderMs, domMs: sample.domAt! - sample.start!, nextFrameMs: performance.now() - sample.start! };
    active = undefined;
  }));
}

// Start at browser delivery, after the fixture encrypts and transports the packet.
const NativeSocket = window.WebSocket;
window.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener('message', event => {
      if (active?.kind !== 'live' || typeof event.data !== 'string' || !event.data.startsWith('42')) return;
      try {
        const [name, packet] = JSON.parse(event.data.slice(2));
        if (name === 'update' && packet.body?.t === 'new-message' && packet.body.sid === 'real-session') {
          active.id = packet.body.message.id; start();
        }
      } catch { /* Ignore Engine.IO control frames. */ }
    });
  }
};
document.addEventListener('input', event => {
  if (active?.kind !== 'input' || !(event.target instanceof HTMLTextAreaElement) || event.target.getAttribute('aria-label') !== 'Message') return;
  active.input = event.target; active.label = event.target.value; start();
}, true);
document.addEventListener('click', event => {
  if (active?.kind !== 'option' || !(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>('[data-reply-options] button');
  if (button) { active.button = button; active.pressed = button.getAttribute('aria-pressed') !== 'true'; start(); }
}, true);
new MutationObserver(() => {
  if (!active || active.start === undefined || active.domAt !== undefined) return;
  if (active.kind === 'live') {
    const target = active.id && document.querySelector(`[data-message-id="${CSS.escape(active.id)}"]`);
    if (target && target.textContent?.includes(active.label)) committed();
  } else if (active.kind === 'input') {
    // React updates defaultValue during its controlled-textarea commit. Native typing alone changes value only.
    if (active.input?.defaultValue === active.label) committed();
  } else if (active.button?.getAttribute('aria-pressed') === String(active.pressed)) {
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    if (input && input.defaultValue === input.value) committed();
  }
}).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed'] });

const api = {
  enabled: isCompilerEnabled(),
  arm(kind: Kind, label = '') {
    if (active) throw new Error('A benchmark interaction is still active.');
    done = null; active = { kind, label, renderMs: 0, commits: 0, maxRenderMs: 0 };
  },
  result: () => done,
  mounted: () => mounted,
  settle: async () => { await frame(); await frame(); },
};
declare global { interface Window { __raynoCompilerBench: typeof api } }
window.__raynoCompilerBench = api;
