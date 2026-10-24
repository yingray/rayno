import { afterEach, describe, expect, it, vi } from 'vitest';
import { HappyCrypto } from './crypto';
import { RecapAudioCache, RECAP_AUDIO_TTL } from './recapAudioCache';
import { audioStorage } from './recapAudioStorage';

vi.mock('./recapAudioStorage', () => ({ audioStorage: vi.fn() }));
const records = new Map<string, { body: string; expires: number }>();
const audio = { audio: 'synthetic-audio-base64', cues: [{ start: 0, end: 1, offset: 0, length: 2 }] };
const now = 1792800000000;
function storage() {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.mocked(audioStorage).mockImplementation(async message => {
    const key = `${message.scope}/${message.id}`;
    if (message.op === 'put') { records.set(key, { body: message.body!, expires: message.expires! }); return true; }
    if (message.op === 'get') {
      const item = records.get(key);
      if (item && item.expires <= Date.now()) { records.delete(key); return null; }
      return item ?? null;
    }
    if (message.op === 'clear') {
      for (const key of records.keys()) if (key.startsWith(message.scope + '/')) records.delete(key);
      return true;
    }
    if (message.op === 'delete') return records.delete(key);
    return [...records.keys()].some(key => key.startsWith(message.scope + '/'));
  });
}
afterEach(() => { records.clear(); vi.restoreAllMocks(); vi.mocked(audioStorage).mockReset(); });

describe('Recap audio cache', () => {
  it('should restore encrypted audio after a new page cache instance without extending its one-day expiry', async () => {
    // Arrange
    storage(); const encryption = await HappyCrypto.create(new Uint8Array(32).fill(11));
    const cache = new RecapAudioCache('account.server-one', encryption);
    // Act
    await cache.put('這是私人摘要', 'zh-TW', audio);
    vi.mocked(Date.now).mockReturnValue(now + RECAP_AUDIO_TTL - 1);
    const restored = await new RecapAudioCache('account.server-one', encryption).get('這是私人摘要', 'zh-TW');
    // Assert
    expect(restored).toEqual({ data: audio, expires: now + RECAP_AUDIO_TTL });
    const saved = [...records.values()][0];
    expect(saved.body).not.toContain('這是私人摘要');
    expect(saved.body).not.toContain(audio.audio);
    expect([...records.keys()][0]).not.toContain('這是私人摘要');
    // Act / Assert: expiry is absolute, including in-memory reads.
    vi.mocked(Date.now).mockReturnValue(now + RECAP_AUDIO_TTL);
    expect(await cache.get('這是私人摘要', 'zh-TW')).toBeNull();
    expect(records.size).toBe(0);
  });

  it('should isolate accounts, servers, text changes, and voice languages', async () => {
    // Arrange
    storage(); const first = await HappyCrypto.create(new Uint8Array(32).fill(11));
    const other = await HappyCrypto.create(new Uint8Array(32).fill(12));
    await new RecapAudioCache('account-one.server-one', first).put('same text', 'en', audio);
    // Act / Assert
    expect(await new RecapAudioCache('account-two.server-one', other).get('same text', 'en')).toBeNull();
    expect(await new RecapAudioCache('account-one.server-two', first).get('same text', 'en')).toBeNull();
    expect(await new RecapAudioCache('account-one.server-one', other).get('same text', 'en')).toBeNull();
    const original = new RecapAudioCache('account-one.server-one', first);
    expect(await original.get('changed text', 'en')).toBeNull();
    expect(await original.get('same text', 'zh-TW')).toBeNull();
    expect(await original.get('same text', 'en')).toEqual({ data: audio, expires: now + RECAP_AUDIO_TTL });
  });

  it('should remove only the signed-out account and prevent later writes from restoring its cache', async () => {
    // Arrange
    storage(); const encryption = await HappyCrypto.create(new Uint8Array(32).fill(11));
    const first = new RecapAudioCache('account-one', encryption), other = new RecapAudioCache('account-two', encryption);
    await first.put('one', 'en', audio); await other.put('two', 'en', audio);
    // Act
    await first.clear(); await first.put('late write', 'en', audio);
    // Assert
    expect(await first.get('one', 'en')).toBeNull();
    expect(records.size).toBe(1);
    expect([...records.keys()][0]).toMatch(/^account-two\//);
    expect(await other.get('two', 'en')).not.toBeNull();
  });

  it('should ignore a corrupt encrypted entry without returning another response', async () => {
    // Arrange
    storage(); const encryption = await HappyCrypto.create(new Uint8Array(32).fill(11));
    await new RecapAudioCache('account-one', encryption).put('one', 'en', audio);
    [...records.values()][0].body = 'corrupt';
    // Act
    const restored = await new RecapAudioCache('account-one', encryption).get('one', 'en');
    // Assert
    expect(restored).toBeNull();
  });
});
