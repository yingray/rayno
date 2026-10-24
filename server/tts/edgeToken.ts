// SPDX-License-Identifier: LGPL-3.0-only
// TypeScript port of edge-tts drm.py (rany2/edge-tts, 7.3), modified for Workers.
// Copyright rany and edge-tts contributors. See server/licenses/edge-tts.txt.
const _SHA256_INITIAL = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
const _SHA256_STATE = [4255104674, 2435071207, 3192492180, 3442351626, 1811967817, 79508907, 4272990180, 66059218];
const _SHA256_SCHEDULE = [3945054110, 358115615, 2696978146, 217723578, 2787307148, 3520959633, 3235718560, 4192668342, 4039316851, 1884868174, 1904797190, 15051571, 3529027680, 1920361828];
const _SHA256_ROUND_CONSTANTS = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298];
const _CS64_COEFFICIENTS = [[3895366065, 3005677776], [1155409094, 2296378653], [1005282748, 693190712], [3365689651, 3005795295], [2367603217, 3557143765], [827258325, 652566332], [3911487921, 1618477510], [4037392853, 2192753147], [101076211, 4199654362], [3665427040, 545047652], [3201434976, 1010595059], [2314848760, 3536931681], [905590982, 3137643201], [3410617286, 3311559015]];
const token = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const TRUSTED_CLIENT_TOKEN = token;
const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
const swap = (x: number) => (x << 16) | (x >>> 16);
const sigma0 = (x: number) => (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) >>> 0;
const sigma1 = (x: number) => (rotate(x, 17) ^ rotate(x, 19) ^ (x >>> 10)) >>> 0;
function expand(words: number[], from = 16) {
  for (let i = from; i < 64; i++) words[i] = (sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]) >>> 0;
}
function rounds(state: number[], words: number[], from = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = from; i < 64; i++) {
    const k = from === 14 && i === 14 ? 0xc9dc06a7 : _SHA256_ROUND_CONSTANTS[i];
    const t = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (g ^ (e & (f ^ g))) + k + words[i]) >>> 0;
    const u = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
    [a, b, c, d, e, f, g, h] = [(t + u) >>> 0, a, b, c, (d + t) >>> 0, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}
function digest(data: Uint8Array) {
  const words = new Array<number>(14).fill(0);
  words.push((data[0] << 16) | (data[1] << 8) | data[2]);
  words.push(((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0);
  for (let i = 16; i < 30; i++) words[i] = (_SHA256_SCHEDULE[i - 16]
    + (i === 16 ? (sigma1(words[14]) ^ 0x000b92c0) >>> 0 : sigma1(words[i - 2]))
    + (i >= 21 ? words[i - 7] : 0) + (i === 29 ? (sigma0(words[14]) ^ 0x059c0b80) >>> 0 : 0)) >>> 0;
  words[30] = (sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + 0xc9dc06a7 - _SHA256_ROUND_CONSTANTS[14]) >>> 0;
  expand(words, 31);
  let state = rounds(_SHA256_STATE, words, 14).map((x, i) => (x + _SHA256_INITIAL[i]) >>> 0);
  const length = 57 + data.length;
  const tail = new Uint8Array(data.length - 7 + 1 + ((55 - length) % 64 + 64) % 64 + 8);
  tail.set(data.subarray(7)); tail[data.length - 7] = 0x80;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.length - 4, length * 8);
  for (let offset = 0; offset < tail.length; offset += 64) {
    const block = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4));
    expand(block);
    state = rounds(state, block).map((x, i) => (x + state[i]) >>> 0);
  }
  const result = new Uint8Array(32), output = new DataView(result.buffer);
  state.forEach((x, i) => output.setUint32(i * 4, x));
  return result;
}
function checksum(data: Uint8Array, hash: Uint8Array) {
  const keysView = new DataView(hash.buffer);
  const keys = [keysView.getUint32(0, true) | 1, keysView.getUint32(4, true) | 1];
  const factors = keys.map(x => Math.imul(x, 0x82893933));
  const terms = _CS64_COEFFICIENTS.map(([x], i) => Math.imul(x, factors[i % 2]));
  const offsets = _CS64_COEFFICIENTS.map(([, y]) => y);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8); padded.set(data, 1);
  const input = new DataView(padded.buffer);
  for (let i = 0; i < padded.length / 4; i++) {
    const word = input.getUint32(i * 4, true);
    terms.push((Math.imul(word, keys[i % 2]) + (i === 0 ? Math.imul(0xf2f90b1a, factors[0]) : 0)) >>> 0);
    offsets.push((Math.imul(swap(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db) + (i === 0 ? 0x0b1a0000 : 0)) >>> 0);
  }
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    let q = Math.imul(swap((offsets[i] + terms[i]) >>> 0), 0x76f50f34);
    swapAcc = (swapAcc + Math.imul(swap(q), 0xc3efea97) + q) >>> 0;
    q = Math.imul(swap((offsets[i + 1] + terms[i + 1]) >>> 0), 0x1881ce3c);
    swapLast = (Math.imul(swap(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (Math.imul(state, keys[0]) + terms[i]) >>> 0;
    for (const factor of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) state = Math.imul(swap(state), factor);
    acc = (acc + state) >>> 0;
    let t = (Math.imul(state, keys[1]) + terms[i + 1]) >>> 0;
    for (const factor of [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]) t = Math.imul(swap(t), factor);
    state = t; acc = (acc + state) >>> 0;
  }
  const result = new Uint8Array(8), view = new DataView(result.buffer);
  view.setUint32(0, (swapLast ^ state) >>> 0, true); view.setUint32(4, (swapAcc ^ acc) >>> 0, true);
  return result;
}
const hex = (data: Uint8Array) => Array.from(data, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
let cached: { window: number; value: string } | undefined;
export function edgeToken(now = Date.now()) {
  const window = Math.floor((Math.floor(now / 1000) + 11644473600) / 300) * 300;
  if (cached?.window === window) return cached.value;
  const data = new TextEncoder().encode(`${BigInt(window) * 10000000n}${token}`);
  const hash = digest(data);
  const value = `${hex(checksum(data, hash))}-${hex(hash)}`;
  cached = { window, value };
  return value;
}
