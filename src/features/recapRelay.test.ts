import { afterEach, describe, expect, it, vi } from 'vitest';
import { edgeToken } from '../../server/tts/edgeToken';
import { synthesizeRecap, type RelaySocket } from '../../server/tts/edgeSpeech';
import { handleRecapTts } from '../../server/tts/handler';

afterEach(() => vi.restoreAllMocks());
const post = (body: unknown, ip: string, origin = 'https://rayno.example') => new Request('https://rayno.example/api/tts', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip }, body: JSON.stringify(body),
});

describe('Recap relay', () => {
  it('should match the edge-tts 7.3.1 token vectors across time windows', () => {
    // Arrange / Act: expected values come from the upstream Python implementation.
    const tokens = [1775779200000, 1792800000000].map(edgeToken);
    // Assert
    expect(tokens).toEqual([
      'A66516268A2C0FA7-89D547F242FA0573E7CA64535A0E2165FE4CA1BE66FDD3D11CE297DDA92FB7F4',
      'DE6718128A548C80-796F4E33820D2C549E1EF6D69C9A9756ADA63A487DEA0BD6A488E8DD685D7B97',
    ]);
    expect(edgeToken(1792800000001)).toBe(tokens[1]);
  });

  it('should accept only a bounded same-origin recap and return uncached audio', async () => {
    // Arrange
    const synthesize = vi.fn().mockResolvedValue({ audio: 'YXVkaW8=', cues: [] });
    const body = { text: '摘要讀起來更自然。', language: 'zh-TW' };
    // Act
    const response = await handleRecapTts(post(body, 'success'), synthesize);
    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ audio: 'YXVkaW8=', cues: [] });
    expect(synthesize).toHaveBeenCalledWith(body.text, 'zh-TW', expect.any(AbortSignal));
  });

  it('should reject foreign origins, unsupported languages, and excessive text without synthesis', async () => {
    // Arrange
    const synthesize = vi.fn();
    // Act
    const results = await Promise.all([
      handleRecapTts(post({ text: 'private', language: 'en' }, 'foreign', 'https://elsewhere.example'), synthesize),
      handleRecapTts(post({ text: 'hello', language: 'fr' }, 'language'), synthesize),
      handleRecapTts(post({ text: 'a'.repeat(1001), language: 'en' }, 'long'), synthesize),
      handleRecapTts(post({ text: 'a'.repeat(9000), language: 'en' }, 'body'), synthesize),
    ]);
    // Assert
    expect(results.map(item => item.status)).toEqual([403, 400, 400, 413]);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('should cap bursts and return a generic failure without upstream details', async () => {
    // Arrange
    const synthesize = vi.fn().mockRejectedValue(new Error('private upstream URL and text'));
    const body = { text: 'hello', language: 'en' };
    vi.spyOn(Date, 'now').mockReturnValue(1792800000000);
    // Act
    const responses: Response[] = [];
    for (let i = 0; i < 13; i++) responses.push(await handleRecapTts(post(body, 'burst'), synthesize));
    // Assert
    expect(responses[12].status).toBe(429);
    expect(await responses[0].text()).not.toContain('private');
    expect(synthesize).toHaveBeenCalledTimes(12);
  });

  it('should decode MP3 frames and align escaped word metadata to the original Chinese text', async () => {
    // Arrange
    class Socket extends EventTarget {
      accept = vi.fn(); close = vi.fn(); sent: string[] = [];
      send(message: string) {
        this.sent.push(message);
        if (this.sent.length !== 2) return;
        queueMicrotask(() => {
          const emit = (data: unknown) => this.dispatchEvent(Object.assign(new Event('message'), { data }));
          emit('Path:audio.metadata\r\n\r\n' + JSON.stringify({ Metadata: [
            { Type: 'WordBoundary', Data: { Offset: 1000000, Duration: 2000000, text: { Text: '你好' } } },
            { Type: 'WordBoundary', Data: { Offset: 4000000, Duration: 1000000, text: { Text: '&amp;' } } },
          ] }));
          const header = new TextEncoder().encode('Path:audio\r\nContent-Type:audio/mpeg\r\n');
          const frame = new Uint8Array(header.length + 5);
          frame[0] = header.length >> 8; frame[1] = header.length & 255; frame.set(header, 2); frame.set([1, 2, 3], header.length + 2);
          emit(frame.buffer); emit('Path:turn.end\r\n\r\n');
        });
      }
    }
    const socket = new Socket();
    const request = vi.fn().mockResolvedValue({ status: 101, webSocket: socket as unknown as RelaySocket });
    // Act
    const result = await synthesizeRecap('你好 & 再見', 'zh-TW', new AbortController().signal, request);
    // Assert
    expect(result.audio).toBe('AQID');
    expect(result.cues).toEqual([{ start: 0.1, end: 0.30000000000000004, offset: 0, length: 2 }, { start: 0.4, end: 0.5, offset: 3, length: 1 }]);
    expect(socket.sent[1]).toContain('zh-TW-HsiaoChenNeural');
    expect(socket.sent[1]).toContain('你好 &amp; 再見');
    expect(request.mock.calls[0][0]).toContain('Sec-MS-GEC-Version=2-');
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
