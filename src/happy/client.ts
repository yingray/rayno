import { io, type Socket } from 'socket.io-client';
import type {
  Attachment,
  DemoAdapter,
  Machine,
  MessageSettings,
  NewSessionDraft,
  Session,
  UsageReading,
} from '../data/types';
import { CLIENT_ID, type Credentials } from './auth';
import { base64, HappyCrypto, unbase64 } from './crypto';
import {
  agentName,
  normalizeMachine,
  normalizeSession,
  record,
  visibleMessages,
  weeklyUsage,
  isRig,
  isSessionArchived,
  messageMeta,
  currentModel,
  currentPermission,
} from './normalize';
import type { History, Json, MachineRecord, MessageRecord, SessionRecord } from './normalize';
import { MACHINE_HEALTH_SCRIPT, parseMachineHealth } from './machineHealth';
import { buildManualUsageCommand, parseManualUsage } from './manualUsage';
import { compareSessionActivity } from '../data/sessionList';
import { modelOptions, effortOptions, canSelectModel, defaultEffort, isConcreteModel } from './modelOptions';
import { permissionOptions, canSelectPermission } from './permissionOptions';
import { attentionMessage, receiveAttention, restoreAttention, mergeAttention, type SessionAttention } from './sessionAttention';
import { OfflineCache, type CachedHistory, type CachedWorkspace } from './offlineCache';
import { shallowEqual } from '../data/subscriptions';
import type { Message } from '../data/types';

const emptyJson: Json = Object.freeze({});

export type Snapshot = {
  sessions: Session[];
  machines: Machine[];
  usage: UsageReading[];
  usageLoading: boolean;
  usageErrors: string[];
  usageReadAt: number;
  connection: 'connecting' | 'connected' | 'disconnected';
  connectionError: string;
  offline: boolean;
  cachedAt: number;
  retrying: boolean;
  loading: boolean;
  error: string;
  unauthorized: boolean;
  histories: Record<string, History>;
  sessionData: Record<string, { metadata: Json; agentState: Json }>;
  monitorErrors: string[];
};
export const emptySnapshot: Snapshot = {
  sessions: [],
  machines: [],
  usage: [],
  usageLoading: false,
  usageErrors: [],
  usageReadAt: 0,
  connection: 'connecting',
  connectionError: '',
  offline: false,
  cachedAt: 0,
  retrying: false,
  loading: true,
  error: '',
  unauthorized: false,
  histories: {},
  sessionData: {},
  monitorErrors: [],
};
import { messageError } from './errors';
export { messageError } from './errors';
export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
type Outbox = { fingerprint: string; localId: string; content: string };

