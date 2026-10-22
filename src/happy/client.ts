import { io, type Socket } from 'socket.io-client';
import type {
  Attachment,
  DemoAdapter,
  Machine,
  MessageSettings,
  NewSessionDraft,
  RecapMode,
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
  normalizeMessage,
  pendingPermissions,
  allowsSessionScope,
  isExitPlanTool,
  markSubagents,
  WORKTREE_MARKER,
} from './normalize';
import type { History, Json, MachineRecord, MessageRecord, SessionRecord, SubagentMarks } from './normalize';
import { MACHINE_HEALTH_SCRIPT, parseMachineHealth } from './machineHealth';
import { buildManualUsageCommand, parseManualUsage } from './manualUsage';
import { compareSessionActivity } from '../data/sessionList';
import { modelOptions, effortOptions, canSelectModel, defaultEffort, isConcreteModel } from './modelOptions';
import { permissionOptions, canSelectPermission, resolveNewSessionPermission, newSessionCatalog } from './permissionOptions';
import { latestAgentMode, latestSentModes, modeBeforePlan, rankSessionModes, resolveModelChoice, type SessionModes, type SentModes } from './modelPreferences';
import { attentionMessage, receiveAttention, restoreAttention, mergeAttention, type SessionAttention } from './sessionAttention';
import { OfflineCache, type CachedHistory, type CachedWorkspace } from './offlineCache';
import { shallowEqual } from '../data/subscriptions';
import { imageMime, transferUrl, validateImages } from './attachments';
import { resumeUnavailable } from './resume';
import { RECAP_REQUEST } from './systemPrompt';
import type { Message } from '../data/types';

