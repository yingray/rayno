import { edgeToken, TRUSTED_CLIENT_TOKEN } from './edgeToken';

export type Cue = { start: number; end: number; offset: number; length: number };
export type SpeechResult = { audio: string; cues: Cue[] };
export type RelaySocket = WebSocket & { accept(): void };
export type RelayFetch = (input: string, init: RequestInit) => Promise<Response & { webSocket?: RelaySocket }>;
const voices = { 'zh-TW': 'zh-TW-HsiaoChenNeural', 'zh-CN': 'zh-CN-XiaoxiaoNeural', en: 'en-US-AriaNeural' };
export type SpeechLanguage = keyof typeof voices;
export const MAX_RECAP_LENGTH = 1000;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unescape = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[key]!);
function base64(chunks: Uint8Array[]) {
  let binary = '';
  for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
  return btoa(binary);
}

/** One bounded Recap request. Only synthetic audio and word timing leave this function. */
export async function synthesizeRecap(text: string, language: SpeechLanguage, signal: AbortSignal, request: RelayFetch = fetch): Promise<SpeechResult> {
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language === 'en' ? 'en-US' : language}"><voice name="${voices[language]}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${escape(clean)}</prosody></voice></speak>`;
  if (new TextEncoder().encode(ssml).length > 4096) throw new Error('Recap exceeds the synthesis limit.');
  const id = crypto.randomUUID().replaceAll('-', '');
  const url = new URL('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1');
  url.search = new URLSearchParams({ TrustedClientToken: TRUSTED_CLIENT_TOKEN, ConnectionId: id,
    'Sec-MS-GEC': edgeToken(), 'Sec-MS-GEC-Version': '2-143.0.3650.75' }).toString();
  const upstream = await request(url.href, { signal, headers: { Upgrade: 'websocket',
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
    Cookie: `muid=${crypto.randomUUID().replaceAll('-', '').toUpperCase()};`,
  } });
  const socket = upstream.webSocket;
  if (upstream.status !== 101 || !socket) throw new Error('Speech service did not accept the connection.');
  return new Promise((resolve, reject) => {
    const audio: Uint8Array[] = [], cues: Cue[] = [];
    let bytes = 0, cursor = 0, done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', aborted);
      socket.close();
      if (error) reject(error);
      else if (!bytes) reject(new Error('Speech service returned no audio.'));
      else resolve({ audio: base64(audio), cues });
    };
    const aborted = () => finish(new Error('Speech request canceled.'));
    const timer = setTimeout(() => finish(new Error('Speech service timed out.')), 12000);
    let pending = Promise.resolve();
    socket.addEventListener('message', (event: MessageEvent) => {
      pending = pending.then(async () => {
        if (done) return;
        if (typeof event.data === 'string') {
          const split = event.data.indexOf('\r\n\r\n');
          const head = split < 0 ? event.data : event.data.slice(0, split);
          if (/Path:turn.end\r?$/m.test(head)) { finish(); return; }
          if (!/Path:audio.metadata\r?$/m.test(head)) return;
          const metadata = JSON.parse(event.data.slice(split + 4));
          for (const item of metadata.Metadata || []) {
            if (item.Type !== 'WordBoundary' || cues.length >= 1000) continue;
            const word = unescape(String(item.Data.text.Text));
            const offset = clean.indexOf(word, cursor);
            if (offset < 0 || !word) continue;
            const start = Number(item.Data.Offset) / 10000000;
            const end = start + Number(item.Data.Duration) / 10000000;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
            cues.push({ start, end, offset, length: word.length });
            cursor = offset + word.length;
          }
        } else {
          const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
          const data = new Uint8Array(buffer);
          if (data.length < 2) throw new Error('Invalid speech audio frame.');
          const length = (data[0] << 8) | data[1];
          if (length + 2 > data.length) throw new Error('Invalid speech audio header.');
          const head = new TextDecoder().decode(data.subarray(2, length + 2));
          if (!/Path:audio\r?$/m.test(head)) return;
          const body = data.slice(length + 2);
          bytes += body.length;
          if (bytes > 1024 * 1024) throw new Error('Speech audio exceeds the limit.');
          if (body.length) audio.push(body);
        }
      }).catch(error => finish(error instanceof Error ? error : new Error('Invalid speech response.')));
    });
    socket.addEventListener('error', () => finish(new Error('Speech connection failed.')));
    socket.addEventListener('close', () => { void pending.then(() => { if (!done) finish(new Error('Speech connection closed early.')); }); });
    signal.addEventListener('abort', aborted, { once: true });
    socket.accept();
    if (signal.aborted) { aborted(); return; }
    const timestamp = new Date().toUTCString();
    socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({ context: { synthesis: { audio: {
      metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    } } } })}\r\n`);
    socket.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
  });
}
