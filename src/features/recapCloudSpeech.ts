import { currentRecapAudioCache, RECAP_AUDIO_TTL } from '../happy/recapAudioCache';

export type SpeechCue = { start: number; end: number; offset: number; length: number };
type CloudPlayback = {
  ready(duration: number): void;
  progress(seconds: number, duration: number, offset: number | null): void;
  ended(): void;
  failed(): void;
};

// A short silent WAV unlocks this same audio element during the user's click on iOS.
function silence() {
  const bytes = new Uint8Array(524), view = new DataView(bytes.buffer);
  const label = (at: number, text: string) => [...text].forEach((char, i) => { bytes[at + i] = char.charCodeAt(0); });
  label(0, 'RIFF'); view.setUint32(4, 516, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, 480, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

let sharedAudio: HTMLAudioElement | undefined;
// Reuse one gesture-authorized element so a later recap can autoplay on Safari.
export function unlockCloudSpeech() {
  if (sharedAudio || typeof Audio !== 'function') return;
  sharedAudio = new Audio();
  const url = URL.createObjectURL(silence());
  sharedAudio.src = url;
  void sharedAudio.play().catch(() => {}).finally(() => URL.revokeObjectURL(url));
}

/** Holds only the current recap's audio in memory. Stop releases its URLs and aborts its request. */
export class CloudRecapPlayer {
  private audio = sharedAudio ||= new Audio();
  private controller = new AbortController();
  private url = '';
  private unlockUrl = '';
  private stopped = false;
  private paused = false;
  private cues: SpeechCue[] = [];
  private expires = 0;
  private timer: ReturnType<typeof setTimeout>;
  constructor(private events: CloudPlayback, rate: number) {
    this.audio.playbackRate = rate;
    this.unlockUrl = URL.createObjectURL(silence());
    this.audio.src = this.unlockUrl;
    void this.audio.play().catch(() => { /* The real playback reports any activation error. */ });
    this.audio.onended = () => { if (this.url && !this.stopped) this.events.ended(); };
    this.audio.ontimeupdate = () => {
      if (!this.url || this.stopped) return;
      const cue = this.cues.find((item) => this.audio.currentTime >= item.start && this.audio.currentTime < item.end);
      this.events.progress(this.audio.currentTime, this.duration, cue?.offset ?? null);
    };
    this.audio.onerror = () => { if (this.url && !this.stopped) this.events.failed(); };
    this.timer = setTimeout(() => this.controller.abort(), 15000);
  }
  get canReplay() { return !this.stopped && !!this.url && this.expires > Date.now(); }
  replay() { this.audio.currentTime = 0; this.resume(); }
  get duration() { return Number.isFinite(this.audio.duration) ? this.audio.duration : 0; }
  get elapsed() { return this.audio.currentTime; }
  get rate() { return this.audio.playbackRate; }
  set rate(value: number) { this.audio.playbackRate = value; }
  async load(text: string, language: string) {
    try {
      const cache = currentRecapAudioCache();
      const saved = await cache?.get(text, language);
      if (this.stopped) return;
      let data = saved?.data;
      if (!data) {
        if (!navigator.onLine) throw new Error('Speech unavailable offline');
        const response = await fetch('/api/tts', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, language }), signal: this.controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Speech unavailable');
        data = await response.json();
      }
      if (this.stopped || !data) return;
      if (typeof data.audio !== 'string' || data.audio.length === 0 || data.audio.length > 1500000) throw new Error('Invalid audio');
      const bytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
      this.cues = Array.isArray(data.cues) ? data.cues.filter((cue: SpeechCue) =>
        Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end >= cue.start
        && Number.isInteger(cue.offset) && Number.isInteger(cue.length) && cue.offset >= 0 && cue.length > 0
        && cue.offset + cue.length <= text.length).slice(0, 1000) : [];
      this.expires = saved?.expires ?? Date.now() + RECAP_AUDIO_TTL;
      this.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const rate = this.audio.playbackRate;
      this.audio.pause(); this.audio.src = this.url; this.audio.playbackRate = rate;
      this.audio.onloadedmetadata = () => {
        if (this.stopped) return;
        if (!this.duration) { this.events.failed(); return; }
        if (!saved) void cache?.put(text, language, { audio: data!.audio, cues: this.cues }, this.expires);
        this.events.ready(this.duration);
      };
      URL.revokeObjectURL(this.unlockUrl); this.unlockUrl = '';
      clearTimeout(this.timer);
      if (!this.paused) await this.audio.play();
    } catch {
      if (!this.stopped) this.events.failed();
    }
  }
  pause() { this.paused = true; this.audio.pause(); }
  resume() {
    this.paused = false;
    if (this.url) void this.audio.play().catch(() => { if (!this.stopped) this.events.failed(); });
  }
  stop() {
    this.stopped = true; clearTimeout(this.timer); this.controller.abort();
    this.audio.onended = null; this.audio.ontimeupdate = null; this.audio.onerror = null; this.audio.onloadedmetadata = null;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.unlockUrl) URL.revokeObjectURL(this.unlockUrl);
  }
}
