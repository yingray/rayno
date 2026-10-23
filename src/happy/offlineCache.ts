import { base64, type HappyCrypto } from './crypto';
import type { History, Json, MessageRecord, SavedSubagent } from './normalize';
import { timeStageAsync } from './perf';

export type CachedWorkspace = {
  version: 1;
  savedAt: number;
  sessions: { wire: Json; metadata: Json; agentState: Json }[];
  machines: { wire: Json; metadata: Json }[];
  // Subagent bounds by session id. A background attention scan after a reload needs the bounds from older pages.
  // `read` is the [from, to] seq range in which the client read every row, so a scan knows which starts it can trust.
  subagents?: Record<string, { marks: SavedSubagent[]; read?: [number, number] }>;
};
export type CachedHistory = {
  version: 1;
  id: string;
  messages: MessageRecord[];
  cursor: number;
  history: Pick<History, 'loaded' | 'hasMore'>;
};
// The stored shape of a history. The rows are in pages by seq, so a new row rewrites only its own page.
// `history.<id>` holds this index. Each page is in `history.<id>#<page>`.
type StoredHistory = Omit<CachedHistory, 'version' | 'messages'> & { version: 2; pages: number[] };
type StoredPage = { version: 2; id: string; page: number; messages: MessageRecord[] };

export const HISTORY_PAGE_ROWS = 100;
const pageKey = (id: string, page: number) => `history.${id}#${page}`;

/**
 * Split a history into pages by seq and find the pages that changed since the last save.
 * Rows never change in place (the client only adds rows), so a page with the same row objects is unchanged.
 */
export function historyPages(messages: readonly MessageRecord[], saved?: ReadonlyMap<number, readonly MessageRecord[]>) {
  const pages = new Map<number, MessageRecord[]>();
  for (const row of messages) {
    const page = Number.isSafeInteger(row.seq) && row.seq > 0 ? Math.floor(row.seq / HISTORY_PAGE_ROWS) : 0;
    const rows = pages.get(page);
    if (rows) rows.push(row); else pages.set(page, [row]);
  }
  const changed = [...pages].filter(([page, rows]) => {
    const before = saved?.get(page);
    return !before || before.length !== rows.length || rows.some((row, index) => row !== before[index]);
  }).map(([page]) => page);
  return { pages, changed };
}

const DATABASE = 'rayno-offline';
const STORE = 'records';

/**
 * A key that a save deletes: the history or a page of a removed session, a page that the new index of its history
 * does not list, or an image of a removed session. An image key from before the session id was in it stays.
 */
export function staleCacheKey(key: string, scope: string, sessions: ReadonlySet<string>,
  written: ReadonlyMap<string, ReadonlyMap<number, unknown>>): boolean {
  if (key.startsWith(scope + 'history.')) {
    const [id, page] = key.slice((scope + 'history.').length).split('#');
    return !sessions.has(id) || (page !== undefined && written.has(id) && !written.get(id)!.has(Number(page)));
  }
  if (key.startsWith(scope + 'image.')) {
    const rest = key.slice((scope + 'image.').length), dot = rest.lastIndexOf('.');
    return dot > 0 && !sessions.has(rest.slice(0, dot));
  }
  return false;
}

