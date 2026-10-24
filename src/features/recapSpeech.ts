import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { currentRecapAudioCache, onRecapAudioCacheChange } from '../happy/recapAudioCache';
import { CloudRecapPlayer, unlockCloudSpeech } from './recapCloudSpeech';

// Keep this module free of the Markdown parser. The chat shell imports it to stop playback.

export type RecapSpeechText = { text: string; segments: readonly { kind: 'text' | 'point'; text: string; index?: number }[] };
export type RecapLanguage = 'zh-TW' | 'zh-CN' | 'en';
export type RecapSpeechState = {
  // The recap that speaks or pauses. Null when nothing plays.
  key: string | null;
  text: string;
  status: 'idle' | 'loading' | 'playing' | 'paused';
  source?: 'cloud' | 'browser';
  duration?: number;
  notice?: string;
  // The point that the voice reads now, from boundary events.
  point: number | null;
  // The last tapped point. It stays active until another tap or playback.
  selected: { key: string; index: number } | null;
  rate: number;
  // True after a playback gets no boundary event in 1.5 s. The time readout is then hidden.
  unreliable: boolean;
};

export const RECAP_RATES = [1, 1.25, 1.5] as const;
const BOUNDARY_TIMEOUT = 1500;
// Han characters. A recap in Chinese uses a Chinese voice.
const CJK_RANGE = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const CJK = new RegExp(`[${CJK_RANGE}]`);
const CJK_ALL = new RegExp(`[${CJK_RANGE}]`, 'g');
// Pairs of common characters that differ between Simplified and Traditional Chinese, in the same order.
const SIMPLIFIED = new Set('这们说时会对没还过来个为国发问题经让实现关见长门车东书写买卖网页电话认识试测码数据务动应该将从开变处复录转错误缓决进运选连远边达迁递语读请调论设访证评详谁记计订讨训议许诉译课诚谢结给线组细终绍统续维绿编级纪约红纯纸练钱铁银钟镜键链锁针负责账货质费资贵购贴败马鸟鱼龙间闭闻阅闹头产样机权条极标构检楼无爱学带广庆库废两严乐义习乡亏亚气华单卫历压厅县参双号吗吓员响园围图圆场块坏坚报声备够夺妈孙宁宝审宽寻导层岁币师异弃张弹强归当彻忆忧怀态总恶悬惊惯战扑执扩扫扬护担拥择挂换摄敌断显晓暂术杂杨档桥欢毕汇汉沟济浅浏览灯灵炼烟热状犹独环画疗盖盘众确础种称积稳穷笔简签类紧罗职联听脑脚兴举虽补装规视觉触赶跃轨软轮较载辑输邮闪队阳阶际陆险随隐难须顺预领频额颜风飞饭饮验鸡节药万与专丢丰临丽么优伤传体侧价军农冻净减几击则刚创删刘剧劝办劳势区医协厂厉叠叶叹吴启呜咨');
const TRADITIONAL = new Set('這們說時會對沒還過來個為國發問題經讓實現關見長門車東書寫買賣網頁電話認識試測碼數據務動應該將從開變處復錄轉錯誤緩決進運選連遠邊達遷遞語讀請調論設訪證評詳誰記計訂討訓議許訴譯課誠謝結給線組細終紹統續維綠編級紀約紅純紙練錢鐵銀鐘鏡鍵鏈鎖針負責賬貨質費資貴購貼敗馬鳥魚龍間閉聞閱鬧頭產樣機權條極標構檢樓無愛學帶廣慶庫廢兩嚴樂義習鄉虧亞氣華單衛歷壓廳縣參雙號嗎嚇員響園圍圖圓場塊壞堅報聲備夠奪媽孫寧寶審寬尋導層歲幣師異棄張彈強歸當徹憶憂懷態總惡懸驚慣戰撲執擴掃揚護擔擁擇掛換攝敵斷顯曉暫術雜楊檔橋歡畢匯漢溝濟淺瀏覽燈靈煉煙熱狀猶獨環畫療蓋盤眾確礎種稱積穩窮筆簡簽類緊羅職聯聽腦腳興舉雖補裝規視覺觸趕躍軌軟輪較載輯輸郵閃隊陽階際陸險隨隱難須順預領頻額顏風飛飯飲驗雞節藥萬與專丟豐臨麗麼優傷傳體側價軍農凍淨減幾擊則剛創刪劉劇勸辦勞勢區醫協廠厲疊葉嘆吳啟嗚諮');

let state: RecapSpeechState = {
  key: null, text: '', status: 'idle', point: null, selected: null, rate: 1, unreliable: false,
};
const listeners = new Set<() => void>();
// Chrome can drop events of an utterance that nothing references.
let utterance: SpeechSynthesisUtterance | null = null;
let segments: RecapSpeechText['segments'] = [];
let charIndex = 0;
let boundaries = false;
let boundaryTimer: number | undefined;
// True when the rate changed during a pause. The resume then starts a new utterance at the new rate.
let rateChanged = false;
// Wall time of the current playback: seconds before the last start, and the start time.
let playedSeconds = 0;
let startedAt = 0;
let gesture = false;
let relayAvailable = false;
let cloud: CloudRecapPlayer | null = null;

