import type { HappyCrypto } from './crypto';
import type { History, Json, MessageRecord } from './normalize';

export type CachedWorkspace = {
  version: 1;
  savedAt: number;
  sessions: { wire: Json; metadata: Json; agentState: Json }[];
  machines: { wire: Json; metadata: Json }[];
};
export type CachedHistory = {
  version: 1;
  id: string;
  messages: MessageRecord[];
  cursor: number;
  history: Pick<History, 'loaded' | 'hasMore'>;
};

const DATABASE = 'rayno-offline';
const STORE = 'records';

// Keep account data out of the public service-worker cache and v1 storage.
export class OfflineCache {
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
    try {
      const encrypted = await this.transaction<string>('readonly', (store, result) => {
        const request = store.get(this.scope + key);
        request.onsuccess = () => result(request.result);
      });
      return typeof encrypted === 'string' ? await this.encryption.decrypt<T>(encrypted, null) : null;
    } catch {
      return null;
    }
  }

  async workspace(): Promise<CachedWorkspace | null> {
    const value = await this.read<CachedWorkspace>('workspace');
    return value?.version === 1 && Array.isArray(value.sessions) && Array.isArray(value.machines) ? value : null;
  }

  async history(id: string): Promise<CachedHistory | null> {
    const value = await this.read<CachedHistory>('history.' + id);
    return value?.version === 1 && value.id === id && Array.isArray(value.messages) && value.history?.loaded ? value : null;
  }

  async save(workspace: CachedWorkspace, histories: CachedHistory[]): Promise<boolean> {
    try {
      const entries = await Promise.all([
        ['workspace', workspace] as const,
        ...histories.map((history) => ['history.' + history.id, history] as const),
      ].map(async ([key, value]) => [this.scope + key, await this.encryption.encrypt(value, null)] as const));
      const sessions = new Set(workspace.sessions.map((session) => session.wire.id));
      return await this.transaction<boolean>('readwrite', (store, result) => {
        for (const [key, encrypted] of entries) store.put(encrypted, key);
        const cursor = store.openKeyCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const prefix = this.scope + 'history.';
          if (typeof row.key === 'string' && row.key.startsWith(prefix) && !sessions.has(row.key.slice(prefix.length))) store.delete(row.key);
          row.continue();
        };
        result(true);
      }) === true;
    } catch {
      // Storage limits or eviction must not prevent an online session from loading.
      return false;
    }
  }

  async clear(): Promise<void> {
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
