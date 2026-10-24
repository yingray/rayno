import type { HappyCrypto } from './crypto';
import { audioStorage } from './recapAudioStorage';
import type { SpeechCue } from '../features/recapCloudSpeech';

export const RECAP_AUDIO_TTL = 24 * 60 * 60 * 1000;
// Bump this when the selected voices or output format change.
const VOICE_VERSION = 'edge-neural-tw-hsiaochen-cn-xiaoxiao-en-aria-mp3-v1';
export type RecapAudio = { audio: string; cues: SpeechCue[] };
export type CachedRecapAudio = { data: RecapAudio; expires: number };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const listeners = new Set<() => void>();
let active: RecapAudioCache | undefined;
export const currentRecapAudioCache = () => active;
export function activateRecapAudioCache(cache: RecapAudioCache) {
  active = cache;
  listeners.forEach(listener => listener());
  void cache.warm();
  return () => { if (active === cache) { active = undefined; listeners.forEach(listener => listener()); } };
}
export function onRecapAudioCacheChange(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }

/** One account and server. The worker stores ciphertext; only the signed-in page can decrypt it. */
export class RecapAudioCache {
  private key?: Promise<CryptoKey>;
  private memory = new Map<string, CachedRecapAudio>();
  private writes = Promise.resolve();
  private closed = false;
  available = false;
  constructor(readonly scope: string, private encryption: Pick<HappyCrypto, 'encrypt' | 'decrypt' | 'blobKey'>) {}
  private async id(text: string, language: string) {
    this.key ??= this.encryption.blobKey(null).then(async bytes => {
      const material = await crypto.subtle.importKey('raw', bytes as BufferSource, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(this.scope),
        info: encoder.encode('Rayno Recap Audio Cache v1') }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    });
    return hex(await crypto.subtle.sign('HMAC', await this.key, encoder.encode(JSON.stringify([VOICE_VERSION, language, text]))));
  }
  async warm() {
    const stored = await audioStorage({ op: 'has', scope: this.scope });
    if (!this.closed && stored) {
      this.available = true; listeners.forEach(listener => listener());
    }
  }
  async get(text: string, language: string): Promise<CachedRecapAudio | null> {
    if (this.closed) return null;
    try {
      const id = await this.id(text, language);
      const memory = this.memory.get(id);
      if (memory && memory.expires > Date.now()) return memory;
      this.memory.delete(id);
      const stored = await audioStorage({ op: 'get', scope: this.scope, id }) as { body: string; expires: number } | null;
      if (!stored || this.closed) return null;
      const value = await this.encryption.decrypt<{ version: number; id: string; expires: number; data: RecapAudio }>(stored.body, null);
      if (value.version !== 1 || value.id !== id || value.expires !== stored.expires || value.expires <= Date.now()
        || typeof value.data?.audio !== 'string' || !Array.isArray(value.data.cues)) {
        await audioStorage({ op: 'delete', scope: this.scope, id }); return null;
      }
      if (this.closed) return null;
      const entry = { data: value.data, expires: value.expires };
      this.remember(id, entry);
      return entry;
    } catch { return null; }
  }
  private remember(id: string, value: CachedRecapAudio) {
    this.memory.delete(id); this.memory.set(id, value);
    if (this.memory.size > 8) this.memory.delete(this.memory.keys().next().value!);
    this.available = true; listeners.forEach(listener => listener());
  }
  async put(text: string, language: string, data: RecapAudio, expires = Date.now() + RECAP_AUDIO_TTL): Promise<number> {
    const write = this.writes.then(async () => {
      if (this.closed) return;
      const id = await this.id(text, language);
      if (this.closed) return;
      this.remember(id, { data, expires });
      const body = await this.encryption.encrypt({ version: 1, id, expires, data }, null);
      if (!this.closed) await audioStorage({ op: 'put', scope: this.scope, id, body, expires });
    }).catch(() => { /* Storage failures never block playback. */ });
    this.writes = write;
    await write;
    return expires;
  }
  async clear() {
    this.closed = true; this.available = false; this.memory.clear(); this.key = undefined;
    if (active === this) { active = undefined; listeners.forEach(listener => listener()); }
    await this.writes;
    await audioStorage({ op: 'clear', scope: this.scope });
  }
}