function set(next: Partial<RecapSpeechState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function synth(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : undefined;
}

export function speechSupported(): boolean {
  return !!synth() || (relayAvailable || !!currentRecapAudioCache()?.available) && typeof Audio === 'function';
}

// CJK text reads as Traditional Chinese unless Simplified characters are clearly more frequent.
export function recapLanguage(text: string): RecapLanguage {
  if (!CJK.test(text)) return 'en';
  let simplified = 0, traditional = 0;
  for (const character of text) {
    if (SIMPLIFIED.has(character)) simplified++;
    else if (TRADITIONAL.has(character)) traditional++;
  }
  return simplified > traditional ? 'zh-CN' : 'zh-TW';
}

// An exact language match first, then the same language prefix, then the default voice.
export function pickVoice(voices: readonly SpeechSynthesisVoice[], language: RecapLanguage) {
  const lang = (voice: SpeechSynthesisVoice) => voice.lang.replace('_', '-').toLowerCase();
  const prefix = language.split('-')[0];
  return voices.find((voice) => lang(voice) === language.toLowerCase())
    || voices.find((voice) => lang(voice).split('-')[0] === prefix)
    || voices.find((voice) => voice.default)
    || null;
}

// About 14 characters each second for Latin text and 5 for CJK text, at rate 1.
export function estimateSeconds(text: string, rate: number): number {
  const cjk = text.match(CJK_ALL)?.length || 0;
  return (cjk / 5 + (text.length - cjk) / 14) / rate;
}

export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// The point index at a character of the full text, or null for text between points.
export function pointAt(parts: RecapSpeechText['segments'], index: number): number | null {
  let end = 0;
  for (const segment of parts) {
    end += segment.text.length;
    if (index < end) return segment.kind === 'point' ? segment.index ?? null : null;
  }
  return null;
}

function clearBoundaryTimer() {
  if (boundaryTimer !== undefined) clearTimeout(boundaryTimer);
  boundaryTimer = undefined;
}

function speakBrowser(key: string, recap: RecapSpeechText, from: number) {
  const speech = synth();
  if (!speech) return;
  clearBoundaryTimer();
  utterance = null;
  speech.cancel();
  // A paused queue stays paused after cancel in some browsers.
  if (speech.paused) speech.resume();
  const current = new SpeechSynthesisUtterance(recap.text.slice(from));
  const language = recapLanguage(recap.text);
  current.lang = language;
  current.voice = pickVoice(speech.getVoices(), language);
  current.rate = state.rate;
  current.onboundary = (event) => {
    if (utterance !== current) return;
    boundaries = true;
    charIndex = from + event.charIndex;
    const point = pointAt(segments, charIndex);
    if (point !== state.point || state.unreliable) set({ point, unreliable: false });
  };
  const finish = () => {
    if (utterance !== current) return;
    reset();
  };
  current.onend = finish;
  current.onerror = finish;
  utterance = current;
  segments = recap.segments;
  charIndex = from;
  boundaries = false;
  rateChanged = false;
  playedSeconds = estimateSeconds(recap.text.slice(0, from), state.rate);
  startedAt = Date.now();
  // Playback clears the last tapped point, so the highlight follows the voice.
  set({ key, text: recap.text, status: 'playing', source: 'browser', duration: undefined, point: pointAt(segments, from), selected: null });
  speech.speak(current);
  watchBoundaries();
}

// Mark the readout unreliable when 1.5 s of playback gives no boundary event.
function watchBoundaries() {
  clearBoundaryTimer();
  if (boundaries) return;
  const current = utterance;
  boundaryTimer = window.setTimeout(() => {
    boundaryTimer = undefined;
    if (utterance === current && state.status === 'playing' && !boundaries) set({ unreliable: true });
  }, BOUNDARY_TIMEOUT);
}

function reset() {
  clearBoundaryTimer();
  utterance = null;
  segments = [];
  charIndex = 0;
  playedSeconds = 0;
  cloud?.stop(); cloud = null;
  set({ key: null, text: '', status: 'idle', point: null, source: undefined, duration: undefined, notice: undefined, unreliable: false });
}

function speak(key: string, recap: RecapSpeechText, from = 0) {
  stopRecapSpeech();
  const cached = currentRecapAudioCache()?.available;
  if ((!relayAvailable && !cached) || typeof Audio !== 'function' || (!navigator.onLine && !cached) || recap.text.length > 1000 || from) {
    if (synth()) speakBrowser(key, recap, from);
    else set({ key, text: recap.text, status: 'idle', notice: 'Speech is unavailable. Try again later.' });
    return;
  }
  segments = recap.segments;
  set({ key, text: recap.text, status: 'loading', source: 'cloud', point: null, selected: null, notice: undefined, unreliable: false });
  const current = new CloudRecapPlayer({
    ready(duration) {
      if (cloud !== current) return;
      set({ duration, status: state.status === 'paused' ? 'paused' : 'playing' });
    },
    progress(_seconds, duration, offset) {
      if (cloud !== current) return;
      const point = offset === null ? null : pointAt(segments, offset);
      if (point !== state.point || duration !== state.duration) set({ point, duration });
    },
    ended() { if (cloud === current) set({ status: 'idle', point: null }); },
    failed() {
      if (cloud !== current) return;
      const paused = state.status === 'paused';
      current.stop(); cloud = null;
      if (synth()) {
        set({ notice: 'Cloud voice is unavailable. Using the browser voice.' });
        speakBrowser(key, recap, 0);
        if (paused) { synth()?.pause(); clearBoundaryTimer(); set({ status: 'paused' }); }
      } else set({ status: 'idle', source: undefined, notice: 'Speech is unavailable. Try again later.' });
    },
  }, state.rate);
  cloud = current;
  void current.load(recap.text, recapLanguage(recap.text));
}

/** Play, pause, or resume one recap. Only one recap speaks at a time. */
export function toggleRecapSpeech(key: string, recap: RecapSpeechText) {
  if (!speechSupported()) return;
  if (state.key === key && state.text === recap.text && state.status === 'idle' && cloud?.canReplay) {
    cloud.replay(); set({ status: 'playing', point: null, selected: null }); return;
  }
  if (state.key !== key || state.text !== recap.text || state.status === 'idle') speak(key, recap);
  else if (state.status === 'loading') stopRecapSpeech();
  else if (cloud && !cloud.canReplay) speak(key, recap);
  else if (cloud) {
    if (state.status === 'playing') { cloud.pause(); set({ status: 'paused' }); }
    else { cloud.resume(); set({ status: 'playing' }); }
  } else {
    const speech = synth();
    if (!speech) return;
    if (state.status === 'playing') {
      speech.pause(); clearBoundaryTimer();
      playedSeconds += (Date.now() - startedAt) / 1000;
      set({ status: 'paused' });
    } else if (rateChanged) speakBrowser(key, recap, charIndex);
    else {
      speech.resume(); startedAt = Date.now(); set({ status: 'playing' }); watchBoundaries();
    }
  }
}

// Start one recap from the beginning. Autoplay uses it.
export function playRecapSpeech(key: string, recap: RecapSpeechText) {
  speak(key, recap);
}

export function recapSpeechState(): RecapSpeechState {
  return state;
}

export function stopRecapSpeech() {
  if (state.status === 'idle' && !state.key && !cloud) return;
  utterance = null;
  synth()?.cancel();
  reset();
}

// A new rate applies at once: the voice starts again at the last spoken word.
// charIndex is the last boundary, or the start of the current utterance. A paused recap stays paused.
export function cycleRecapRate() {
  const rate = RECAP_RATES[(RECAP_RATES.indexOf(state.rate as typeof RECAP_RATES[number]) + 1) % RECAP_RATES.length];
  const { key, text, status } = state;
  set({ rate });
  if (cloud) cloud.rate = rate;
  else if (key && status === 'playing') speakBrowser(key, { text, segments }, charIndex);
  else if (status === 'paused') rateChanged = true;
}

export function selectRecapPoint(key: string, index: number) {
  set({ selected: { key, index } });
}

// Elapsed seconds of the current playback, from the boundary position or from wall time.
export function recapElapsed(): number {
  if (state.status === 'idle' || state.status === 'loading') return 0;
  if (cloud) return cloud.elapsed / state.rate;
  if (boundaries) return estimateSeconds(state.text.slice(0, charIndex), state.rate);
  return playedSeconds + (state.status === 'playing' ? (Date.now() - startedAt) / 1000 : 0);
}

// True after a pointer or key press on this page. Browsers and this app need it before autoplay.
export function hasUserGesture() {
  return gesture;
}

if (typeof window !== 'undefined') {
  onRecapAudioCacheChange(() => set({}));
  // A static host without the Pages Function returns HTML here and keeps browser speech.
  void fetch('/api/tts', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => {
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const config = await response.json();
      relayAvailable = config.recapTts === true;
      if (relayAvailable) set({});
    }
  }).catch(() => { /* Browser speech remains available offline and on static preview hosts. */ });
  const mark = () => { gesture = true; if (relayAvailable) unlockCloudSpeech(); };
  window.addEventListener('pointerdown', mark, { capture: true, once: true });
  window.addEventListener('keydown', mark, { capture: true, once: true });
  window.addEventListener('pagehide', stopRecapSpeech);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopRecapSpeech(); });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const getState = () => state;

export function useRecapSpeech(): RecapSpeechState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// Render again 4 times each second while active, so the time readout moves.
export function useRecapClock(active: boolean) {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [active]);
}