export class HappyClient implements DemoAdapter {
  private socket: Socket | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private controllers = new Set<AbortController>();
  private sessions = new Map<string, SessionRecord>();
  private machines = new Map<string, MachineRecord>();
  private messages = new Map<string, Map<string, MessageRecord>>();
  private visibleHistory = new Map<string, { source: Map<string, MessageRecord> | undefined; size: number; messages: Message[] }>();
  private historyCursors = new Map<string, number>();
  private deletedSessions = new Set<string>();
  private historyRequests = new Map<string, Promise<void>>();
  private activeSessions = new Set<string>();
  private sending = new Set<string>();
  private acknowledged = new Set<string>();
  private attention = new Map<string, SessionAttention>();
  private attentionRequests = new Map<string, Promise<void>>();
  private readingSessions = new Set<string>();
  private attentionInitialized = false;
  private refreshRequest: Promise<void> | null = null;
  private presenceRevision = 0;
  private sessionPresence = new Map<string, number>();
  private machinePresence = new Map<string, number>();
  private usageRequest: Promise<void> | null = null;
  private events: Promise<void> = Promise.resolve();
  private snapshot: Snapshot = { ...emptySnapshot };
  private storage: Storage;
  private cache: OfflineCache;
  private cacheReady = false;
  private cacheDisabled = false;
  private cacheTimer: number | undefined;
  private cacheWrite = Promise.resolve();
  private cacheDirty = false;
  private dirtyHistories = new Set<string>();
  private restoredHistories = new Set<string>();
  readonly storageKey: string;
  private constructor(
    readonly credentials: Credentials,
    readonly encryption: HappyCrypto,
    scope: string,
  ) {
    this.storageKey = `rayno.v2.account.${scope}.`;
    this.cache = new OfflineCache(this.storageKey, encryption);
    if (globalThis.navigator?.onLine === false)
      this.snapshot = { ...this.snapshot, offline: true, connection: 'disconnected', loading: false };
    this.storage = localStorage.getItem('rayno.v2.credentials') ? localStorage : sessionStorage;
    this.attentionInitialized = this.readLocal('attentionInitialized') === 'true';
  }
  static async create(credentials: Credentials) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(credentials.server + ':' + credentials.secret),
    );
    const client = new HappyClient(
      credentials,
      await HappyCrypto.create(unbase64(credentials.secret)),
      base64(new Uint8Array(bytes), true).slice(0, 24),
    );
    await client.restoreWorkspace();
    client.cacheReady = true;
    return client;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(value: Partial<Snapshot>) {
    if (this.disposed) return;
    if (Object.keys(value).every((key) => Object.is(this.snapshot[key as keyof Snapshot], value[key as keyof Snapshot]))) return;
    this.snapshot = { ...this.snapshot, ...value };
    this.listeners.forEach((listener) => listener());
  }
  private publish(changedSession?: string, changedMachine?: string) {
    const previousSessions = new Map(this.snapshot.sessions.map((session) => [session.id, session]));
    const previousMachines = new Map(this.snapshot.machines.map((machine) => [machine.id, machine]));
    const sessions = [...this.sessions.values()]
        .map((source) => {
          const id = source.wire.id;
          const previous = previousSessions.get(id);
          if (previous && (changedSession || changedMachine) && id !== changedSession && source.metadata.machineId !== changedMachine)
            return previous;
          const rows = this.messages.get(id);
          let history = this.visibleHistory.get(id);
          if (!history || history.source !== rows || history.size !== (rows?.size || 0)) {
            history = { source: rows, size: rows?.size || 0, messages: visibleMessages([...(rows?.values() || [])]) };
            this.visibleHistory.set(id, history);
          }
          const attention = this.sessionAttention(source.wire.id);
          const next = normalizeSession(
            source,
            history.messages,
            attention.assistantSeq > attention.readSeq,
            this.machines.get(source.metadata.machineId),
            attention.optionsSeq > attention.userSeq,
          );
          return previous && shallowEqual(previous, next) ? previous : next;
        })
        .sort(compareSessionActivity);
    const machines = changedSession ? this.snapshot.machines : [...this.machines.values()].map((source) => {
      const previous = previousMachines.get(source.wire.id);
      if (previous && changedMachine && source.wire.id !== changedMachine) return previous;
      const next = normalizeMachine(source, previous);
      return previous && shallowEqual(previous, next) ? previous : next;
    });
    for (const id of this.visibleHistory.keys()) if (!this.sessions.has(id)) this.visibleHistory.delete(id);
    const sessionData = Object.fromEntries([...this.sessions].map(([id, source]) => {
      const previous = this.snapshot.sessionData[id];
      return [id, previous?.metadata === source.metadata && previous.agentState === source.agentState
        ? previous : { metadata: source.metadata, agentState: source.agentState }];
    }));
    this.patch({
      sessions: shallowEqual(sessions, this.snapshot.sessions) ? this.snapshot.sessions : sessions,
      machines: shallowEqual(machines, this.snapshot.machines) ? this.snapshot.machines : machines,
      sessionData: shallowEqual(sessionData, this.snapshot.sessionData) ? this.snapshot.sessionData : sessionData,
    });
    this.scheduleCache();
  }
  private async restoreWorkspace() {
    const cached = await this.cache.workspace();
    if (!cached) return;
    try {
      const sessions = await Promise.all(cached.sessions.map(async (source) => ({ ...source,
        key: await this.encryption.unwrapKey(source.wire.dataEncryptionKey),
      })));
      const machines = await Promise.all(cached.machines.map(async (source) => ({ ...source,
        key: await this.encryption.unwrapKey(source.wire.dataEncryptionKey),
      })));
      sessions.forEach((source) => this.sessions.set(source.wire.id, source));
      machines.forEach((source) => this.machines.set(source.wire.id, source));
      this.patch({ cachedAt: cached.savedAt });
      this.publish();
    } catch { /* An incompatible cache does not block a fresh server read. */ }
  }
  private scheduleCache(id?: string) {
    if (!this.cacheReady || this.cacheDisabled || this.disposed) return;
    this.cacheDirty = true;
    if (id) this.dirtyHistories.add(id);
    if (this.cacheTimer !== undefined) return;
    this.cacheTimer = window.setTimeout(() => { void this.flushCache(); }, 500);
  }
  private flushCache() {
    window.clearTimeout(this.cacheTimer);
    this.cacheTimer = undefined;
    if (!this.cacheDirty || this.cacheDisabled) return this.cacheWrite;
    this.cacheDirty = false;
    const workspace: CachedWorkspace = {
      version: 1, savedAt: Date.now(),
      sessions: [...this.sessions.values()].map(({ wire, metadata, agentState }) => ({ wire, metadata, agentState })),
      machines: [...this.machines.values()].map(({ wire, metadata }) => ({ wire, metadata })),
    };
    const histories: CachedHistory[] = [...this.dirtyHistories].flatMap((id) => {
      const history = this.snapshot.histories[id];
      return this.sessions.has(id) && history?.loaded ? [{
        version: 1, id, messages: [...(this.messages.get(id)?.values() || [])],
        cursor: this.historyCursors.get(id) || 0,
        history: { loaded: true, hasMore: history.hasMore },
      }] : [];
    });
    this.dirtyHistories.clear();
    this.cacheWrite = this.cacheWrite.then(async () => {
      if (!this.cacheDisabled && await this.cache.save(workspace, histories)) this.patch({ cachedAt: workspace.savedAt });
    }).catch(() => { /* The live state remains usable when storage is unavailable. */ });
    return this.cacheWrite;
  }
  private async restoreHistory(id: string) {
    if (this.restoredHistories.has(id)) return;
    this.restoredHistories.add(id);
    const cached = await this.cache.history(id);
    if (!cached || this.disposed || !this.sessions.has(id)) return;
    const messages = this.messages.get(id) || new Map<string, MessageRecord>();
    cached.messages.forEach((row) => { if (!messages.has(row.id)) messages.set(row.id, row); });
    this.messages.set(id, messages);
    this.historyCursors.set(id, Math.max(this.historyCursors.get(id) || 0, cached.cursor));
    this.patch({ histories: { ...this.snapshot.histories, [id]: { ...cached.history, loading: false, error: '' } } });
    this.publish(id);
  }
  private assertAlive() {
    if (this.disposed) throw new Error('This v2 connection is closed.');
  }
  private getSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('The session is not available. Refresh the session list.');
    return session;
  }
  private sessionAttention(id: string) {
    let state = this.attention.get(id);
    if (!state) {
      const head = this.sessions.get(id)?.wire.seq;
      state = restoreAttention(this.readLocal('attention.' + id),
        !this.attentionInitialized && Number.isSafeInteger(head) && head >= 0 ? head : 0);
      this.attention.set(id, state);
      this.saveAttention(id);
    }
    return state;
  }
  private saveAttention(id: string) {
    const state = this.attention.get(id);
    if (!state) return;
    const merged = mergeAttention(state, restoreAttention(this.readLocal('attention.' + id), 0));
    this.attention.set(id, merged);
    try { this.writeLocal('attention.' + id, JSON.stringify(merged)); } catch { /* Keep this visit's state if storage is unavailable. */ }
  }
  setSessionReading(id: string, reading: boolean) {
    if (this.disposed) return;
    if (reading) this.readingSessions.add(id);
    else this.readingSessions.delete(id);
    if (!reading || document.visibilityState !== 'visible' || !document.hasFocus() || !this.sessions.has(id)) return;
    const state = this.sessionAttention(id);
    if (state.assistantSeq <= state.readSeq) return;
    let readSeq = state.readSeq;
    for (const row of this.messages.get(id)?.values() || [])
      if (attentionMessage(row) === 'assistant') readSeq = Math.max(readSeq, row.seq);
    if (readSeq <= state.readSeq) return;
    this.attention.set(id, { ...state, readSeq });
    this.saveAttention(id);
    this.publish(id);
  }
  readLocal(key: string) {
    try {
      return this.storage.getItem(this.storageKey + key);
    } catch {
      return null;
    }
  }
  writeLocal(key: string, value: string) {
    this.assertAlive();
    this.storage.setItem(this.storageKey + key, value);
  }
  async clearLocal() {
    this.cacheDisabled = true;
    window.clearTimeout(this.cacheTimer);
    for (const storage of [sessionStorage, localStorage])
      for (const key of Object.keys(storage))
        if (key.startsWith(this.storageKey)) storage.removeItem(key);
    await this.cacheWrite;
    await this.cache.clear();
  }
  private async request(path: string, init: RequestInit = {}): Promise<Json> {
    this.assertAlive();
    if (this.snapshot.offline) throw new Error('Reconnect to Happy before this request.');
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(this.credentials.server + path, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.credentials.token}`,
          'X-Happy-Client': CLIENT_ID,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      this.assertAlive();
      if (response.status === 401 || response.status === 403)
        this.patch({
          unauthorized: true,
          error: 'Happy authorization expired. Sign in to v2 again.',
        });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : `Happy request failed (${response.status}).`,
        );
      }
      return response.status === 204 ? {} : response.json();
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  start() {
    this.assertAlive();
    const activity = () =>
      document.visibilityState === 'visible' && document.hasFocus() ? 'active' : 'background';
    this.socket = io(this.credentials.server, {
      path: '/v1/updates',
      transports: ['websocket'],
      autoConnect: false,
      auth: (callback) =>
        callback({
          token: this.credentials.token,
          clientType: 'user-scoped',
          happyClient: CLIENT_ID,
          appState: activity(),
        }),
    });
    this.socket.on('connect', () => {
      this.patch({ connection: 'connected', connectionError: '' });
      this.socket?.emit('app-state', { state: activity() });
      void this.refresh()
        .then(() =>
          Promise.all([...this.activeSessions].map((id) => this.loadHistory(id, 'forward'))),
        )
        .catch((error) => this.patch({ error: messageError(error) }));
    });
    this.socket.on('disconnect', () => this.patch({ connection: 'disconnected' }));
    this.socket.on('connect_error', () =>
      this.patch({
        connection: 'disconnected',
        connectionError: 'The realtime connection is unavailable. Try again to reconnect.',
        retrying: false,
      }),
    );
    this.socket.on('update', (event) => {
      this.events = this.events
        .then(() => this.update(record(event.body)))
        .catch((error) => this.patch({ error: messageError(error) }));
    });
    this.socket.on('ephemeral', (event) => this.ephemeral(record(event)));
    const visibility = () => {
      if (this.socket?.connected) this.socket.emit('app-state', { state: activity() });
      if (activity() !== 'active') void this.flushCache();
      if (activity() === 'active' && !this.snapshot.offline) {
        this.readingSessions.forEach((id) => this.setSessionReading(id, true));
        void this.refresh()
          .then(() => Promise.all([...this.activeSessions].map((id) => this.loadHistory(id, 'forward'))))
          .catch((error) => this.patch({ error: messageError(error) }));
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (!event.key?.startsWith(this.storageKey + 'attention.')) return;
      const id = event.key.slice((this.storageKey + 'attention.').length);
      if (!this.sessions.has(id) || !event.newValue) return;
      this.attention.set(id, mergeAttention(this.sessionAttention(id), restoreAttention(event.newValue, 0)));
      this.publish(id);
    };
    window.addEventListener('focus', visibility);
    window.addEventListener('blur', visibility);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('storage', storageChanged);
    const offline = () => {
      this.patch({ offline: true, connection: 'disconnected', loading: false, error: '', connectionError: '', retrying: false });
      this.socket?.disconnect();
      this.controllers.forEach((controller) => controller.abort());
      void this.flushCache();
    };
    const online = () => {
      this.patch({ offline: false, connection: 'connecting', error: '', connectionError: '' });
      this.socket?.connect();
      void this.refresh().catch((error) => this.patch({ error: messageError(error) }));
    };
    const save = () => { void this.flushCache(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('pagehide', save);
    this.cleanup = () => {
      window.removeEventListener('focus', visibility);
      window.removeEventListener('blur', visibility);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', save);
    };
    if (!this.snapshot.offline) {
      this.socket.connect();
      void this.refresh().catch((error) =>
        this.patch({ loading: false, error: messageError(error) }),
      );
    }
  }
  private cleanup = () => {};
  dispose() {
    void this.flushCache();
    this.disposed = true;
    this.cleanup();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.controllers.forEach((controller) => controller.abort());
    this.listeners.clear();
    this.sessions.clear();
    this.messages.clear();
    this.visibleHistory.clear();
    this.machines.clear();
    this.sessionPresence.clear();
    this.machinePresence.clear();
    this.attention.clear();
    this.readingSessions.clear();
  }
  async refresh(force = false): Promise<void> {
    if (this.snapshot.offline) return;
    if (this.refreshRequest) {
      if (!force) return this.refreshRequest;
      await this.refreshRequest;
      return this.refresh();
    }
    this.refreshRequest = this.refreshRecords().finally(() => {
      this.refreshRequest = null;
    });
    return this.refreshRequest;
  }
  async retry() {
    if (this.snapshot.offline || this.disposed) return;
    this.patch({ retrying: true, error: '', connectionError: '' });
    if (!this.socket?.connected) this.socket?.connect();
    try {
      await this.refresh();
      await Promise.all([...this.activeSessions].map((id) => this.loadHistory(id, 'forward')));
    } catch (error) {
      this.patch({ loading: false, error: messageError(error) });
    } finally {
      this.patch({ retrying: false });
    }
  }
  private async refreshRecords() {
    const presenceRevision = this.presenceRevision;
    const [sessionRows, machineRows] = await Promise.all([
      this.fetchSessions(),
      this.request('/v1/machines'),
    ]);
    const seen = new Set<string>();
    for (const row of sessionRows) {
      seen.add(row.id);
      await this.upsertSession(row, presenceRevision);
    }
    for (const id of this.sessions.keys())
      if (!seen.has(id)) {
        this.sessions.delete(id);
        this.messages.delete(id);
      }
    const machines = Array.isArray(machineRows) ? machineRows : machineRows.machines;
    if (!Array.isArray(machines))
      throw new Error('The Happy server returned an invalid computer list.');
    const machineIds = new Set<string>();
    for (const wire of machines) {
      machineIds.add(wire.id);
      const previous = this.machines.get(wire.id);
      if (previous && previous.wire.metadataVersion > wire.metadataVersion) continue;
      const key = await this.encryption.unwrapKey(wire.dataEncryptionKey);
      const metadata = await this.encryption.decrypt<Json>(wire.metadata, key);
      this.assertAlive();
      const current = this.machines.get(wire.id);
      const preservePresence = current && (this.machinePresence.get(wire.id) || 0) > presenceRevision;
      this.machines.set(wire.id, {
        wire: preservePresence ? { ...wire, active: current.wire.active, activeAt: current.wire.activeAt } : wire,
        key, metadata,
      });
    }
    for (const id of this.machines.keys()) if (!machineIds.has(id)) this.machines.delete(id);
    this.publish();
    this.patch({ loading: false, error: '' });
    await this.flushCache();
    if (!this.attentionInitialized) {
      this.attentionInitialized = true;
      try { this.writeLocal('attentionInitialized', 'true'); } catch { /* Keep the baseline for this visit. */ }
    }
    const pending = [...this.sessions.keys()].filter((id) => {
      const state = this.sessionAttention(id);
      return state.inspectedSeq < 0 || (this.getSession(id).wire.seq || 0) > state.inspectedSeq;
    });
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length && !this.disposed) {
        const id = pending.shift()!;
        await this.inspectAttention(id).catch((error) => {
          if (!this.disposed) this.patch({ error: messageError(error) });
        });
      }
    }));
  }
  private inspectAttention(id: string): Promise<void> {
    const existing = this.attentionRequests.get(id);
    if (existing) return existing;
    const request = this.fetchAttention(id).finally(() => this.attentionRequests.delete(id));
    this.attentionRequests.set(id, request);
    return request;
  }
  private async fetchAttention(id: string) {
    const source = this.getSession(id);
    const previous = this.sessionAttention(id);
    const boundary = previous.inspectedSeq;
    let head = source.wire.seq || 0;
    const needAssistant = head > previous.readSeq;
    let foundUser = false, foundAssistant = false;
    let cursor = 2147483647;
    while (!this.disposed && this.sessions.has(id)) {
      const result = await this.request(`/v3/sessions/${encodeURIComponent(id)}/messages?before_seq=${cursor}&limit=100`);
      if (!Array.isArray(result.messages)) throw new Error('Could not read session activity.');
      let reachedBoundary = false;
      let next = cursor;
      for (const wire of result.messages) {
        if (!Number.isSafeInteger(wire.seq) || wire.seq < 0) continue;
        next = Math.min(next, wire.seq);
        head = Math.max(head, wire.seq);
        if (wire.seq <= boundary) { reachedBoundary = true; continue; }
        const row = await this.decryptMessage(source, wire);
        if (this.disposed || !this.sessions.has(id)) return;
        const kind = attentionMessage(row);
        foundUser ||= kind === 'user';
        foundAssistant ||= kind === 'assistant';
        this.attention.set(id, receiveAttention(this.sessionAttention(id), row));
      }
      if (!result.hasMore || reachedBoundary || (foundUser && (foundAssistant || !needAssistant))) break;
      if (next >= cursor) throw new Error('The session activity cursor did not advance.');
      cursor = next;
    }
    if (this.disposed || !this.sessions.has(id)) return;
    const state = this.sessionAttention(id);
    this.attention.set(id, { ...state, inspectedSeq: Math.max(state.inspectedSeq, head) });
    this.saveAttention(id);
    this.scheduleCache(id);
    this.publish(id);
  }
  private async decryptMessage(source: SessionRecord, wire: Json): Promise<MessageRecord> {
    const raw = wire.content?.t === 'encrypted'
      ? await this.encryption.decrypt<Json>(wire.content.c, source.key) : {};
    return { id: wire.id, seq: wire.seq, localId: wire.localId, createdAt: wire.createdAt, raw };
  }
  private async fetchSessions() {
    const rows: Json[] = [];
    let cursor = '';
    const seen = new Set<string>();
    while (true) {
      const result = await this.request(
        `/v2/sessions?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!Array.isArray(result.sessions))
        throw new Error('The Happy server returned an invalid session list.');
      rows.push(...result.sessions);
      if (!result.hasNext) return rows;
      if (typeof result.nextCursor !== 'string' || seen.has(result.nextCursor))
        throw new Error('The session cursor did not advance. Refresh to try again.');
      cursor = result.nextCursor;
      seen.add(cursor);
    }
  }
  private async upsertSession(wire: Json, presenceRevision: number) {
    if (this.deletedSessions.has(wire.id)) return;
    const previous = this.sessions.get(wire.id);
    const key = previous?.key ?? (await this.encryption.unwrapKey(wire.dataEncryptionKey));
    const metadata =
      previous && previous.wire.metadataVersion >= wire.metadataVersion
        ? previous.metadata
        : await this.encryption.decrypt<Json>(wire.metadata, key);
    const agentState =
      previous && previous.wire.agentStateVersion >= wire.agentStateVersion
        ? previous.agentState
        : wire.agentState
          ? await this.encryption.decrypt<Json>(wire.agentState, key)
          : {};
    this.assertAlive();
    if (this.deletedSessions.has(wire.id)) return;
    const newer = this.sessions.get(wire.id);
    const preservePresence = newer && (this.sessionPresence.get(wire.id) || 0) > presenceRevision;
    this.sessions.set(wire.id, {
      key,
      wire: {
        ...wire,
        ...(preservePresence ? { active: newer.wire.active, activeAt: newer.wire.activeAt } : {}),
        seq: Math.max(wire.seq || 0, newer?.wire.seq || 0),
        metadataVersion: Math.max(wire.metadataVersion, newer?.wire.metadataVersion ?? 0),
        agentStateVersion: Math.max(wire.agentStateVersion, newer?.wire.agentStateVersion ?? 0),
      },
      metadata:
        newer && newer.wire.metadataVersion > wire.metadataVersion ? newer.metadata : metadata,
      agentState:
        newer && newer.wire.agentStateVersion > wire.agentStateVersion
          ? newer.agentState
          : agentState,
      thinking: newer?.thinking,
    });
    this.sessionAttention(wire.id);
  }
  private async update(body: Json) {
    if (body.t === 'new-message') {
      if (!this.sessions.has(body.sid) && !this.deletedSessions.has(body.sid)) await this.refresh(true);
      if (this.sessions.has(body.sid)) {
        await this.mergeMessages(body.sid, [body.message]);
        this.publish(body.sid);
      }
      return;
    }
    if (body.t === 'update-session' && this.sessions.has(body.id)) {
      const current = this.getSession(body.id);
      for (const field of ['metadata', 'agentState'] as const)
        if (body[field]?.version > current.wire[`${field}Version`]) {
          const version = body[field].version;
          const decrypted = body[field].value
            ? await this.encryption.decrypt<Json>(body[field].value, current.key)
            : {};
          if (version > current.wire[`${field}Version`]) {
            current[field] = decrypted;
            current.wire[`${field}Version`] = version;
          }
        }
      if (typeof body.updatedAt === 'number') current.wire.updatedAt = body.updatedAt;
      if (Number.isSafeInteger(body.seq)) current.wire.seq = Math.max(current.wire.seq || 0, body.seq);
      this.publish(body.id);
      if ((current.wire.seq || 0) > this.sessionAttention(body.id).inspectedSeq)
        void this.inspectAttention(body.id).catch((error) => !this.disposed && this.patch({ error: messageError(error) }));
      return;
    }
    if (body.t === 'delete-session') {
      this.deletedSessions.add(body.sid);
      this.sessions.delete(body.sid);
      this.messages.delete(body.sid);
      this.publish();
      return;
    }
    if (
      ['new-session', 'update-machine', 'new-machine', 'delete-machine', 'update-session'].includes(
        body.t,
      )
    )
      await this.refresh(true);
  }
  private ephemeral(event: Json) {
    if (this.disposed) return;
    if (event.type === 'activity') {
      const source = this.sessions.get(event.id);
      if (!source) return;
      this.sessionPresence.set(event.id, ++this.presenceRevision);
      source.wire.active = event.active;
      source.wire.activeAt = event.activeAt;
      source.thinking = !!event.thinking;
      this.publish(event.id);
    }
    if (event.type === 'machine-activity') {
      const source = this.machines.get(event.id);
      if (!source) return;
      this.machinePresence.set(event.id, ++this.presenceRevision);
      source.wire.active = event.active;
      this.publish(undefined, event.id);
    }
  }
  private async mergeMessages(id: string, rows: Json[]) {
    const session = this.getSession(id);
    let messages = this.messages.get(id);
    if (!messages) {
      messages = new Map();
      this.messages.set(id, messages);
    }
    for (const wire of rows) {
      if (messages.has(wire.id)) continue;
      const row = await this.decryptMessage(session, wire);
      this.assertAlive();
      if (!this.sessions.has(id)) return;
      messages.set(wire.id, row);
      session.wire.seq = Math.max(session.wire.seq || 0, row.seq);
      this.attention.set(id, receiveAttention(this.sessionAttention(id), row));
    }
    this.saveAttention(id);
    this.scheduleCache(id);
  }
  watchSession(id: string) {
    this.activeSessions.add(id);
    void this.loadHistory(id).catch(() => {});
    return () => {
      this.activeSessions.delete(id);
    };
  }
  async loadHistory(
    id: string,
    direction: 'initial' | 'older' | 'forward' = 'initial',
  ): Promise<void> {
    if (this.historyRequests.has(id)) {
      await this.historyRequests.get(id);
      return this.loadHistory(id, direction);
    }
    if (direction === 'initial' && this.snapshot.histories[id]?.loaded) direction = 'forward';
    const promise = this.fetchHistory(id, direction).finally(() => this.historyRequests.delete(id));
    this.historyRequests.set(id, promise);
    return promise;
  }
  private async fetchHistory(id: string, direction: 'initial' | 'older' | 'forward') {
    await this.restoreHistory(id);
    if (this.snapshot.offline || this.disposed) return;
    if (direction === 'initial' && this.snapshot.histories[id]?.loaded) direction = 'forward';
    const previous = this.snapshot.histories[id] || {
      loading: false,
      error: '',
      hasMore: false,
      loaded: false,
    };
    const history = (value: Partial<History>) =>
      this.patch({
        histories: {
          ...this.snapshot.histories,
          [id]: { ...this.snapshot.histories[id], ...previous, ...value },
        },
      });
    history({ loading: true, error: '' });
    try {
      const stored = [...(this.messages.get(id)?.values() || [])];
      let cursor =
        direction === 'forward' && stored.length
          ? (this.historyCursors.get(id) ?? 0)
          : direction === 'older' && stored.length
            ? Math.min(...stored.map((row) => row.seq))
            : 2147483647;
      const forward = direction === 'forward' && stored.length > 0;
      while (true) {
        const result = await this.request(
          `/v3/sessions/${encodeURIComponent(id)}/messages?${forward ? 'after_seq' : 'before_seq'}=${cursor}&limit=100`,
        );
        if (!Array.isArray(result.messages)) throw new Error('Could not read the message history.');
        await this.mergeMessages(id, result.messages);
        if (direction !== 'older')
          this.historyCursors.set(
            id,
            Math.max(
              cursor === 2147483647 ? 0 : cursor,
              ...result.messages.map((row: Json) => row.seq),
            ),
          );
        this.publish(id);
        if (!forward) {
          history({ loading: false, loaded: true, hasMore: !!result.hasMore, error: '' });
          break;
        }
        const next = Math.max(cursor, ...result.messages.map((row: Json) => row.seq));
        if (!result.hasMore) {
          history({ loading: false, loaded: true, error: '' });
          break;
        }
        if (next <= cursor) throw new Error('The message cursor did not advance.');
        cursor = next;
      }
      this.scheduleCache(id);
      await this.flushCache();
    } catch (error) {
      history({ loading: false, error: this.snapshot.offline ? '' : messageError(error) });
      if (this.snapshot.offline) return;
      throw error;
    }
  }
  private async ack(event: string, payload: Json): Promise<Json> {
    this.assertAlive();
    const socket = this.socket;
    if (!socket?.connected)
      throw new Error('The realtime connection is offline. Reconnect before this action.');
    try {
      return await socket.timeout(50000).emitWithAck(event, payload);
    } catch {
      throw new Error(
        'The computer did not confirm this action. Check its status before retrying.',
      );
    }
  }
  async rpc(id: string, method: string, params: unknown, machine = false): Promise<Json> {
    const source = machine ? this.machines.get(id) : this.sessions.get(id);
    if (!source) throw new Error('The computer or session is not available.');
    const encrypted = await this.encryption.encrypt(params, source.key);
    const result = await this.ack('rpc-call', { method: `${id}:${method}`, params: encrypted });
    this.assertAlive();
    if (!result.ok) throw new Error(result.error || 'The agent refused this request.');
    const response = await this.encryption.decrypt<Json | null>(result.result, source.key, {
      allowEmpty: method === 'abort',
    });
    if (typeof response?.error === 'string') throw new Error(response.error);
    return response ?? {};
  }
  async mutateMetadata(id: string, change: (metadata: Json) => Json) {
    const source = this.getSession(id);
    let metadata = source.metadata;
    let version = source.wire.metadataVersion;
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = change({ ...metadata });
      const result = await this.ack('update-metadata', {
        sid: id,
        metadata: await this.encryption.encrypt(next, source.key),
        expectedVersion: version,
      });
      this.assertAlive();
      if (result.result === 'success') {
        const current = this.getSession(id);
        if ((result.version ?? version + 1) >= current.wire.metadataVersion) {
          current.metadata = next;
          current.wire.metadataVersion = result.version ?? version + 1;
        }
        this.publish(id);
        return;
      }
      if (
        result.result !== 'version-mismatch' ||
        typeof result.metadata !== 'string' ||
        typeof result.version !== 'number'
      )
        throw new Error('Happy refused the metadata change.');
      metadata = await this.encryption.decrypt<Json>(result.metadata, source.key);
      version = result.version;
    }
    throw new Error('The session changed at the same time. Try this action again.');
  }
  async renameSession(id: string, name: string) {
    await this.mutateMetadata(id, (metadata) => {
      if (name.trim()) metadata.name = name.trim();
      else delete metadata.name;
      return metadata;
    });
  }
  async archiveSession(id: string) {
    const source = this.getSession(id);
    if (source.metadata.bot) throw new Error('Use the Happy app to manage this bot.');
    if (isSessionArchived(source)) {
      if (!isRig(source.metadata) && !source.wire.active)
        throw new Error('This CLI session has ended. Resume it in the Happy app or use Hand Off.');
      await this.mutateMetadata(id, (metadata) => {
        delete metadata.lifecycleState;
        return metadata;
      });
      return;
    }
    await this.request(`/v1/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' });
    source.wire.active = false;
    this.publish(id);
    await this.mutateMetadata(id, (metadata) => ({ ...metadata, lifecycleState: 'archived' }));
  }
  async deleteSession(id: string) {
    const source = this.getSession(id);
    if (source.metadata.bot) throw new Error('Use the Happy app to manage this bot.');
    await this.request(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.deletedSessions.add(id);
    this.sessions.delete(id);
    this.messages.delete(id);
    this.publish();
  }
  async stopSession(id: string) {
    await this.rpc(
      id,
      'abort',
      isRig(this.getSession(id).metadata)
        ? {}
        : {
            reason:
              'The user asked to stop. Stop the current operation and wait for the next instruction.',
          },
    );
  }
  async killSession(id: string) {
    const result = await this.rpc(id, 'killSession', {});
    if (!result.success) throw new Error(result.message || 'The agent did not stop.');
    await this.refresh();
  }
  async sendMessage(
    id: string,
    content: string,
    attachments: Attachment[] = [],
    options: MessageSettings = {},
  ) {
    if (this.snapshot.offline) throw new Error('Reconnect before you send this message. Your draft stays on this device.');
    if (attachments.length)
      throw new Error('File uploads are not available in v2 yet. Use the Happy app to attach a file.');
    if (!content.trim()) return;
    if (this.sending.has(id)) throw new Error('This message is already in progress.');
    const source = this.getSession(id);
    if (!source.wire.active || source.metadata.lifecycleState === 'archived')
      throw new Error('This agent is offline or archived. Resume it in the Happy app.');
    this.sending.add(id);
    try {
      const metadata = source.metadata;
      if (options.model !== undefined && !isConcreteModel(options.model))
        throw new Error('Choose a specific model before you send.');
      if (options.permissionMode && options.permissionMode !== currentPermission(metadata)) {
        if (!canSelectPermission(metadata)) throw new Error('This session locks permission mode selection.');
        if (!permissionOptions(metadata).some((choice) => choice.value === options.permissionMode && !choice.disabled))
          throw new Error('This permission mode is no longer available. Choose a current mode before you send.');
      }
      const model = options.model || currentModel(metadata);
      const choices = modelOptions(metadata);
      if (options.model && model !== currentModel(metadata) && !canSelectModel(metadata))
        throw new Error('This session locks model selection.');
      if (isRig(metadata) && options.model && !choices.some((choice) => choice.value === model && !choice.disabled))
        throw new Error('This model is no longer available. Choose a current model before you send.');
      const levels = effortOptions(metadata, model);
      if (options.effort && !levels.includes(options.effort))
        throw new Error('This model does not support the selected effort. Choose another effort before you send.');
      const meta = messageMeta(metadata, options);
      if (options.model && model !== currentModel(metadata) && !levels.length) {
        if (isRig(metadata)) delete meta.effort;
        else meta.effort = null;
      }
      if (isRig(metadata) && options.effort === null) {
        const effort = defaultEffort(metadata, model) || levels[0];
        if (effort) meta.effort = effort;
        else delete meta.effort;
      }
      const raw = { role: 'user', content: { type: 'text', text: content.trim() }, meta };
      const fingerprint = base64(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify({ text: content.trim(), options })),
          ),
        ),
        true,
      );
      const key = this.storageKey + 'outbox.' + id;
      let packet: Outbox | null = null;
      try {
        packet = JSON.parse(sessionStorage.getItem(key) || 'null');
      } catch {
        /* A damaged packet must not be replayed. */
      }
      if (packet && packet.fingerprint !== fingerprint)
        throw new Error(
          'A previous send has no confirmation. Retry the original draft and model/effort/permission choices, or check the message in the Happy app.',
        );
      if (!packet) {
        packet = {
          fingerprint,
          localId: crypto.randomUUID(),
          content: await this.encryption.encrypt(raw, source.key),
        };
        sessionStorage.setItem(key, JSON.stringify(packet));
      }
      const result = await this.request(`/v3/sessions/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messages: [{ localId: packet.localId, content: packet.content }] }),
      });
      if (
        !Array.isArray(result.messages) ||
        !result.messages.some((row: Json) => row.localId === packet!.localId)
      )
        throw new Error('Happy did not confirm the message. Retry this same draft.');
      sessionStorage.removeItem(key);
      const rows = result.messages.map((wire: Json) => ({
        ...wire,
        content: { t: 'encrypted', c: packet!.content },
      }));
      await this.mergeMessages(id, rows);
      this.publish(id);
    } finally {
      this.sending.delete(id);
    }
  }
  async respondPermission(id: string, requestId: string, approved: boolean) {
    const key = id + ':' + requestId;
    if (this.acknowledged.has(key)) throw new Error('This request already has a reply.');
    await this.rpc(id, 'permission', {
      id: requestId,
      approved,
      decision: approved ? 'approved' : 'denied',
    });
    this.acknowledged.add(key);
    const session = this.getSession(id);
    const requests = { ...session.agentState.requests };
    delete requests[requestId];
    session.agentState = { ...session.agentState, requests };
    this.publish(id);
  }
  async answerQuestions(id: string, requestId: string, answers: Json | null, kind = 'form') {
    const key = id + ':' + requestId;
    if (this.acknowledged.has(key)) throw new Error('This request already has a reply.');
    await this.rpc(id, 'communication', {
      id: requestId,
      kind,
      status: answers ? 'answered' : 'cancelled',
      ...(answers ? { answers } : {}),
    });
    this.acknowledged.add(key);
    const session = this.getSession(id);
    const communications = { ...session.agentState.communications };
    delete communications[requestId];
    session.agentState = { ...session.agentState, communications };
    this.publish(id);
  }
  getAgentState(id: string) {
    return this.sessions.get(id)?.agentState || emptyJson;
  }
  getMetadata(id: string) {
    return this.sessions.get(id)?.metadata || emptyJson;
  }
  getMachineMetadata(id: string) {
    return this.machines.get(id)?.metadata || emptyJson;
  }
  models(id: string) {
    return modelOptions(this.getMetadata(id));
  }
  permissionModes(id: string): string[] {
    return permissionOptions(this.getMetadata(id)).filter((option) => !option.disabled).map((option) => option.value);
  }
  async bash(id: string, command: string, cwd?: string, machine = false): Promise<Json> {
    const result = await this.rpc(id, 'bash', { command, cwd, timeout: 45000 }, machine);
    if (!result.success || (typeof result.exitCode === 'number' && result.exitCode !== 0))
      throw new Error(result.error || result.stderr || 'The command failed on the computer.');
    return result;
  }
  async createSession(draft: NewSessionDraft, attachments: Attachment[] = []) {
    if (attachments.length) throw new Error('Use the Happy app to create a session with file attachments.');
    if (!this.socket?.connected) throw new Error('Reconnect before you start a session.');
    const machine = this.machines.get(draft.machineId);
    if (!machine?.wire.active) throw new Error('Choose an online computer.');
    const agent = draft.agent === 'Happy Agent' ? 'rig' : draft.agent.toLowerCase();
    const catalog = agent === 'rig' ? { ...machine.metadata, flavor: 'rig', client: { id: 'rig' } } : { flavor: agent };
    if (!permissionOptions(catalog).some((option) => option.value === draft.permissionMode && !option.disabled))
      throw new Error('Choose an available permission mode before you start a session.');
    if (!isConcreteModel(draft.model) || !modelOptions(catalog).some((option) => option.value === draft.model && !option.disabled))
      throw new Error('Choose an available model before you start a session.');
    const levels = effortOptions(catalog, draft.model);
    if (levels.length && (!draft.effort || !levels.includes(draft.effort)))
      throw new Error('Choose a supported effort before you start a session.');
    let directory = draft.path.trim().replace(/^~(?=\/|$)/, machine.metadata.homeDir || '~');
    if (!directory.startsWith('/'))
      throw new Error('Enter an absolute folder path on this computer.');
    const signature = base64(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(draft))),
      ),
      true,
    );
    const storageKey = this.storageKey + 'spawn.' + signature;
    let pending: Json = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    if (!pending.requestId) {
      pending = { requestId: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    }
    if (draft.type === 'Worktree' && !pending.directory) {
      const branch = draft.worktree.trim();
      const expanded = branch.replace(/^~(?=\/|$)/, machine.metadata.homeDir || '~');
      const reuse = expanded.startsWith('/');
      if (
        !reuse && (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) ||
        branch.includes('..') ||
        branch.endsWith('/') ||
        branch.endsWith('.lock'))
      )
        throw new Error('Use a valid Git branch name for the worktree.');
      const target = reuse ? expanded : directory.replace(/\/$/, '') + '/.dev/worktree/' + branch;
      const listing = await this.bash(
        draft.machineId,
        'git worktree list --porcelain',
        directory,
        true,
      );
      const existing = String(listing.stdout)
        .split('\n\n')
        .find((block) => block.split('\n').includes('worktree ' + target));
      if (reuse && !existing)
        throw new Error('This folder is not a registered worktree of the selected repository. Choose an existing worktree path.');
      if (existing && !reuse && !existing.split('\n').includes('branch refs/heads/' + branch))
        throw new Error('This worktree path belongs to another branch.');
      if (!existing)
        await this.bash(
          draft.machineId,
          `git worktree add -b ${shellQuote(branch)} ${shellQuote(target)}`,
          directory,
          true,
        );
      pending.directory = target;
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
    }
    directory = pending.directory || directory;
    if (!pending.sessionId) {
      if (pending.unknown && agent !== 'rig')
        throw new Error(
          'The previous start has no confirmation. Check the Happy app before you start another session with this draft.',
        );
      pending.unknown = true;
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      const params: Json = {
        type: 'spawn-in-directory',
        directory,
        agent,
        permissionMode: draft.permissionMode,
        approvedNewDirectoryCreation: false,
      };
      if (agent === 'rig') params.clientRequestId = pending.requestId;
      if (agent === 'rig') {
        const separator = draft.model.indexOf(':');
        if (separator < 1) throw new Error('Choose a model from this computer’s catalog.');
        params.providerId = draft.model.slice(0, separator);
        params.modelId = draft.model.slice(separator + 1);
      } else params.modelMode = draft.model;
      if (draft.effort) params[agent === 'rig' ? 'effort' : 'effortLevel'] = draft.effort;
      const deadline = Date.now() + 90000;
      while (true) {
        const result = await this.rpc(draft.machineId, 'spawn-happy-session', params, true);
        if (result.type === 'success' && typeof result.sessionId === 'string') {
          pending.sessionId = result.sessionId;
          sessionStorage.setItem(storageKey, JSON.stringify(pending));
          break;
        }
        if (result.type !== 'pending' || agent !== 'rig' || Date.now() >= deadline) {
          if (result.type !== 'pending') {
            pending.unknown = false;
            sessionStorage.setItem(storageKey, JSON.stringify(pending));
          }
          throw new Error(
            result.errorMessage ||
              result.message ||
              'The agent did not confirm the session. Retry to check this request.',
          );
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.max(500, Math.min(result.retryAfterMs || 1500, 3000))),
        );
        this.assertAlive();
      }
    }
    await this.refresh();
    if (!this.sessions.has(pending.sessionId))
      throw new Error(
        'The session started, but it is not in the list yet. Retry to load the same session.',
      );
    if (draft.prompt.trim()) await this.sendMessage(pending.sessionId, draft.prompt, [], {
      model: draft.model,
      effort: draft.effort,
      permissionMode: draft.permissionMode,
    });
    this.writeLocal(`composerModes.${pending.sessionId}`, JSON.stringify({
      model: draft.model,
      effort: draft.effort || null,
      permission: draft.permissionMode,
    }));
    sessionStorage.removeItem(storageKey);
    return pending.sessionId as string;
  }
  async refreshMonitor() {
    const errors: string[] = [];
    const results = await Promise.all(
      this.snapshot.machines
        .filter((machine) => machine.online)
        .map(async (machine) => {
          try {
            const start = performance.now();
            const result = await this.bash(machine.id, MACHINE_HEALTH_SCRIPT, undefined, true);
            const latency = Math.round(performance.now() - start);
            const health = parseMachineHealth(result.stdout);
            return {
              ...machine,
              battery: health.battery?.percent ?? null,
              charging:
                health.onAcPower ??
                (health.battery?.state === 'discharging'
                  ? false
                  : health.battery?.state === 'charging'
                    ? true
                    : null),
              network:
                health.network.kind === 'wifi'
                  ? 'Wi-Fi'
                  : health.network.kind === 'ethernet'
                    ? 'Ethernet'
                    : health.network.kind || 'Unknown',
              ssid: health.network.ssid || '',
              ip: health.network.tailscaleIp || health.network.ip || '',
              latency,
              capturedAt: Date.now(),
              error: '',
            };
          } catch (error) {
            errors.push(machine.name + ': ' + messageError(error));
            return { ...machine, error: messageError(error) };
          }
        }),
    );
    this.patch({
      machines: this.snapshot.machines.map(
        (machine) => results.find((result) => result.id === machine.id) || machine,
      ),
      monitorErrors: errors,
    });
    await this.refreshUsage();
  }

  refreshUsage(): Promise<void> {
    this.assertAlive();
    if (this.usageRequest) return this.usageRequest;
    this.usageRequest = this.readUsage().finally(() => { this.usageRequest = null; });
    return this.usageRequest;
  }

  private async readUsage() {
    const machines = this.snapshot.machines.filter((machine) => machine.online);
    if (!machines.length) return;
    this.patch({ usageLoading: true, usageErrors: [] });
    const errors: string[] = [];
    // Retain failed/offline readings as stale. Never write usage into v1's shared store.
    const readings = new Map(this.snapshot.usage.map((reading) => [
      `${reading.machineId}:${reading.agent}`, { ...reading, stale: true },
    ]));
    for (const machine of machines) {
      try {
        const result = await this.bash(machine.id, buildManualUsageCommand(), undefined, true);
        const parsed = parseManualUsage(result.stdout);
        for (const item of parsed.usages) {
          const reading = weeklyUsage(agentName(item.agent), item.windows, item.capturedAt);
          if (reading) readings.set(`${machine.id}:${reading.agent}`, {
            ...reading, stale: !!reading.stale, machineId: machine.id, machineName: machine.name,
          });
        }
        errors.push(
          ...parsed.errors.map(
            (error) => machine.name + ' · ' + error.agent + ': ' + error.message,
          ),
        );
      } catch (error) {
        errors.push(machine.name + ' usage: ' + messageError(error));
      }
    }
    this.patch({
      usage: [...readings.values()], usageErrors: errors,
      usageReadAt: Date.now(), usageLoading: false,
    });
  }
}