const emptyJson: Json = Object.freeze({});
// Happy CLI handlers for these methods return void, so a successful reply is an empty plaintext.
const voidRpcMethods = new Set(['abort', 'switch', 'permission']);
// An incremental session read starts this far before the newest server update
// that the client has seen, so a late commit with an older timestamp is not lost.
const SESSION_CHANGE_OVERLAP = 30000;
// Happy Web sync/persistence.ts keeps the last local send time of each session for older CLIs.
const readSentTimes = (value: string | null) => {
  try {
    return new Map(Object.entries(record(JSON.parse(value || '{}')))
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1])));
  } catch { return new Map<string, number>(); }
};

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
import { DirectoryApprovalError, messageError } from './errors';
export { messageError } from './errors';
export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
// The recap mode and style change only the instructions. They are not part of a message fingerprint.
export type SendSettings = MessageSettings & { recapMode?: RecapMode; recapStyle?: string };
// recap marks a hidden recap request. The user cannot see or retry its draft.
type Outbox = { fingerprint: string; localId: string; content: string; files?: { localId: string; content: string }[]; recap?: true };

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
  private resuming = new Map<string, Promise<void>>();
  private branching = new Map<string, Promise<string>>();
  private acknowledged = new Set<string>();
  private attention = new Map<string, SessionAttention>();
  // Subagent bounds from every row that this client read, so attention can place rows that arrive later.
  private subagentBounds = new Map<string, SubagentMarks>();
  private attentionRequests = new Map<string, Promise<void>>();
  private sentModeRequests = new Map<string, Promise<SentModes | undefined>>();
  private readingSessions = new Set<string>();
  private attentionInitialized = false;
  private refreshRequest: Promise<void> | null = null;
  private sessionsChangedAt = 0;
  private fullRefresh = false;
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
  private sentTimes = new Map<string, number>();
  // A cache restore is not a server read. This turns true after the first readable server read;
  // until then the cache keeps its restored copy and saved time.
  private serverRead = false;
  readonly storageKey: string;
  private constructor(
    readonly credentials: Credentials,
    readonly encryption: HappyCrypto,
    scope: string,
  ) {
    this.storageKey = `rayno.account.${scope}.`;
    this.cache = new OfflineCache(this.storageKey, encryption);
    if (globalThis.navigator?.onLine === false)
      this.snapshot = { ...this.snapshot, offline: true, connection: 'disconnected', loading: false };
    this.storage = localStorage.getItem('rayno.credentials') ? localStorage : sessionStorage;
    this.attentionInitialized = this.readLocal('attentionInitialized') === 'true';
    this.sentTimes = readSentTimes(this.readLocal('lastMessageSentAt'));
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
            this.sentTimes.get(id),
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
    // One unreadable record does not discard the other cached records.
    const keyed = async <T extends { wire: Json }>(rows: T[]) => (await Promise.all(rows.map(async (source) => {
      try { return { ...source, key: await this.encryption.unwrapKey(source.wire.dataEncryptionKey) }; } catch { return undefined; }
    }))).filter((source) => source !== undefined);
    try {
      const sessions = await keyed(cached.sessions);
      const machines = await keyed(cached.machines);
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
    // Until a readable server read, a save would only stamp the restored copy with a new time.
    if (this.cacheTimer !== undefined || !this.serverRead) return;
    this.cacheTimer = window.setTimeout(() => { void this.flushCache(); }, 500);
  }
  private flushCache() {
    window.clearTimeout(this.cacheTimer);
    this.cacheTimer = undefined;
    if (!this.cacheDirty || this.cacheDisabled || !this.serverRead) return this.cacheWrite;
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
    this.boundsFor(id, cached.messages);
    this.historyCursors.set(id, Math.max(this.historyCursors.get(id) || 0, cached.cursor));
    this.patch({ histories: { ...this.snapshot.histories, [id]: { ...cached.history, loading: false, error: '' } } });
    this.publish(id);
  }
  private assertAlive() {
    if (this.disposed) throw new Error('This Rayno connection is closed.');
  }
  private getSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('The session is not available. Refresh the session list.');
    return session;
  }
  private boundsFor(id: string, rows: Iterable<MessageRecord> = []) {
    let marks = this.subagentBounds.get(id);
    if (!marks) this.subagentBounds.set(id, marks = markSubagents(new Map(), this.messages.get(id)?.values() || []));
    return markSubagents(marks, rows);
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
  private saveSentTime(id: string, time?: number) {
    const times = readSentTimes(this.readLocal('lastMessageSentAt'));
    for (const [key, value] of this.sentTimes) times.set(key, Math.max(value, times.get(key) || 0));
    if (time === undefined) times.delete(id);
    else times.set(id, time);
    this.sentTimes = times;
    try { this.writeLocal('lastMessageSentAt', JSON.stringify(Object.fromEntries(times))); } catch { /* Keep the time for this visit. */ }
  }
  setSessionReading(id: string, reading: boolean) {
    if (this.disposed) return;
    if (reading) this.readingSessions.add(id);
    else this.readingSessions.delete(id);
    if (!reading || document.visibilityState !== 'visible' || !document.hasFocus() || !this.sessions.has(id)) return;
    const state = this.sessionAttention(id);
    if (state.assistantSeq <= state.readSeq) return;
    let readSeq = state.readSeq;
    const marks = this.boundsFor(id);
    for (const row of this.messages.get(id)?.values() || [])
      if (attentionMessage(row, marks) === 'assistant') readSeq = Math.max(readSeq, row.seq);
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
          error: 'Happy authorization expired. Sign in to Rayno again.',
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
      void this.refresh(this.fullRefresh)
        .then(() =>
          Promise.allSettled([...this.activeSessions].map((id) => this.loadHistory(id, 'forward'))),
        )
        .catch((error) => this.patch({ error: messageError(error) }));
    });
    this.socket.on('disconnect', () => {
      // The socket can miss a delete-session update while it is down.
      this.fullRefresh = true;
      this.patch({ connection: 'disconnected' });
    });
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
          .then(() => Promise.allSettled([...this.activeSessions].map((id) => this.loadHistory(id, 'forward'))))
          .catch((error) => this.patch({ error: messageError(error) }));
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === this.storageKey + 'lastMessageSentAt') {
        this.sentTimes = readSentTimes(event.newValue);
        this.publish();
        return;
      }
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
    this.subagentBounds.clear();
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
    // Read every session on the first load, after a disconnect, and on a manual
    // retry. Other refreshes read only the sessions that changed. A complete
    // list is large because each session row carries its encrypted metadata.
    const full = this.fullRefresh || !this.sessionsChangedAt;
    this.fullRefresh = false;
    this.refreshRequest = this.refreshRecords(full)
      .catch((error) => {
        if (full) this.fullRefresh = true;
        throw error;
      })
      .finally(() => {
        this.refreshRequest = null;
      });
    return this.refreshRequest;
  }
  async retry() {
    if (this.snapshot.offline || this.disposed) return;
    this.fullRefresh = true;
    this.patch({ retrying: true, error: '', connectionError: '' });
    if (!this.socket?.connected) this.socket?.connect();
    try {
      await this.refresh();
      await Promise.allSettled([...this.activeSessions].map((id) => this.loadHistory(id, 'forward')));
    } catch (error) {
      this.patch({ loading: false, error: messageError(error) });
    } finally {
      this.patch({ retrying: false });
    }
  }
  private async refreshRecords(full: boolean) {
    const presenceRevision = this.presenceRevision;
    const [sessionRows, machineRows] = await Promise.all([
      this.fetchSessions(full ? 0 : Math.max(1, this.sessionsChangedAt - SESSION_CHANGE_OVERLAP)),
      this.request('/v1/machines'),
    ]);
    const seen = new Set<string>();
    let changedAt = this.sessionsChangedAt;
    // One damaged record must not hide the others. A known copy stays until a readable version arrives.
    const known = this.sessions.size + this.machines.size;
    let readable = 0, readableSessions = 0, failure: unknown;
    for (const row of sessionRows) {
      seen.add(row.id);
      if (Number.isSafeInteger(row.updatedAt)) changedAt = Math.max(changedAt, row.updatedAt);
      try {
        await this.upsertSession(row, presenceRevision);
        readable++;
        readableSessions++;
      } catch (error) {
        this.assertAlive();
        failure ??= error;
      }
    }
    // Only a complete list shows which sessions the server no longer has.
    if (full)
      for (const id of this.sessions.keys())
        if (!seen.has(id)) {
          this.sessions.delete(id);
          this.messages.delete(id);
          this.subagentBounds.delete(id);
        }
    const machines = Array.isArray(machineRows) ? machineRows : machineRows.machines;
    if (!Array.isArray(machines))
      throw new Error('The Happy server returned an invalid computer list.');
    const machineIds = new Set<string>();
    for (const wire of machines) {
      machineIds.add(wire.id);
      const previous = this.machines.get(wire.id);
      if (previous && previous.wire.metadataVersion > wire.metadataVersion) {
        readable++;
        continue;
      }
      let key: Uint8Array | null, metadata: Json;
      try {
        key = await this.encryption.unwrapKey(wire.dataEncryptionKey);
        metadata = await this.encryption.decrypt<Json>(wire.metadata, key);
      } catch (error) {
        this.assertAlive();
        failure ??= error;
        continue;
      }
      this.assertAlive();
      readable++;
      const current = this.machines.get(wire.id);
      const preservePresence = current && (this.machinePresence.get(wire.id) || 0) > presenceRevision;
      this.machines.set(wire.id, {
        wire: preservePresence ? { ...wire, active: current.wire.active, activeAt: current.wire.activeAt } : wire,
        key, metadata,
      });
    }
    for (const id of this.machines.keys()) if (!machineIds.has(id)) this.machines.delete(id);
    // A first read where nothing decrypts, or no session decrypts, keeps the workspace error visible.
    // Records from the offline cache do not count: the stale cache keeps its saved time.
    const firstRead = !known || !this.serverRead;
    if (failure && firstRead && (!readable || (sessionRows.length && !readableSessions))) throw failure;
    this.serverRead = true;
    this.sessionsChangedAt = changedAt;
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
        await this.inspectAttention(id).catch(() => {
          // Keep the last attention state; a background scan is not a workspace connection failure.
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
    // The first page needs only the new messages and the boundary message.
    let limit = boundary >= 0 ? Math.min(100, Math.max(2, head - boundary + 1)) : 100;
    while (!this.disposed && this.sessions.has(id)) {
      const result = await this.request(`/v3/sessions/${encodeURIComponent(id)}/messages?before_seq=${cursor}&limit=${limit}`);
      limit = 100;
      if (!Array.isArray(result.messages)) throw new Error('Could not read session activity.');
      let reachedBoundary = false;
      let next = cursor;
      const rows: MessageRecord[] = [];
      for (const wire of result.messages) {
        if (!Number.isSafeInteger(wire.seq) || wire.seq < 0) continue;
        next = Math.min(next, wire.seq);
        head = Math.max(head, wire.seq);
        if (wire.seq <= boundary) { reachedBoundary = true; continue; }
        const row = await this.decryptMessage(source, wire).catch(() => undefined);
        if (this.disposed || !this.sessions.has(id)) return;
        if (row) rows.push(row);
      }
      // A subagent stop can come after its rows on a newest-first page, so read the bounds of the full page first.
      const marks = this.boundsFor(id, rows);
      for (const row of rows) {
        const kind = attentionMessage(row, marks);
        foundUser ||= kind === 'user';
        foundAssistant ||= kind === 'assistant';
        this.attention.set(id, receiveAttention(this.sessionAttention(id), row, marks));
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
  /**
   * Find the modes of the last user message that carries them.
   * Long turns push that message out of the first history page, so read older pages
   * until the message or the result that this device saved before.
   */
  findSentModes(id: string): Promise<SentModes | undefined> {
    const existing = this.sentModeRequests.get(id);
    if (existing) return existing;
    const request = this.fetchSentModes(id).finally(() => this.sentModeRequests.delete(id));
    this.sentModeRequests.set(id, request);
    return request;
  }
  private async fetchSentModes(id: string): Promise<SentModes | undefined> {
    const source = this.getSession(id);
    const key = 'sentModes.' + id;
    let saved: (SentModes & { seq: number }) | undefined;
    try {
      const value = JSON.parse(this.readLocal(key) || 'null');
      if (Number.isSafeInteger(value?.seq)) saved = value;
    } catch { /* Read the history again. */ }
    const find = (rows: MessageRecord[]) => {
      for (const row of [...rows].sort((a, b) => b.seq - a.seq)) {
        if (saved && row.seq <= saved.seq) return undefined;
        const message = normalizeMessage(row);
        if (message?.role === 'user' && message.settings)
          return { ...message.settings, sentAt: row.createdAt, seq: row.seq };
      }
      return undefined;
    };
    const stored = [...(this.messages.get(id)?.values() || [])];
    let found = find(stored);
    let cursor = stored.length ? Math.min(...stored.map((row) => row.seq)) : 2147483647;
    // Stop after 1000 messages. The composer then falls back to the reported modes.
    for (let page = 0; !found && page < 10 && !(saved && cursor <= saved.seq + 1); page++) {
      const result = await this.request(`/v3/sessions/${encodeURIComponent(id)}/messages?before_seq=${cursor}&limit=100`);
      if (!Array.isArray(result.messages)) throw new Error('Could not read the message history.');
      const rows: MessageRecord[] = [];
      let next = cursor;
      for (const wire of result.messages) {
        if (!Number.isSafeInteger(wire.seq) || wire.seq < 0 || wire.seq >= cursor) continue;
        next = Math.min(next, wire.seq);
        const row = await this.decryptMessage(source, wire).catch(() => undefined);
        if (this.disposed) return undefined;
        if (row) rows.push(row);
      }
      found = find(rows);
      if (!result.hasMore || next >= cursor) break;
      cursor = next;
    }
    if (!found) return saved;
    try { this.writeLocal(key, JSON.stringify(found)); } catch { /* Read the history again next time. */ }
    return found;
  }
  private async decryptMessage(source: SessionRecord, wire: Json): Promise<MessageRecord> {
    const raw = wire.content?.t === 'encrypted'
      ? await this.encryption.decrypt<Json>(wire.content.c, source.key) : {};
    return { id: wire.id, seq: wire.seq, localId: wire.localId, createdAt: wire.createdAt, raw };
  }
  private async fetchSessions(changedSince: number) {
    const rows: Json[] = [];
    let cursor = '';
    const seen = new Set<string>();
    while (true) {
      const result = await this.request(
        `/v2/sessions?limit=200${changedSince ? `&changedSince=${changedSince}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
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
          // A damaged value keeps the last readable one. The next refresh reads the field again.
          const decrypted = body[field].value
            ? await this.encryption.decrypt<Json>(body[field].value, current.key).catch(() => undefined)
            : {};
          if (decrypted && version > current.wire[`${field}Version`]) {
            current[field] = decrypted;
            current.wire[`${field}Version`] = version;
          }
        }
      if (typeof body.updatedAt === 'number') current.wire.updatedAt = body.updatedAt;
      if (Number.isSafeInteger(body.seq)) current.wire.seq = Math.max(current.wire.seq || 0, body.seq);
      this.publish(body.id);
      if ((current.wire.seq || 0) > this.sessionAttention(body.id).inspectedSeq)
        void this.inspectAttention(body.id).catch(() => { /* Retain the last attention state until the next scan. */ });
      return;
    }
    if (body.t === 'delete-session') {
      this.deletedSessions.add(body.sid);
      this.sessions.delete(body.sid);
      this.messages.delete(body.sid);
      this.subagentBounds.delete(body.sid);
      if (this.sentTimes.has(body.sid)) this.saveSentTime(body.sid);
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
  /**
   * A message that does not decrypt keeps its id and seq with empty content, like Happy Web.
   * A history page throws only when nothing in the session decrypts.
   */
  private async mergeMessages(id: string, rows: Json[], history = false) {
    const session = this.getSession(id);
    let messages = this.messages.get(id);
    if (!messages) {
      messages = new Map();
      this.messages.set(id, messages);
    }
    const decrypted: MessageRecord[] = [];
    let readable = messages.size > 0, failure: unknown;
    for (const wire of rows) {
      if (messages.has(wire.id)) continue;
      let row: MessageRecord;
      try {
        row = await this.decryptMessage(session, wire);
        readable = true;
      } catch (error) {
        failure ??= error;
        row = { id: wire.id, seq: wire.seq, localId: wire.localId, createdAt: wire.createdAt, raw: {} };
      }
      this.assertAlive();
      if (!this.sessions.has(id)) return;
      decrypted.push(row);
    }
    if (history && failure && !readable) throw failure;
    const added = decrypted.filter((row) => !messages.has(row.id) && !!messages.set(row.id, row));
    const marks = this.boundsFor(id, added);
    for (const row of added) {
      session.wire.seq = Math.max(session.wire.seq || 0, row.seq);
      this.attention.set(id, receiveAttention(this.sessionAttention(id), row, marks));
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
          [id]: { ...this.snapshot.histories[id], ...previous, ...value, direction },
        },
      });
    history({ loading: true, error: '', direction });
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
        await this.mergeMessages(id, result.messages, true);
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
      allowEmpty: voidRpcMethods.has(method),
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
    if (isSessionArchived(source)) {
      // Happy Web has no bot restore, and the bot's agent owns its metadata.
      if (source.metadata.bot) throw new Error('Use the Happy app to restore this bot.');
      if (!isRig(source.metadata) && !source.wire.active)
        throw new Error('This CLI session has ended. Resume this session before you restore it.');
      await this.mutateMetadata(id, (metadata) => {
        delete metadata.lifecycleState;
        return metadata;
      });
      return;
    }
    if (source.metadata.bot) {
      // Happy Web archives a bot only through its agent. A server archive would end its one conversation.
      const result: Json = await this.rpc(id, 'killSession', {}).catch((error) => ({ success: false, message: messageError(error) }));
      if (result.success !== true)
        throw new Error(typeof result.message === 'string' && result.message ? result.message : 'Connect to the bot’s computer to archive it.');
      const current = this.sessions.get(id);
      if (current) current.wire.active = false;
      this.publish(id);
      return;
    }
    // Happy Web stops the agent first. The CLI kill handler writes the archived lifecycle itself.
    // The server archive is the fallback when the agent does not answer; it only ends the connection.
    const online = source.wire.active || this.machines.get(source.metadata.machineId)?.wire.active;
    const killed = online && await this.rpc(id, 'killSession', {}).then((result) => result.success === true, () => false);
    if (!killed) await this.request(`/v1/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' });
    const current = this.sessions.get(id);
    if (current) current.wire.active = false;
    this.publish(id);
    // An inactive Rig session stays in the live list without the marker.
    if (isRig(source.metadata)) await this.mutateMetadata(id, (metadata) => ({ ...metadata, lifecycleState: 'archived' }));
  }
  async deleteSession(id: string) {
    const source = this.getSession(id);
    if (source.metadata.bot) throw new Error('Archive the bot instead of deleting its conversation.');
    // Happy Web stops a connected agent before the delete. A failed stop does not block the delete.
    if (source.wire.active) await this.rpc(id, 'killSession', {}).catch(() => undefined);
    await this.request(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.deletedSessions.add(id);
    this.sessions.delete(id);
    this.messages.delete(id);
    this.subagentBounds.delete(id);
    this.saveSentTime(id);
    this.publish();
  }
  /**
   * Happy Web hooks/useWorktreeCleanup.ts: before an archive or a delete, offer to remove a Happy worktree
   * that has no uncommitted changes and no other connected session. Returns the path to offer, or ''.
   */
  async worktreeCleanup(id: string): Promise<string> {
    const { metadata } = this.getSession(id);
    const path = typeof metadata.path === 'string' ? metadata.path : '', machineId = metadata.machineId;
    if (metadata.bot || !path.includes(WORKTREE_MARKER) || !this.machines.get(machineId)?.wire.active) return '';
    if ([...this.sessions.values()].some((other) => other.wire.id !== id && other.wire.active && other.metadata.path === path)) return '';
    // A failed check (not a repository or an offline computer) and uncommitted changes skip the offer.
    const status = await this.bash(machineId, 'git status --porcelain', path, true).catch(() => undefined);
    return status && typeof status.stdout === 'string' && !status.stdout.trim() ? path : '';
  }
  async removeWorktree(id: string, path: string) {
    const machineId = this.getSession(id).metadata.machineId, index = path.indexOf(WORKTREE_MARKER);
    if (index < 1) throw new Error('This folder is not a Happy worktree.');
    await this.bash(machineId, `git worktree remove ${shellQuote(path)} --force`, path.slice(0, index), true);
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
  sendMessage(id: string, content: string, attachments: Attachment[] = [], options: SendSettings = {}) {
    return this.send(id, content, attachments, options);
  }
  /** Ask the agent to recap its previous reply. The chat hides this message. */
  sendRecapRequest(id: string, options: SendSettings = {}) {
    return this.send(id, RECAP_REQUEST, [], options, { raynoRecap: true, displayText: 'Recap' });
  }
  private async send(
    id: string,
    content: string,
    attachments: Attachment[],
    { recapMode, recapStyle, ...options }: SendSettings,
    extraMeta: Json = {},
  ) {
    if (this.snapshot.offline) throw new Error('Reconnect before you send this message. Your draft stays on this device.');
    validateImages(attachments);
    if (!content.trim() && !attachments.length) return;
    if (this.sending.has(id)) throw new Error('This message is already in progress.');
    const source = this.getSession(id);
    if (!source.wire.active || source.metadata.lifecycleState === 'archived')
      throw new Error('Resume this session before you send a message.');
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
      const meta = { ...messageMeta(metadata, options, recapMode, recapStyle), ...extraMeta };
      if (options.model && model !== currentModel(metadata) && !levels.length) {
        if (isRig(metadata)) delete meta.effort;
        else meta.effort = null;
      }
      if (isRig(metadata) && options.effort === null) {
        const effort = defaultEffort(metadata, model) || levels[0];
        if (effort) meta.effort = effort;
        else delete meta.effort;
      }
      if (attachments.length && isRig(metadata)) throw new Error('Images are available for Claude and Codex sessions.');
      const imageHashes = await Promise.all(attachments.map(async file => base64(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.file!.arrayBuffer())), true)));
      const raw = { role: 'user', content: { type: 'text', text: content.trim() }, meta };
      const fingerprint = base64(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify({ text: content.trim(), options, ...(attachments.length ? { imageHashes } : {}) })),
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
      // Drop an unconfirmed recap request when a different send comes next. A lost recap is safe to ask again.
      if (packet?.recap && packet.fingerprint !== fingerprint) {
        sessionStorage.removeItem(key);
        packet = null;
      }
      if (packet && packet.fingerprint !== fingerprint)
        throw new Error(
          'A previous send has no confirmation. Retry the original draft and model/effort/permission choices, or check the message in the Happy app.',
        );
      if (!packet) {
        const files: { localId: string; content: string }[] = [];
        for (const attachment of attachments) {
          const ref = await this.uploadImage(id, attachment);
          const rawFile = { role: 'session', content: { type: 'session', data: {
            id: crypto.randomUUID(), time: Date.now(), role: 'user', ev: {
              t: 'file', ref, name: attachment.name, size: attachment.size,
            },
          } } };
          files.push({ localId: crypto.randomUUID(), content: await this.encryption.encrypt(rawFile, source.key) });
        }
        packet = {
          fingerprint,
          localId: crypto.randomUUID(),
          content: await this.encryption.encrypt(raw, source.key), files,
          ...(extraMeta.raynoRecap === true ? { recap: true as const } : {}),
        };
        sessionStorage.setItem(key, JSON.stringify(packet));
      }
      const packets = [...(packet.files || []), { localId: packet.localId, content: packet.content }];
      const result = await this.request(`/v3/sessions/${encodeURIComponent(id)}/messages`, {
        method: 'POST', body: JSON.stringify({ messages: packets }),
      });
      if (
        !Array.isArray(result.messages) ||
        !packets.every(item => result.messages.some((row: Json) => row.localId === item.localId))
      )
        throw new Error('Happy did not confirm the message. Retry this same draft.');
      sessionStorage.removeItem(key);
      this.saveSentTime(id, Date.now());
      const rows = result.messages.map((wire: Json) => ({
        ...wire,
        content: { t: 'encrypted', c: packets.find(item => item.localId === wire.localId)!.content },
      }));
      await this.mergeMessages(id, rows);
      this.publish(id);
    } finally {
      this.sending.delete(id);
    }
  }
  private async transfer(value: string, init: RequestInit) {
    const url = transferUrl(value, this.credentials.server);
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const headers = new Headers(init.headers);
      if (url.origin === new URL(this.credentials.server).origin) headers.set('Authorization', `Bearer ${this.credentials.token}`);
      const response = await fetch(url, { ...init, headers, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      this.assertAlive();
      if (!response.ok) throw new Error(`Image transfer failed (${response.status}). Retry with your images still attached.`);
      return response;
    } finally { window.clearTimeout(timer); this.controllers.delete(controller); }
  }
  private async uploadImage(id: string, attachment: Attachment) {
    const encrypted = await this.encryption.encryptBlob(new Uint8Array(await attachment.file!.arrayBuffer()), this.getSession(id).key);
    const upload = await this.request(`/v1/sessions/${encodeURIComponent(id)}/attachments/request-upload`, {
      method: 'POST', body: JSON.stringify({ filename: attachment.name, size: encrypted.length }),
    });
    if (typeof upload.ref !== 'string' || typeof upload.uploadUrl !== 'string') throw new Error('The image server returned an invalid upload request.');
    if (upload.method === 'POST') {
      const form = new FormData();
      for (const [name, value] of Object.entries(record(upload.formFields))) {
        if (typeof value !== 'string') throw new Error('The image upload policy is invalid.');
        form.append(name, value);
      }
      form.append('file', new Blob([encrypted as BlobPart], { type: 'application/octet-stream' }), 'blob');
      await this.transfer(upload.uploadUrl, { method: 'POST', body: form });
    } else if (!upload.method || upload.method === 'PUT') {
      await this.transfer(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: encrypted as BodyInit });
    } else throw new Error('This image upload method is not supported.');
    return upload.ref as string;
  }
  async loadImage(id: string, ref: string): Promise<Blob> {
    const source = this.getSession(id);
    const cached = await this.cache.image(id, ref);
    this.assertAlive();
    if (cached) {
      try {
        const bytes = await this.encryption.decryptBlob(unbase64(cached), source.key);
        this.assertAlive();
        return new Blob([bytes as BlobPart], { type: imageMime(bytes) });
      } catch { /* A damaged cached image can be fetched again while online. */ }
    }
    if (this.snapshot.offline) throw new Error('This image is not saved on this device. Open it once while online.');
    const result = await this.request(`/v1/sessions/${encodeURIComponent(id)}/attachments/request-download`, {
      method: 'POST', body: JSON.stringify({ ref }),
    });
    if (typeof result.downloadUrl !== 'string') throw new Error('The image server returned an invalid download request.');
    const response = await this.transfer(result.downloadUrl, {});
    const encrypted = new Uint8Array(await response.arrayBuffer());
    const bytes = await this.encryption.decryptBlob(encrypted, source.key);
    const type = imageMime(bytes);
    this.assertAlive();
    this.cacheWrite = this.cacheWrite.then(async () => {
      if (!this.disposed && !this.cacheDisabled) await this.cache.saveImage(id, ref, encrypted);
    });
    await this.cacheWrite;
    this.assertAlive();
    return new Blob([bytes as BlobPart], { type });
  }
  branchUnavailable(id: string) {
    const metadata = this.getSession(id).metadata;
    if (isRig(metadata) || metadata.bot || metadata.capabilities?.fork === false || !['claude', 'codex'].includes(metadata.flavor || 'claude'))
      return 'This agent cannot fork or duplicate conversations.';
    if (!metadata.machineId || !metadata.path) return 'The original computer and workspace are required.';
    if (!(metadata.flavor === 'codex' ? metadata.codexThreadId : metadata.claudeSessionId))
      return 'The original provider conversation ID is unavailable.';
    if (!this.machines.get(metadata.machineId)?.wire.active) return 'Bring the original computer online first.';
    return '';
  }
  async rewindPoints(id: string): Promise<{ id: string; text: string; timestamp: number }[]> {
    const reason = this.branchUnavailable(id);
    if (reason) throw new Error(reason);
    const metadata = this.getSession(id).metadata;
    const codex = metadata.flavor === 'codex';
    const result = await this.rpc(metadata.machineId, codex ? 'codex-list-rewind-points' : 'claude-list-rewind-points', {
      directory: metadata.path, [codex ? 'codexThreadId' : 'claudeSessionId']: codex ? metadata.codexThreadId : metadata.claudeSessionId,
    }, true);
    if (result.type !== 'success' || !Array.isArray(result.points)) throw new Error(result.errorMessage || 'This Happy CLI could not read the conversation history.');
    return result.points.flatMap((point: Json) => {
      const key = codex ? point.itemId : point.uuid;
      const text = typeof point.text === 'string' ? point.text : 'Message';
      // Show a hidden recap request with the same label as its chat display text.
      return typeof key === 'string' && key ? [{ id: key, text: text.trim() === RECAP_REQUEST ? 'Recap' : text, timestamp: Number(point.timestamp) || 0 }] : [];
    }).reverse();
  }
  // Rejects with DirectoryApprovalError until the user approves a missing folder. The retry keeps the copied conversation.
  branchSession(id: string, kind: 'fork' | 'duplicate', point: string | undefined, options: MessageSettings,
    approvedNewDirectoryCreation = false): Promise<string> {
    const key = JSON.stringify([id, kind, point]);
    const existing = this.branching.get(key);
    if (existing) return existing;
    const pending = this.performBranch(id, kind, point, options, approvedNewDirectoryCreation).finally(() => this.branching.delete(key));
    this.branching.set(key, pending);
    return pending;
  }
  // A cancelled folder question drops the copied conversation, so a later branch makes a new copy.
  discardBranch(id: string, kind: 'fork' | 'duplicate', point?: string) {
    const key = JSON.stringify([id, kind, point]), storageKey = this.storageKey + 'branch.' + key;
    let pending: Json = {};
    try { pending = record(JSON.parse(sessionStorage.getItem(storageKey) || '{}')); } catch { /* Remove a damaged marker. */ }
    if (this.branching.has(key) || pending.spawnUnknown || pending.sessionId) return;
    sessionStorage.removeItem(storageKey);
  }
  private async performBranch(id: string, kind: 'fork' | 'duplicate', point: string | undefined, options: MessageSettings,
    approvedNewDirectoryCreation: boolean): Promise<string> {
    if (this.snapshot.connection !== 'connected' || this.snapshot.offline) throw new Error('Reconnect before you create a session.');
    const reason = this.branchUnavailable(id);
    if (reason) throw new Error(reason);
    if (kind === 'duplicate' && !point) throw new Error('Choose a message to duplicate from.');
    const metadata = this.getSession(id).metadata;
    const machineId = metadata.machineId, directory = metadata.path, codex = metadata.flavor === 'codex';
    const choice = resolveModelChoice(metadata, [options]);
    if (!choice.model) throw new Error('No model is available for this session.');
    const permissionMode = resolveNewSessionPermission(metadata, [options.permissionMode, currentPermission(metadata)]);
    const storageKey = this.storageKey + 'branch.' + JSON.stringify([id, kind, point]);
    let pending: Json = {};
    try { pending = record(JSON.parse(sessionStorage.getItem(storageKey) || '{}')); } catch { /* Ignore a damaged local marker. */ }
    const save = () => sessionStorage.setItem(storageKey, JSON.stringify(pending));
    if (!pending.providerId) {
      if (pending.copyUnknown) throw new Error('The previous copy has no confirmation. Check your sessions before you retry.');
      pending = { copyUnknown: true, model: choice.model, effort: choice.effort, permissionMode };
      save();
      const params: Json = { directory, [codex ? 'codexThreadId' : 'claudeSessionId']: codex ? metadata.codexThreadId : metadata.claudeSessionId };
      if (kind === 'duplicate') params[codex ? 'cutAfterItemId' : 'cutAfterUuid'] = point;
      const result = await this.rpc(machineId, codex ? kind === 'fork' ? 'codex-fork-thread' : 'codex-duplicate-thread' : kind === 'fork' ? 'claude-fork-session' : 'claude-duplicate-session', params, true);
      if (result.type !== 'success') {
        sessionStorage.removeItem(storageKey);
        throw new Error(result.errorMessage || 'This Happy CLI could not copy the conversation.');
      }
      pending.providerId = result[codex ? 'newCodexThreadId' : 'newClaudeSessionId'];
      if (typeof pending.providerId !== 'string' || !pending.providerId) throw new Error('The agent did not return the copied conversation ID. Check your sessions before you retry.');
      pending.copyUnknown = false; save();
    }
    if (pending.spawnUnknown && !pending.sessionId) {
      await this.refresh();
      const found = [...this.sessions.values()].find(source => source.metadata.parentSessionId === id && source.metadata[codex ? 'codexThreadId' : 'claudeSessionId'] === pending.providerId);
      if (!found) throw new Error('The new session has no confirmation. Check the session list before you retry.');
      pending.sessionId = found.wire.id; save();
    }
    if (!pending.sessionId) {
      const levels = effortOptions(metadata, pending.model);
      if (!isConcreteModel(pending.model) || !modelOptions(metadata).some(option => !option.disabled && option.value === pending.model)
        || (levels.length && !levels.includes(pending.effort)) || !permissionOptions(metadata).some(option => !option.disabled && option.value === pending.permissionMode))
        throw new Error('The saved model or permission choice is no longer available. Check the copied conversation before you retry.');
      if (this.branchUnavailable(id) || this.getSession(id).metadata.machineId !== machineId) throw new Error('The original computer is no longer available.');
      pending.spawnUnknown = true; save();
      const result = await this.rpc(machineId, 'spawn-happy-session', {
        type: 'spawn-in-directory', directory, agent: codex ? 'codex' : 'claude', approvedNewDirectoryCreation,
        [codex ? 'resumeCodexThreadId' : 'resumeClaudeSessionId']: pending.providerId,
        parentSessionId: id, modelMode: pending.model, permissionMode: pending.permissionMode,
        ...(pending.effort ? { effortLevel: pending.effort } : {}),
      }, true);
      if (result.type !== 'success' || typeof result.sessionId !== 'string') {
        pending.spawnUnknown = false; save();
        if (result.type === 'requestToApproveDirectoryCreation')
          throw new DirectoryApprovalError(typeof result.directory === 'string' && result.directory ? result.directory : directory);
        throw new Error(result.errorMessage || 'The new session did not start. Retry to use the same copied conversation.');
      }
      pending.sessionId = result.sessionId; save();
    }
    await this.refresh();
    if (!this.sessions.has(pending.sessionId)) throw new Error('The new session is not in the list yet. Retry to load the same session.');
    this.writeLocal(`composerModes.${pending.sessionId}`, JSON.stringify({ model: pending.model, effort: pending.effort, permission: pending.permissionMode, at: Date.now() }));
    sessionStorage.removeItem(storageKey);
    return pending.sessionId;
  }
  resumeUnavailable(id: string) {
    const source = this.getSession(id);
    const machine = this.machines.get(source.metadata.machineId);
    return resumeUnavailable(source.metadata, machine?.metadata || {}, !!machine?.wire.active);
  }
  resumeSession(id: string): Promise<void> {
    const existing = this.resuming.get(id);
    if (existing) return existing;
    const pending = this.performResume(id).finally(() => this.resuming.delete(id));
    this.resuming.set(id, pending);
    return pending;
  }
  private async performResume(id: string) {
    if (this.snapshot.offline || this.snapshot.connection !== 'connected') throw new Error('Reconnect before you resume this session.');
    const source = this.getSession(id);
    const machineId = source.metadata.machineId;
    if (source.wire.active && source.metadata.lifecycleState !== 'archived') return;
    const reason = this.resumeUnavailable(id);
    if (reason) throw new Error(reason);
    let saved: SessionModes | null = null;
    try { saved = JSON.parse(this.readLocal(`composerModes.${id}`) || 'null'); } catch { /* Ignore an invalid saved choice. */ }
    const messages = this.snapshot.sessions.find(session => session.id === id)?.messages || [];
    const sent = latestSentModes(messages) || await this.findSentModes(id);
    const ranked = rankSessionModes(saved, sent, currentPermission(source.metadata),
      latestAgentMode(messages, source.agentState, source.metadata));
    const choice = resolveModelChoice(source.metadata, ranked.modelCandidates);
    if (!choice.model) throw new Error('No model is available for this session.');
    const permission = ranked.permission || currentPermission(source.metadata);
    // Recheck ownership and availability after the message lookup.
    if (this.getSession(id).metadata.machineId !== machineId || this.resumeUnavailable(id))
      throw new Error('The original computer is no longer available for recovery.');
    const result = await this.rpc(machineId, 'resume-happy-session', {
      sessionId: id, model: choice.model,
      ...(permission && permissionOptions(source.metadata).some(option => option.value === permission && !option.disabled) ? { permissionMode: permission } : {}),
      fallbackReason: source.key ? 'ok' : 'client-has-no-data-key',
      ...(source.key ? { fallback: {
        metadata: source.metadata, metadataVersion: source.wire.metadataVersion,
        agentStateVersion: source.wire.agentStateVersion, seq: source.wire.seq,
        encryptionKey: base64(source.key), encryptionVariant: 'dataKey',
      } } : {}),
    }, true);
    if (result.type !== 'success' || result.sessionId !== id) throw new Error(result.errorMessage || result.message || 'The agent did not confirm session recovery. Check its status before retrying.');
    if (source.metadata.lifecycleState === 'archived') await this.mutateMetadata(id, metadata => {
      delete metadata.lifecycleState; return metadata;
    });
    await this.refresh();
  }
  async respondPermission(id: string, requestId: string, approved: boolean, sessionScope = false, updatedInput?: Json) {
    const key = id + ':' + requestId;
    if (this.acknowledged.has(key)) throw new Error('This request already has a reply.');
    const sessionSource = this.getSession(id);
    const request = pendingPermissions(sessionSource.agentState).find(request => request.id === requestId);
    if (!request) throw new Error('This request is no longer pending.');
    const codex = sessionSource.metadata.flavor === 'codex';
    const args = record(request.arguments);
    const tool = request.tool === 'Bash' && typeof args.command === 'string' ? `Bash(${args.command})` : request.tool;
    // A plain plan approval puts Claude in default mode; return to the mode from before plan instead.
    let mode: string | undefined;
    if (approved && !codex && isExitPlanTool(request.tool)) {
      let saved: SessionModes | null = null;
      try { saved = JSON.parse(this.readLocal(`composerModes.${id}`) || 'null'); } catch { /* Ignore an invalid saved choice. */ }
      const messages = this.snapshot.sessions.find(session => session.id === id)?.messages || [];
      // A long plan turn can push the last sent message out of the loaded pages.
      const older = latestSentModes(messages) ? undefined : await this.findSentModes(id).catch(() => undefined);
      mode = modeBeforePlan(saved, messages, currentPermission(sessionSource.metadata), sessionSource.metadata, older);
    }
    await this.rpc(id, 'permission', {
      id: requestId, approved,
      decision: approved ? sessionScope && codex ? 'approved_for_session' : 'approved' : 'denied',
      ...(approved && sessionScope && !codex && allowsSessionScope(request.tool) ? { allowTools: [tool] } : {}),
      ...(mode ? { mode } : {}),
      ...(updatedInput ? { updatedInput } : {}),
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
  async createSession(draft: NewSessionDraft, attachments: Attachment[] = [], { recapMode, recapStyle, approvedNewDirectoryCreation = false }:
    { recapMode?: RecapMode; recapStyle?: string; approvedNewDirectoryCreation?: boolean } = {}) {
    validateImages(attachments);
    if (!this.socket?.connected) throw new Error('Reconnect before you start a session.');
    const machine = this.machines.get(draft.machineId);
    if (!machine?.wire.active) throw new Error('Choose an online computer.');
    const agent = draft.agent === 'Happy Agent' ? 'rig' : draft.agent.toLowerCase();
    const catalog = agent === 'rig' ? { ...machine.metadata, flavor: 'rig', client: { id: 'rig' } }
      : newSessionCatalog(agent, machine.metadata.happyCliVersion);
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
        approvedNewDirectoryCreation,
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
          if (result.type === 'requestToApproveDirectoryCreation')
            throw new DirectoryApprovalError(typeof result.directory === 'string' && result.directory ? result.directory : directory);
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
    // A refresh that started before the spawn cannot contain the new session.
    if (!this.sessions.has(pending.sessionId)) await this.refresh(true);
    if (!this.sessions.has(pending.sessionId))
      throw new Error(
        'The session started, but it is not in the list yet. Retry to load the same session.',
      );
    if (draft.prompt.trim() || attachments.length) await this.sendMessage(pending.sessionId, draft.prompt, attachments, {
      model: draft.model,
      effort: draft.effort,
      permissionMode: draft.permissionMode,
      recapMode,
      recapStyle,
    });
    this.writeLocal(`composerModes.${pending.sessionId}`, JSON.stringify({
      model: draft.model,
      effort: draft.effort || null,
      permission: draft.permissionMode,
      at: Date.now(),
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