// Keep account data out of the public service-worker cache and v1 storage.
export class OfflineCache {
  // The pages of each history in the last save that completed. A save writes only the pages that differ.
  private saved = new Map<string, Map<number, MessageRecord[]>>();
  // The session ids at the last key scan. The scan for removed sessions runs only when this list changes.
  private scanned: string | undefined;
  constructor(private readonly scope: string, private readonly encryption: HappyCrypto) {}

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T | null> {
    if (!globalThis.indexedDB) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Offline storage is busy.'));
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        let value: T;
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
        run(transaction.objectStore(STORE), (result) => { value = result; });
      });
    } finally {
      db.close();
    }
  }

  private async read<T>(key: string): Promise<T | null> {
    return (await this.readAll<T>([key]))?.[0] ?? null;
  }

  // Read several keys in one transaction. A missing key gives null in its place.
  private async readAll<T>(keys: string[]): Promise<(T | null)[] | null> {
    try {
      const encrypted = await this.transaction<unknown[]>('readonly', (store, result) => {
        const values: unknown[] = [];
        keys.forEach((key, index) => {
          const request = store.get(this.scope + key);
          request.onsuccess = () => { values[index] = request.result; };
        });
        result(values);
      });
      if (!encrypted) return null;
      return await Promise.all(keys.map((_, index) => typeof encrypted[index] === 'string'
        ? this.encryption.decrypt<T>(encrypted[index], null) : null));
    } catch {
      return null;
    }
  }

  async workspace(): Promise<CachedWorkspace | null> {
    const value = await this.read<CachedWorkspace>('workspace');
    return value?.version === 1 && Array.isArray(value.sessions) && Array.isArray(value.machines) ? value : null;
  }

  async history(id: string): Promise<CachedHistory | null> {
    const value = await this.read<CachedHistory | StoredHistory>('history.' + id);
    if (value?.id !== id || !value.history?.loaded) return null;
    // Version 1 holds all rows in one record. A save after this version writes pages.
    if (value.version === 1) return Array.isArray(value.messages) ? value : null;
    if (value.version !== 2 || !Array.isArray(value.pages)) return null;
    const pages = await this.readAll<StoredPage>(value.pages.map((page) => pageKey(id, page)));
    // A missing page makes the copy incomplete. Then the chat reads the server instead.
    if (!pages || pages.some((page, index) => page?.version !== 2 || page.id !== id || page.page !== value.pages[index]
      || !Array.isArray(page.messages))) return null;
    return { version: 1, id, cursor: value.cursor, history: value.history, messages: pages.flatMap((page) => page!.messages) };
  }

  async save(workspace: CachedWorkspace, histories: CachedHistory[]): Promise<boolean> {
    try {
      const written = new Map<string, Map<number, MessageRecord[]>>();
      const values: (readonly [string, unknown])[] = [['workspace', workspace]];
      for (const history of histories) {
        const { pages, changed } = historyPages(history.messages, this.saved.get(history.id));
        written.set(history.id, pages);
        const index: StoredHistory = { version: 2, id: history.id, cursor: history.cursor, history: history.history, pages: [...pages.keys()] };
        values.push(['history.' + history.id, index]);
        for (const page of changed)
          values.push([pageKey(history.id, page), { version: 2, id: history.id, page, messages: pages.get(page)! } satisfies StoredPage]);
      }
      const entries = await timeStageAsync('cache-encrypt', () => Promise.all(values
        .map(async ([key, value]) => [this.scope + key, await this.encryption.encrypt(value, null)] as const)));
      const sessions = new Set(workspace.sessions.map((session) => session.wire.id));
      const list = [...sessions].sort().join('\n'), scan = list !== this.scanned;
      // A page that the last save wrote and the new index does not list. After a reload, the scan finds such pages.
      const removed = [...written].flatMap(([id, pages]) => [...this.saved.get(id)?.keys() || []]
        .filter((page) => !pages.has(page)).map((page) => this.scope + pageKey(id, page)));
      const saved = await this.transaction<boolean>('readwrite', (store, result) => {
        for (const [key, encrypted] of entries) store.put(encrypted, key);
        removed.forEach((key) => store.delete(key));
        if (scan) {
          const cursor = store.openKeyCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (typeof row.key === 'string' && staleCacheKey(row.key, this.scope, sessions, written)) store.delete(row.key);
            row.continue();
          };
        }
        result(true);
      }) === true;
      if (saved) {
        if (scan) this.scanned = list;
        written.forEach((pages, id) => this.saved.set(id, pages));
        [...this.saved.keys()].forEach((id) => { if (!sessions.has(id)) this.saved.delete(id); });
      }
      return saved;
    } catch {
      // Storage limits or eviction must not prevent an online session from loading.
      return false;
    }
  }

  // `image.<session id>.<hash>`. The session id lets a scan delete the images of a removed session.
  // Before, the key was `image.<hash>`. A read still finds an image that an older version saved.
  private async imageKey(id: string, ref: string, legacy = false) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${ref}`));
    return 'image.' + (legacy ? '' : id + '.') + base64(new Uint8Array(digest), true);
  }

  async image(id: string, ref: string): Promise<string | null> {
    type Saved = { version: number; id: string; ref: string; data: string };
    const valid = (value: Saved | null) => value?.version === 1 && value.id === id && value.ref === ref && typeof value.data === 'string';
    const value = await this.read<Saved>(await this.imageKey(id, ref));
    if (valid(value)) return value!.data;
    const legacy = await this.read<Saved>(await this.imageKey(id, ref, true));
    return valid(legacy) ? legacy!.data : null;
  }

  async saveImage(id: string, ref: string, data: Uint8Array): Promise<void> {
    try {
      const key = this.scope + await this.imageKey(id, ref);
      const encrypted = await this.encryption.encrypt({ version: 1, id, ref, data: base64(data) }, null);
      await this.transaction<void>('readwrite', store => { store.put(encrypted, key); });
    } catch { /* Storage limits do not block an online image preview. */ }
  }

  async clear(): Promise<void> {
    this.saved.clear();
    this.scanned = undefined;
    try {
      await this.transaction<void>('readwrite', (store) => {
        const cursor = store.openKeyCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (typeof row.key === 'string' && row.key.startsWith(this.scope)) store.delete(row.key);
          row.continue();
        };
      });
    } catch { /* A blocked browser store does not block sign-out. */ }
  }
}
