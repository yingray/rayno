import { MAX_RECAP_LENGTH, synthesizeRecap, type SpeechLanguage } from './edgeSpeech';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
// Best-effort burst control per isolate, with bounded memory. The free account quota remains the hard daily cap.
const bursts = new Map<string, { at: number; count: number }>();
export async function handleRecapTts(request: Request, synthesize = synthesizeRecap): Promise<Response> {
  if (request.method === 'GET') return json({ recapTts: true, maxLength: MAX_RECAP_LENGTH });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Origin not allowed.' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
  const now = Date.now(), ip = request.headers.get('CF-Connecting-IP') || 'local';
  const previous = bursts.get(ip);
  if (previous && now - previous.at < 60000 && previous.count >= 12) return json({ error: 'Too many speech requests. Try again shortly.' }, 429);
  if (bursts.size >= 1024) bursts.clear();
  bursts.set(ip, previous && now - previous.at < 60000 ? { ...previous, count: previous.count + 1 } : { at: now, count: 1 });
  try {
    // Bound the body before JSON parsing, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'A recap is required.' }, 400);
    let raw = '', size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json({ error: 'Recap too long.' }, 413); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    const body = JSON.parse(raw);
    if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > MAX_RECAP_LENGTH
      || !['zh-TW', 'zh-CN', 'en'].includes(body.language)) return json({ error: 'Invalid recap or language.' }, 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    const result = await synthesize(body.text, body.language as SpeechLanguage, signal);
    return json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON.' }, 400);
    // Never log recap text, credentials, or the upstream URL.
    return json({ error: 'Cloud speech is unavailable. Use the browser voice.' }, 502);
  }
}
