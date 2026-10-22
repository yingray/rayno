import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64 } from './crypto';
import { HappyClient } from './client';
import type { Json } from './normalize';
import { OfflineCache } from './offlineCache';
import { defaultNewDraft } from '../data/defaults';
import { DirectoryApprovalError } from './errors';

const transport = vi.hoisted(() => ({ socket: null as any, options: null as any }));
vi.mock('socket.io-client', () => ({
  io: (_server: string, options: unknown) => {
    transport.options = options;
    return transport.socket;
  },
}));
class MemoryStorage {
  [key: string]: any;
  getItem(key: string) {
    return Object.hasOwn(this, key) ? this[key] : null;
  }
  setItem(key: string, value: string) {
    this[key] = String(value);
  }
  removeItem(key: string) {
    delete this[key];
  }
}
class FakeSocket {
  connected = false;
  handlers = new Map<string, (event?: any) => void>();
  emit = vi.fn();
  emitWithAck = vi.fn();
  on(event: string, handler: (event?: any) => void) {
    this.handlers.set(event, handler);
    return this;
  }
  connect() {
    this.connected = true;
    return this;
  }
  disconnect() {
    this.connected = false;
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  timeout() {
    return this;
  }
}
const credentials = {
  server: 'https://happy.test',
  token: 'test-token',
  secret: base64(new Uint8Array(32).fill(7), true),
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let client: HappyClient;
let socket: FakeSocket;
let fetchMock: ReturnType<typeof vi.fn>;
let session: Json;
let metadata: Json;
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000000);
  let uuid = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () =>
      `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
  );
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    hasFocus: () => true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  socket = new FakeSocket();
  transport.socket = socket;
  client = await HappyClient.create(credentials);
  metadata = {
    path: '/real/project',
    machineId: 'computer',
    flavor: 'claude',
    summary: { text: 'Agent title' },
    unknownExtension: { keep: true },
  };
  session = {
    id: 'session',
    metadata: await client.encryption.encrypt(metadata, null),
    metadataVersion: 1,
    agentStateVersion: 0,
    agentState: null,
    active: true,
    createdAt: 100,
    updatedAt: 200,
    dataEncryptionKey: null,
  };
  fetchMock = vi.fn(async (url: string) =>
    url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines')
        ? response([])
        : response({ messages: [], hasMore: false }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  client?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function start() {
  client.start();
  await client.refresh();
}
async function wireMessage(id: string, seq: number, text: string, localId?: string) {
  return {
    id,
    seq,
    localId,
    createdAt: 200,
    content: {
      t: 'encrypted',
      c: await client.encryption.encrypt({ role: 'user', content: { type: 'text', text } }, null),
    },
  };
}
describe('Happy client protocol', () => {
  it.each(['', 'removed-mode'])('should reject permission mode %j before a worktree or session starts', async (permissionMode) => {
    // Arrange
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Test computer', homeDir: '/real' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines')
      ? response([machine]) : originalFetch(url));
    await start();
    const draft = { ...defaultNewDraft, machineId: 'computer', path: '/real/project',
      type: 'Worktree' as const, worktree: 'feature/check', prompt: 'Check this mode', permissionMode };
    // Act / Assert
    await expect(client.createSession(draft)).rejects.toThrow('Choose an available permission mode');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it.each([['1.2.0', false], ['1.2.1-beta.2', true]])('should gate Auto by the computer happyCliVersion %s', async (happyCliVersion, allowed) => {
    // Arrange
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Test computer', homeDir: '/real', happyCliVersion }, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines')
      ? response([machine]) : originalFetch(url));
    await start();
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt({ type: 'success', sessionId: 'session' }, null) });
    const draft = { ...defaultNewDraft, machineId: 'computer', path: '/real/project', permissionMode: 'auto' };
    // Act
    const created = client.createSession(draft);
    // Assert
    expect(client.getSnapshot().machines[0].cliVersion).toBe(happyCliVersion);
    if (allowed) await expect(created).resolves.toBe('session');
    else await expect(created).rejects.toThrow('Choose an available permission mode');
    expect(socket.emitWithAck).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
  it('should ask before the daemon creates a missing folder and retry the same request with approval', async () => {
    // Arrange
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Test computer', homeDir: '/real', happyCliVersion: '1.2.1' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines')
      ? response([machine]) : originalFetch(url));
    await start();
    // Wire shapes from happy-cli daemon/run.ts spawnSession and api/apiMachine.ts spawn-happy-session.
    socket.emitWithAck
      .mockResolvedValueOnce({ ok: true, result: await client.encryption.encrypt(
        { type: 'requestToApproveDirectoryCreation', directory: '/real/new-project' }, null) })
      .mockResolvedValueOnce({ ok: true, result: await client.encryption.encrypt({ type: 'success', sessionId: 'session' }, null) });
    const draft = { ...defaultNewDraft, machineId: 'computer', path: '~/new-project' };
    const pendingStarts = () => Object.keys(sessionStorage).filter((key) => key.includes('spawn.'))
      .map((key) => JSON.parse(sessionStorage.getItem(key)!));
    const spawnParams = (call: number) => client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[call][1].params, null);
    // Act
    const asked = await client.createSession(draft).catch((error) => error);
    // Assert
    expect(asked).toBeInstanceOf(DirectoryApprovalError);
    expect(asked.directory).toBe('/real/new-project');
    expect(await spawnParams(0)).toMatchObject({ type: 'spawn-in-directory', directory: '/real/new-project', approvedNewDirectoryCreation: false });
    expect(pendingStarts()).toEqual([{ requestId: expect.any(String), unknown: false }]);
    const uuids = vi.mocked(crypto.randomUUID).mock.calls.length;
    // Act
    const id = await client.createSession(draft, [], { approvedNewDirectoryCreation: true });
    // Assert
    expect(id).toBe('session');
    expect(socket.emitWithAck.mock.calls[1][1].method).toBe('computer:spawn-happy-session');
    expect(await spawnParams(1)).toMatchObject({ directory: '/real/new-project', approvedNewDirectoryCreation: true });
    expect(vi.mocked(crypto.randomUUID).mock.calls.length).toBe(uuids);
    expect(pendingStarts()).toEqual([]);
  });
  it.each([undefined, null])('should complete Stop for the CLI void reply %j', async (reply) => {
    // Arrange
    await start();
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(reply, null) });
    // Act / Assert
    await expect(client.stopSession('session')).resolves.toBeUndefined();
    expect(socket.emitWithAck).toHaveBeenCalledWith('rpc-call', expect.objectContaining({ method: 'session:abort' }));
  });
  it.each([
    ['Allow for session', { tool: 'Bash', arguments: { command: 'npm test' } }, true, true, undefined,
      { id: 'tool-1', approved: true, decision: 'approved', allowTools: ['Bash(npm test)'] }],
    ['Deny', { tool: 'Edit', arguments: { file_path: 'a.ts' } }, false, false, undefined,
      { id: 'tool-1', approved: false, decision: 'denied' }],
    ['an AskUserQuestion answer', { tool: 'AskUserQuestion', arguments: { questions: [] } }, true, false, { answers: { Q: 'A' } },
      { id: 'tool-1', approved: true, decision: 'approved', updatedInput: { answers: { Q: 'A' } } }],
  ])('should complete %s when the CLI permission handler returns void', async (_name, request, approved, scope, updatedInput, sent) => {
    // Arrange: claude/utils/permissionHandler.ts stores requests[id] = { tool, arguments, createdAt }.
    session.agentState = await client.encryption.encrypt({ requests: { 'tool-1': { ...request, createdAt: 1 } } }, null);
    await start();
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    // Act
    await client.respondPermission('session', 'tool-1', approved, scope, updatedInput);
    // Assert
    const [, payload] = socket.emitWithAck.mock.calls.find(([event]) => event === 'rpc-call')!;
    expect(payload.method).toBe('session:permission');
    expect(await client.encryption.decrypt(payload.params, null)).toEqual(sent);
    expect(client.getAgentState('session').requests).toEqual({});
  });
  it.each(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'ExitPlanMode', 'exit_plan_mode'])(
    'should not approve %s for the whole session', async (tool) => {
      // Arrange: Happy Web PermissionFooter.tsx offers no session approval for these tools.
      session.agentState = await client.encryption.encrypt({ requests: { 'tool-1': { tool, arguments: {}, createdAt: 1 } } }, null);
      await start();
      socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
      // Act
      await client.respondPermission('session', 'tool-1', true, true);
      // Assert
      const [, payload] = socket.emitWithAck.mock.calls.find(([event]) => event === 'rpc-call')!;
      expect(await client.encryption.decrypt(payload.params, null)).not.toHaveProperty('allowTools');
    });
  it('should return to the mode from before plan when the user approves ExitPlanMode', async () => {
    // Arrange: claude/utils/permissionHandler.ts applies response.mode after an approved ExitPlanMode.
    session.agentState = await client.encryption.encrypt({ requests: { toolu_2: { tool: 'ExitPlanMode', arguments: { plan: 'Plan' }, createdAt: 1 } } }, null);
    await start();
    for (const [seq, permissionMode] of [[1, 'bypassPermissions'], [2, 'plan']] as const) {
      const message = { id: `m${seq}`, seq, createdAt: 200 + seq, content: { t: 'encrypted', c: await client.encryption.encrypt(
        { role: 'user', content: { type: 'text', text: 'Go' }, meta: { sentFrom: 'web', permissionMode } }, null) } };
      socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message } });
    }
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].messages).toHaveLength(2));
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    // Act
    await client.respondPermission('session', 'toolu_2', true);
    // Assert
    const [, payload] = socket.emitWithAck.mock.calls.find(([event]) => event === 'rpc-call')!;
    expect(await client.encryption.decrypt(payload.params, null))
      .toEqual({ id: 'toolu_2', approved: true, decision: 'approved', mode: 'bypassPermissions' });
  });
  it('should read an older history page for the mode from before plan', async () => {
    // Arrange: a long plan turn pushes the last sent message out of the loaded page.
    session.agentState = await client.encryption.encrypt({ requests: { toolu_2: { tool: 'ExitPlanMode', arguments: { plan: 'Plan' }, createdAt: 1 } } }, null);
    await start();
    const exit = { id: 'm2', seq: 2, createdAt: 300, content: { t: 'encrypted', c: await client.encryption.encrypt({ role: 'session', content: {
      id: 'e2', time: 300, role: 'agent', turn: 't1', ev: { t: 'tool-call-start', call: 'toolu_2', name: 'ExitPlanMode', title: 'ExitPlanMode call', description: 'ExitPlanMode call', args: {} },
    } }, null) } };
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: exit } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].messages).toHaveLength(1));
    const sent = { id: 'm1', seq: 1, createdAt: 200, content: { t: 'encrypted', c: await client.encryption.encrypt(
      { role: 'user', content: { type: 'text', text: 'Go' }, meta: { sentFrom: 'web', permissionMode: 'bypassPermissions' } }, null) } };
    fetchMock.mockImplementation(async (url: string) => response(url.includes('/messages?before_seq=2&') ? { messages: [sent], hasMore: false } : { messages: [], hasMore: false }));
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    // Act
    await client.respondPermission('session', 'toolu_2', true);
    // Assert
    const [, payload] = socket.emitWithAck.mock.calls.find(([event]) => event === 'rpc-call')!;
    expect(await client.encryption.decrypt(payload.params, null))
      .toEqual({ id: 'toolu_2', approved: true, decision: 'approved', mode: 'bypassPermissions' });
  });
  it('should send no plan exit mode for a denial or without a mode from before plan', async () => {
    // Arrange
    session.agentState = await client.encryption.encrypt({ requests: {
      a: { tool: 'ExitPlanMode', arguments: {}, createdAt: 1 }, b: { tool: 'ExitPlanMode', arguments: {}, createdAt: 1 } } }, null);
    await start();
    client.writeLocal('composerModes.session', JSON.stringify({ permission: 'plan', at: 1 }));
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    // Act
    await client.respondPermission('session', 'a', false);
    await client.respondPermission('session', 'b', true);
    // Assert
    const sent = await Promise.all(socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call')
      .map(([, payload]) => client.encryption.decrypt(payload.params, null)));
    expect(sent).toEqual([{ id: 'a', approved: false, decision: 'denied' }, { id: 'b', approved: true, decision: 'approved' }]);
  });
  it('should reject a damaged permission reply and keep the request open', async () => {
    // Arrange
    session.agentState = await client.encryption.encrypt({ requests: { 'tool-1': { tool: 'Read', arguments: {}, createdAt: 1 } } }, null);
    await start();
    const damaged = Uint8Array.from(atob(await client.encryption.encrypt(undefined, null)), (char) => char.charCodeAt(0));
    damaged[damaged.length - 1] ^= 1;
    socket.emitWithAck.mockResolvedValue({ ok: true, result: base64(damaged) });
    // Act / Assert
    await expect(client.respondPermission('session', 'tool-1', true)).rejects.toThrow();
    expect(Object.keys(client.getAgentState('session').requests)).toEqual(['tool-1']);
  });
  it('should report an encrypted stop failure and reject empty replies for data requests', async () => {
    // Arrange
    await start();
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt({ error: 'Stop failed' }, null) });
    // Act / Assert
    await expect(client.stopSession('session')).rejects.toThrow('Stop failed');
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    await expect(client.rpc('session', 'readFile', {})).rejects.toThrow();
  });
  it('should retain message and unrelated session identities during activity and new replies', async () => {
    // Arrange
    const other = { ...session, id: 'other-session' };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session, other], hasNext: false })
      : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
    await start();
    const initial = client.getSnapshot();
    const unrelated = initial.sessions.find((row) => row.id === 'other-session');
    const current = initial.sessions.find((row) => row.id === 'session')!;
    // Act
    socket.handlers.get('ephemeral')!({ type: 'activity', id: 'session', active: true, thinking: true });
    const active = client.getSnapshot();
    // Assert
    expect(active.sessions.find((row) => row.id === 'other-session')).toBe(unrelated);
    expect(active.sessions.find((row) => row.id === 'session')!.messages).toBe(current.messages);
    expect(active.machines).toBe(initial.machines);
    // Act
    const first = await wireMessage('first', 1, 'First message');
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: first } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions.find((row) => row.id === 'session')!.messages).toHaveLength(1));
    const existing = client.getSnapshot().sessions.find((row) => row.id === 'session')!.messages[0];
    const second = await wireMessage('second', 2, 'Second message');
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: second } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions.find((row) => row.id === 'session')!.messages).toHaveLength(2));
    // Assert
    expect(client.getSnapshot().sessions.find((row) => row.id === 'session')!.messages[0]).toBe(existing);
    expect(client.getSnapshot().sessions.find((row) => row.id === 'other-session')).toBe(unrelated);
  });
  it('should open offline without a server request and keep writes unavailable', async () => {
    // Arrange
    client.dispose();
    vi.stubGlobal('navigator', { onLine: false });
    client = await HappyClient.create(credentials);
    // Act
    client.start();
    await client.refresh();
    // Assert
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({ offline: true, loading: false, error: '', connectionError: '' });
    await expect(client.sendMessage('session', 'Offline draft')).rejects.toThrow('Reconnect');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should keep a realtime failure separate from a successful workspace read until reconnect', async () => {
    // Arrange
    await start();
    expect(client.getSnapshot()).toMatchObject({ connectionError: '', error: '' });
    // Act
    socket.handlers.get('connect_error')?.();
    await client.refresh();
    // Assert
    expect(client.getSnapshot().connectionError).toContain('Try again to reconnect');
    expect(client.getSnapshot().error).toBe('');
    // Act / Assert
    socket.handlers.get('connect')?.();
    expect(client.getSnapshot().connectionError).toBe('');
    await client.refresh();
  });
  it('should retain presence events that arrive during a stale workspace refresh', async () => {
    // Arrange
    const machine = { id: 'computer', active: true, metadataVersion: 1,
      metadata: await client.encryption.encrypt({ host: 'Computer' }, null), dataEncryptionKey: null };
    const answer = async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([machine]) : response({ messages: [], hasMore: false });
    fetchMock.mockImplementation(answer);
    await start();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (url: string) => { await pending; return answer(url); });
    // Act
    const refreshing = client.refresh();
    socket.handlers.get('ephemeral')?.({ type: 'activity', id: 'session', active: false, activeAt: 999 });
    socket.handlers.get('ephemeral')?.({ type: 'machine-activity', id: 'computer', active: false, activeAt: 999 });
    release();
    await refreshing;
    // Assert
    expect(client.getSnapshot().sessions[0]).toMatchObject({ status: 'offline', archived: true });
    expect(client.getSnapshot().machines[0].online).toBe(false);
    // A later snapshot can still report a real reconnect.
    fetchMock.mockImplementation(answer);
    await client.refresh();
    expect(client.getSnapshot().sessions[0].archived).toBe(false);
    expect(client.getSnapshot().machines[0].online).toBe(true);
  });
  it('should treat a newly discovered session as unread after the first account baseline', async () => {
    // Arrange
    session.seq = 3;
    await start();
    const incoming = { id: 'reply', seq: 5, createdAt: 200, content: { t: 'encrypted',
      c: await client.encryption.encrypt({ role: 'agent', content: {
        type: 'codex', data: { type: 'message', message: 'A new session reply' },
      } }, null),
    } };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session, { ...session, id: 'new-session', seq: 5 }], hasNext: false })
      : url.includes('/v1/machines') ? response([])
        : response({ messages: url.includes('/new-session/') ? [incoming] : [], hasMore: false }));
    // Act
    socket.handlers.get('update')?.({ body: { t: 'new-message', sid: 'new-session', message: incoming } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions.find((session) => session.id === 'new-session')?.messages)
      .toMatchObject([{ id: 'reply', content: 'A new session reply' }]), { interval: 1 });
    // Assert
    expect(client.getSnapshot().sessions.find((session) => session.id === 'new-session')?.unread).toBe(true);
  });
  it('should keep hidden or unloaded replies unread and recover the cursor after a restart', async () => {
    // Arrange
    session.seq = 3;
    await start();
    const reply = async (seq: number) => ({ id: 'reply-' + seq, seq, createdAt: 200,
      content: { t: 'encrypted', c: await client.encryption.encrypt({ role: 'agent',
        content: { type: 'codex', data: { type: 'message', message: 'Reply ' + seq } },
      }, null) } });
    const incoming = await reply(4);
    // Act
    socket.handlers.get('update')?.({ body: { t: 'new-message', sid: 'session', message: incoming } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].unread).toBe(true), { interval: 1 });
    Object.assign(document, { visibilityState: 'hidden' });
    client.setSessionReading('session', true);
    // Assert
    expect(client.getSnapshot().sessions[0].unread).toBe(true);
    // Act
    Object.assign(document, { visibilityState: 'visible', hasFocus: () => false });
    client.setSessionReading('session', true);
    expect(client.getSnapshot().sessions[0].unread).toBe(true);
    Object.assign(document, { hasFocus: () => true });
    client.setSessionReading('session', true);
    expect(client.getSnapshot().sessions[0].unread).toBe(false);
    const missed = await reply(5);
    client.dispose();
    client = await HappyClient.create(credentials);
    socket = new FakeSocket();
    transport.socket = socket;
    session.seq = 5;
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.includes('/v1/machines') ? response([]) : response({ messages: [missed], hasMore: false }));
    await start();
    // Assert
    expect(client.getSnapshot().sessions[0].unread).toBe(true);
    client.setSessionReading('session', true);
    expect(client.getSnapshot().sessions[0].unread).toBe(true);
    // Act
    await client.loadHistory('session');
    client.setSessionReading('session', true);
    // Assert
    expect(client.getSnapshot().sessions[0].unread).toBe(false);
  });
  it('should read all session pages and keep account-scoped storage separate', async () => {
    // Arrange
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v1/machines')
        ? response([])
        : url.includes('cursor=')
          ? response({ sessions: [{ ...session, id: 'older' }], hasNext: false })
          : response({ sessions: [session], hasNext: true, nextCursor: 'cursor_v1_session' }),
    );
    localStorage.setItem('v1-credentials', 'keep');
    client.writeLocal('ui', 'private');
    // Act
    await start();
    client.clearLocal();
    // Assert
    expect(client.getSnapshot().sessions.map((session) => session.id)).toEqual([
      'older',
      'session',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('cursor=cursor_v1_session'))).toBe(
      true,
    );
    expect(localStorage.getItem('v1-credentials')).toBe('keep');
    expect(client.readLocal('ui')).toBeNull();
    const other = await HappyClient.create({
      ...credentials,
      secret: base64(new Uint8Array(32).fill(8), true),
    });
    expect(other.storageKey).not.toBe(client.storageKey);
    other.dispose();
  });
  it('should read only changed sessions after the first complete read', async () => {
    // Arrange
    session.updatedAt = 900000;
    const older = { ...session, id: 'older', updatedAt: 500000 };
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v1/machines')
        ? response([])
        : url.includes('/v2/sessions')
          ? response({ sessions: url.includes('changedSince=') ? [session] : [session, older], hasNext: false })
          : response({ messages: [], hasMore: false }),
    );
    await start();
    // Act
    await client.refresh();
    // Assert
    const reads = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/v2/sessions'));
    expect(reads).toHaveLength(2);
    expect(reads[0]).not.toContain('changedSince=');
    expect(reads[1]).toContain('changedSince=870000');
    expect(client.getSnapshot().sessions.map((session) => session.id).sort()).toEqual(['older', 'session']);
  });
  it('should read every session after a reconnect and remove a session that the server deleted', async () => {
    // Arrange
    const older = { ...session, id: 'older' };
    let rows = [session, older];
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v1/machines')
        ? response([])
        : url.includes('/v2/sessions')
          ? response({ sessions: url.includes('changedSince=') ? [] : rows, hasNext: false })
          : response({ messages: [], hasMore: false }),
    );
    await start();
    rows = [session];
    // Act
    await client.refresh();
    // Assert
    expect(client.getSnapshot().sessions).toHaveLength(2);
    // Act
    socket.handlers.get('disconnect')?.();
    socket.handlers.get('connect')?.();
    // Assert
    await vi.waitFor(() => expect(client.getSnapshot().sessions.map((session) => session.id)).toEqual(['session']),
      { interval: 1 });
    const reads = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/v2/sessions'));
    expect(reads.at(-1)).not.toContain('changedSince=');
  });
  it('should read only the new messages when it checks a session for unread replies', async () => {
    // Arrange
    session.seq = 3;
    await start();
    session.seq = 5;
    fetchMock.mockClear();
    // Act
    await client.refresh();
    // Assert
    const pages = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/messages?'));
    expect(pages).toEqual(['https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=3']);
  });
  it('should reuse the encrypted packet and local ID after a lost send acknowledgement', async () => {
    // Arrange
    await start();
    const packets: Json[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const packet = JSON.parse(String(init?.body)).messages[0];
      packets.push(packet);
      if (packets.length === 1) throw new TypeError('Connection lost after server commit');
      return response({
        messages: [{ id: 'sent', seq: 1, localId: packet.localId, createdAt: 200 }],
      });
    });
    // Act
    await expect(client.sendMessage('session', 'Keep this draft')).rejects.toThrow(
      'Connection lost',
    );
    await expect(client.sendMessage('session', 'Keep this draft', [], { permissionMode: 'plan' })).rejects.toThrow('original draft and model/effort/permission choices');
    await expect(client.sendMessage('session', 'Keep this draft', [], { effort: 'high' })).rejects.toThrow('original draft and model/effort/permission choices');
    await client.sendMessage('session', 'Keep this draft');
    // Assert
    expect(packets).toHaveLength(2);
    expect(packets[1]).toEqual(packets[0]);
    expect(client.getSnapshot().sessions[0].messages).toMatchObject([
      { content: 'Keep this draft' },
    ]);
    expect(JSON.stringify(packets)).not.toContain('Keep this draft');
  });
  it('should send a hidden recap request with the normal modes and the selected recap mode', async () => {
    // Arrange
    await start();
    const packets: Json[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const packet = JSON.parse(String(init?.body)).messages[0];
      packets.push(packet);
      return response({ messages: [{ id: `sent-${packets.length}`, seq: packets.length, localId: packet.localId, createdAt: 200 }] });
    });
    const decrypt = (packet: Json) => (client as any).encryption.decrypt(packet.content, (client as any).sessions.get('session').key);
    // Act
    await client.sendRecapRequest('session', { permissionMode: 'plan', recapMode: 'manual' });
    await client.sendMessage('session', 'A normal message', [], { permissionMode: 'plan' });
    // Assert
    const [request, normal] = await Promise.all(packets.map(decrypt));
    expect(request.content).toEqual({ type: 'text', text: '[rayno] Recap your previous reply.' });
    expect(request.meta).toMatchObject({ sentFrom: 'web', permissionMode: 'plan', raynoRecap: true, displayText: 'Recap' });
    expect(request.meta.appendSystemPrompt).not.toContain('1,000 visible characters');
    expect(normal.meta.raynoRecap).toBeUndefined();
    expect(normal.meta.displayText).toBeUndefined();
    expect(normal.meta.appendSystemPrompt).toContain('only when the main reply exceeds 1,000 visible characters');
    expect(client.getSnapshot().sessions[0].messages).toMatchObject([
      { content: 'Recap', recapRequest: true },
      { content: 'A normal message' },
    ]);
    expect(client.getSnapshot().sessions[0].messages[1].recapRequest).toBeUndefined();
  });
  it('should drop an unconfirmed recap request when the next send is a normal message', async () => {
    // Arrange
    await start();
    const packets: Json[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const packet = JSON.parse(String(init?.body)).messages[0];
      packets.push(packet);
      if (packets.length === 1) throw new TypeError('Connection lost');
      return response({ messages: [{ id: `sent-${packets.length}`, seq: packets.length, localId: packet.localId, createdAt: 200 }] });
    });
    // Act
    await expect(client.sendRecapRequest('session', { permissionMode: 'plan' })).rejects.toThrow('Connection lost');
    await client.sendMessage('session', 'Now fix it');
    // Assert
    expect(packets).toHaveLength(2);
    expect(packets[1].localId).not.toBe(packets[0].localId);
    expect(client.getSnapshot().sessions[0].messages).toMatchObject([{ content: 'Now fix it' }]);
  });
  it('should keep an unconfirmed normal draft when a recap request comes next', async () => {
    // Arrange
    await start();
    fetchMock.mockImplementation(async () => { throw new TypeError('Connection lost'); });
    await expect(client.sendMessage('session', 'Keep this draft')).rejects.toThrow('Connection lost');
    // Act / Assert
    await expect(client.sendRecapRequest('session')).rejects.toThrow('original draft');
  });
  it('should require a CLI resume without changing an ended session', async () => {
    // Arrange
    session.active = false;
    await start();
    fetchMock.mockClear();
    // Act / Assert
    await expect(client.archiveSession('session')).rejects.toThrow('Resume this session');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(client.getSnapshot().sessions[0].archived).toBe(true);
  });
  it('should restore a disconnected Rig session by removing its archive marker', async () => {
    // Arrange
    session.active = false;
    session.metadata = await client.encryption.encrypt({ ...metadata, flavor: 'rig', lifecycleState: 'archived' }, null);
    await start();
    socket.emitWithAck.mockResolvedValueOnce({ result: 'success', version: 2 });
    // Act
    await client.archiveSession('session');
    // Assert
    expect(client.getSnapshot().sessions[0]).toMatchObject({ archived: false, status: 'offline' });
  });
  it('should reapply a rename to the latest metadata without losing unknown fields', async () => {
    // Arrange
    await start();
    const latest = {
      ...metadata,
      summary: { text: 'New agent title' },
      unknownExtension: { keep: 'new value' },
    };
    socket.emitWithAck
      .mockResolvedValueOnce({
        result: 'version-mismatch',
        version: 2,
        metadata: await client.encryption.encrypt(latest, null),
      })
      .mockResolvedValueOnce({ result: 'success', version: 3 });
    // Act
    await client.renameSession('session', 'My title');
    const sent = await client.encryption.decrypt<Json>(
      socket.emitWithAck.mock.calls[1][1].metadata,
      null,
    );
    // Assert
    expect(sent).toEqual({ ...latest, name: 'My title' });
    expect(socket.emitWithAck.mock.calls[1][1].expectedVersion).toBe(2);
    expect(client.getSnapshot().sessions[0].customTitle).toBe('My title');
  });
  it('should recover a gap on reconnect when a newer socket message arrived first', async () => {
    // Arrange
    const initial = await wireMessage('initial', 10, 'Initial');
    const missed = await wireMessage('missed', 11, 'Recovered');
    const pushed = await wireMessage('pushed', 12, 'Pushed');
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/v2/sessions')
        ? response({ sessions: [session], hasNext: false })
        : url.includes('/v1/machines')
          ? response([])
          : response({
              messages: url.includes('after_seq=') ? [missed, pushed] : [initial],
              hasMore: false,
            }),
    );
    await start();
    const stopWatching = client.watchSession('session');
    await client.loadHistory('session');
    socket.handlers.get('update')?.({
      body: { t: 'new-message', sid: 'session', message: pushed },
    });
    await vi.waitFor(
      () =>
        expect(
          client.getSnapshot().sessions[0].messages.some((message) => message.id === 'pushed'),
        ).toBe(true),
      { interval: 1 },
    );
    // Act
    socket.handlers.get('connect')?.();
    await vi.waitFor(
      () =>
        expect(client.getSnapshot().sessions[0].messages.map((message) => message.id)).toEqual([
          'initial',
          'missed',
          'pushed',
        ]),
      { interval: 1 },
    );
    // Assert
    expect(fetchMock.mock.calls.some(([url]) => url.includes('after_seq=10'))).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    stopWatching();
  });
  it('should expose expired authorization instead of an empty successful workspace', async () => {
    // Arrange
    fetchMock.mockImplementation(async () => response({ error: 'Expired token' }, 401));
    // Act
    client.start();
    await expect(client.refresh()).rejects.toThrow('Expired token');
    // Assert
    expect(client.getSnapshot().unauthorized).toBe(true);
    expect(client.getSnapshot().sessions).toEqual([]);
  });
  it('should coalesce quota reads and keep a stale reading when a later refresh fails', async () => {
    // Arrange
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1,
      dataEncryptionKey: null, metadata: await client.encryption.encrypt({ host: 'Test computer' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines')
      ? response([machine]) : originalFetch(url));
    await start();
    let finish!: (value: Json) => void;
    const bash = vi.spyOn(client, 'bash').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    // Act
    const first = client.refreshUsage();
    const second = client.refreshUsage();
    // Assert
    expect(first).toBe(second);
    expect(client.getSnapshot().usageLoading).toBe(true);
    expect(bash).toHaveBeenCalledTimes(1);
    // Act
    finish({ stdout: JSON.stringify({ capturedAt: Date.now(), claude: { ok: true, data: {
      seven_day: { utilization: 42, resets_at: new Date(Date.now() + 3 * 86400000).toISOString() },
    } } }) });
    await first;
    // Assert
    expect(client.getSnapshot().usage[0]).toMatchObject({ agent: 'Claude', usedPercent: 42, machineId: 'computer', stale: false });
    // Act
    bash.mockRejectedValue(new Error('Computer did not answer'));
    await client.refreshUsage();
    // Assert
    expect(client.getSnapshot().usage[0]).toMatchObject({ usedPercent: 42, stale: true });
    expect(client.getSnapshot().usageErrors).toEqual(['Test computer usage: Computer did not answer']);
    expect(client.getSnapshot().usageLoading).toBe(false);
    expect(client.getSnapshot().error).toBe('');
  });
  it('should reject an explicit default alias before it sends a message', async () => {
    // Arrange
    await start();
    // Act / Assert
    await expect(client.sendMessage('session', 'Use a real model', [], { model: 'default' })).rejects.toThrow('specific model');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('should refuse an offline RPC before Socket.IO can buffer a mutation', async () => {
    // Arrange
    await start();
    socket.connected = false;
    // Act / Assert
    await expect(client.stopSession('session')).rejects.toThrow('offline');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });
  it('should announce background state on reconnect without claiming foreground activity', async () => {
    // Arrange
    await start();
    Object.assign(document, { visibilityState: 'hidden' });
    let auth: Json = {};
    // Act
    transport.options.auth((value: Json) => {
      auth = value;
    });
    // Assert
    expect(auth).toMatchObject({ appState: 'background', clientType: 'user-scoped' });
  });
  it.each(['https://happy.test/blob', 'https://happy.test.evil.example/blob'])('should scope image authorization to the exact server origin for %s', async (address) => {
    // Arrange
    await start();
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const encrypted = await client.encryption.encryptBlob(bytes, null);
    fetchMock.mockImplementation(async (url: string | URL) => String(url).includes('request-download')
      ? response({ downloadUrl: address }) : new Response(encrypted as BodyInit));
    // Act
    const image = await client.loadImage('session', 'image-ref');
    // Assert
    expect(image.type).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
    const headers = fetchMock.mock.calls.at(-1)![1].headers as Headers;
    expect(headers.get('Authorization')).toBe(address === 'https://happy.test/blob' ? 'Bearer test-token' : null);
  });
  it('should resume a tracked legacy session without sending the account master secret', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    session.metadata = await client.encryption.encrypt(metadata, null);
    session.active = false;
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ resumeSupport: { rpcAvailable: true } }, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start();
    socket.handlers.get('connect')?.();
    await client.refresh();
    socket.emitWithAck.mockImplementation(async () => {
      session.active = true;
      return { ok: true, result: await client.encryption.encrypt({ type: 'success', sessionId: 'session' }, null) };
    });
    // Act
    const first = client.resumeSession('session'), second = client.resumeSession('session');
    await Promise.all([first, second]);
    // Assert
    expect(first).toBe(second);
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    const params = await client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[0][1].params, null);
    expect(params).toMatchObject({ sessionId: 'session', fallbackReason: 'client-has-no-data-key' });
    expect(params.fallback).toBeUndefined();
    expect(params.model).toBeTruthy();
    expect(JSON.stringify(params)).not.toContain(credentials.secret);
  });

  it('should keep an unknown fork result from creating another provider copy on retry', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    session.metadata = await client.encryption.encrypt(metadata, null);
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({}, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start(); socket.handlers.get('connect')?.(); await client.refresh();
    socket.emitWithAck.mockRejectedValue(new Error('Timeout'));
    // Act / Assert
    await expect(client.branchSession('session', 'fork', undefined, {})).rejects.toThrow('did not confirm');
    await expect(client.branchSession('session', 'fork', undefined, {})).rejects.toThrow('previous copy has no confirmation');
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  });
  it('should reject a duplicate without a selected provider message before a copy starts', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    session.metadata = await client.encryption.encrypt(metadata, null);
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({}, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start(); socket.handlers.get('connect')?.(); await client.refresh();
    // Act / Assert
    await expect(client.branchSession('session', 'duplicate', undefined, {})).rejects.toThrow('Choose a message');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });
});
// A ciphertext that no account or session key opens.
const damaged = base64(new Uint8Array(48).fill(9));
const damagedMessage = (id: string, seq: number) => ({ id, seq, createdAt: 200, content: { t: 'encrypted', c: damaged } });
const rpcReply = async (value: unknown) => ({ ok: true, result: await client.encryption.encrypt(value, null) });
const requests = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method || 'GET'} ${String(url).replace(credentials.server, '')}`);
describe('Happy client session lifecycle', () => {
  it('should archive a connected CLI session through killSession without a server archive or metadata write', async () => {
    // Arrange
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce(await rpcReply({ success: true, message: 'Killing happy-cli process' }));
    // Act
    await client.archiveSession('session');
    // Assert
    expect(socket.emitWithAck.mock.calls).toEqual([['rpc-call', expect.objectContaining({ method: 'session:killSession' })]]);
    expect(requests()).toEqual([]);
    expect(client.getSnapshot().sessions[0].archived).toBe(true);
  });
  it.each([
    ['an unavailable agent', { ok: false, error: 'RPC method not available' }],
    ['a refused kill', { success: false, message: 'Not now' }],
    ['a lost acknowledgement', new Error('Timeout')],
  ])('should fall back to the server archive after %s', async (_name, reply) => {
    // Arrange
    await start();
    fetchMock.mockClear();
    if (reply instanceof Error) socket.emitWithAck.mockRejectedValueOnce(reply);
    else socket.emitWithAck.mockResolvedValueOnce('ok' in reply ? reply : await rpcReply(reply));
    // Act
    await client.archiveSession('session');
    // Assert
    expect(socket.emitWithAck.mock.calls.map(([event]) => event)).toEqual(['rpc-call']);
    expect(requests()).toEqual(['POST /v1/sessions/session/archive']);
    expect(client.getSnapshot().sessions[0].archived).toBe(true);
  });
  it('should archive a Rig session on an offline computer through the server and its archive marker', async () => {
    // Arrange
    session.active = false;
    session.metadata = await client.encryption.encrypt({ ...metadata, flavor: 'rig', client: { id: 'rig' } }, null);
    const machine = { id: 'computer', active: false, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Computer' }, null) };
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce({ result: 'success', version: 2 });
    // Act
    await client.archiveSession('session');
    // Assert
    expect(requests()).toEqual(['POST /v1/sessions/session/archive']);
    expect(socket.emitWithAck.mock.calls.map(([event]) => event)).toEqual(['update-metadata']);
    const sent = await client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[0][1].metadata, null);
    expect(sent).toMatchObject({ lifecycleState: 'archived', unknownExtension: { keep: true } });
    expect(client.getSnapshot().sessions[0].archived).toBe(true);
  });
  it('should stop a connected session before the delete and continue when the stop fails', async () => {
    // Arrange
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockRejectedValueOnce(new Error('Timeout'));
    // Act
    await client.deleteSession('session');
    // Assert
    expect(socket.emitWithAck.mock.calls).toEqual([['rpc-call', expect.objectContaining({ method: 'session:killSession' })]]);
    expect(requests()).toEqual(['DELETE /v1/sessions/session']);
    expect(socket.emitWithAck.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(client.getSnapshot().sessions).toEqual([]);
  });
  it('should delete an ended session without a stop request', async () => {
    // Arrange
    session.active = false;
    await start();
    fetchMock.mockClear();
    // Act
    await client.deleteSession('session');
    // Assert
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(requests()).toEqual(['DELETE /v1/sessions/session']);
  });
});
describe('Happy client session activity', () => {
  it('should sort an older CLI session by this device last send and keep it per account', async () => {
    // Arrange: Happy Web utils/sessionActivity.ts uses lastMeaningfulMessageAt, then lastMessageSentAt, then createdAt.
    const newer = { ...session, id: 'newer', createdAt: 5000 };
    const tracked = { ...session, id: 'tracked', metadata: await client.encryption.encrypt({ ...metadata, lastMeaningfulMessageAt: 3000 }, null) };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.includes('/v2/sessions')
      ? response({ sessions: [session, newer, tracked], hasNext: false })
      : url.endsWith('/v1/machines') ? response([])
        : init?.method === 'POST'
          ? response({ messages: JSON.parse(String(init.body)).messages.map((packet: Json, index: number) =>
            ({ id: 'sent-' + index, seq: index + 1, localId: packet.localId, createdAt: 200 })) })
          : response({ messages: [], hasMore: false }));
    await start();
    const order = () => client.getSnapshot().sessions.map((row) => [row.id, row.lastActivityAt]);
    expect(order()).toEqual([['newer', 5000], ['tracked', 3000], ['session', 100]]);
    vi.mocked(Date.now).mockReturnValue(9000);
    // Act
    await client.sendMessage('session', 'Continue');
    // Assert
    expect(order()).toEqual([['session', 9000], ['newer', 5000], ['tracked', 3000]]);
    expect(JSON.parse(client.readLocal('lastMessageSentAt')!)).toEqual({ session: 9000 });
    // Act
    client.dispose();
    client = await HappyClient.create(credentials);
    await start();
    // Assert
    expect(order()[0]).toEqual(['session', 9000]);
    // Act
    client.dispose();
    client = await HappyClient.create({ ...credentials, server: 'https://other.test' });
    await start();
    // Assert
    expect(order()).toEqual([['newer', 5000], ['tracked', 3000], ['session', 100]]);
  });
  it('should forget the local send time when the session is deleted', async () => {
    // Arrange
    client.writeLocal('lastMessageSentAt', JSON.stringify({ session: 9000, other: 8000 }));
    client.dispose();
    client = await HappyClient.create(credentials);
    session.active = false;
    await start();
    expect(client.getSnapshot().sessions[0].lastActivityAt).toBe(9000);
    // Act
    await client.deleteSession('session');
    // Assert
    expect(JSON.parse(client.readLocal('lastMessageSentAt')!)).toEqual({ other: 8000 });
  });
});
describe('Happy client damaged records', () => {
  it('should publish the readable sessions and computers around a damaged record', async () => {
    // Arrange
    const sessions = [{ ...session, id: 'a', updatedAt: 50000 }, { ...session, id: 'b', metadata: damaged, updatedAt: 100000 }, { ...session, id: 'c', updatedAt: 40000 }];
    const computer = async (id: string) => ({ id, active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: id }, null) });
    const machines = [await computer('m1'), { ...(await computer('m2')), metadata: damaged }, await computer('m3')];
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions, hasNext: false })
      : url.endsWith('/v1/machines') ? response(machines) : response({ messages: [], hasMore: false }));
    // Act
    await start();
    fetchMock.mockClear();
    await client.refresh();
    // Assert
    expect(client.getSnapshot().sessions.map((row) => row.id).sort()).toEqual(['a', 'c']);
    expect(client.getSnapshot().machines.map((row) => row.id)).toEqual(['m1', 'm3']);
    expect(client.getSnapshot()).toMatchObject({ loading: false, error: '' });
    expect(requests().find((url) => url.includes('/v2/sessions'))).toContain('changedSince=70000');
  });
  it('should keep the workspace error when no record decrypts on the first read', async () => {
    // Arrange
    session.metadata = damaged;
    // Act
    client.start();
    // Assert
    await expect(client.refresh()).rejects.toThrow();
    await vi.waitFor(() => expect(client.getSnapshot().error).not.toBe(''), { interval: 1 });
    expect(client.getSnapshot()).toMatchObject({ loading: false, sessions: [] });
  });
  it('should keep the workspace error when no session decrypts on the first read', async () => {
    // Arrange
    session.metadata = damaged;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Readable computer' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([machine]) : response({ messages: [], hasMore: false }));
    // Act
    client.start();
    // Assert
    await expect(client.refresh()).rejects.toThrow();
    await vi.waitFor(() => expect(client.getSnapshot().error).not.toBe(''), { interval: 1 });
    expect(client.getSnapshot()).toMatchObject({ loading: false, sessions: [] });
  });
  it.each([['a readable computer', true], ['no readable computer', false]])(
    'should keep the cached copy, its saved time, and the error after a restore when no session decrypts with %s', async (_name, readableComputer) => {
      // Arrange
      client.dispose();
      vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue({ version: 1, savedAt: 50, machines: [],
        sessions: [{ wire: { ...session, metadata: undefined }, metadata, agentState: {} }] } as never);
      const save = vi.spyOn(OfflineCache.prototype, 'save');
      const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
        metadata: readableComputer ? await client.encryption.encrypt({ host: 'Computer' }, null) : damaged };
      fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
        ? response({ sessions: [{ ...session, metadataVersion: 2, metadata: damaged }], hasNext: false })
        : url.endsWith('/v1/machines') ? response([machine]) : response({ messages: [], hasMore: false }));
      client = await HappyClient.create(credentials);
      // Act
      client.start();
      // Assert
      await expect(client.refresh()).rejects.toThrow();
      await vi.waitFor(() => expect(client.getSnapshot().error).not.toBe(''), { interval: 1 });
      expect(client.getSnapshot()).toMatchObject({ loading: false, cachedAt: 50 });
      expect(client.getSnapshot().sessions.map((row) => row.title)).toEqual(['Agent title']);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(save).not.toHaveBeenCalled();
    });
  it('should keep the readable session fields when a realtime update does not decrypt', async () => {
    // Arrange
    await start();
    // Act
    socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session', metadata: { version: 2, value: damaged } } });
    socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session', updatedAt: 900, metadata: { version: 3,
      value: await client.encryption.encrypt({ ...metadata, summary: { text: 'Readable title' } }, null) } } });
    // Assert
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].title).toBe('Readable title'), { interval: 1 });
    expect(client.getSnapshot().error).toBe('');
  });
  it('should load the readable messages around a damaged message and advance the cursor', async () => {
    // Arrange
    const page = [await wireMessage('a', 1, 'First'), damagedMessage('b', 2), await wireMessage('c', 3, 'Third')];
    const later = [damagedMessage('d', 4), await wireMessage('e', 5, 'Fifth')];
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([])
        : response({ messages: url.includes('after_seq=3&') ? later : url.includes('after_seq=') ? [] : page, hasMore: false }));
    await start();
    // Act
    await client.loadHistory('session');
    expect(client.getSnapshot().sessions[0].messages.map((row) => row.content)).toEqual(['First', 'Third']);
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: later[0] } });
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: later[1] } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].messages.map((row) => row.content))
      .toEqual(['First', 'Third', 'Fifth']), { interval: 1 });
    fetchMock.mockClear();
    await client.loadHistory('session', 'forward');
    await client.loadHistory('session', 'forward');
    // Assert
    expect(requests()).toEqual([
      'GET /v3/sessions/session/messages?after_seq=3&limit=100',
      'GET /v3/sessions/session/messages?after_seq=5&limit=100',
    ]);
    expect(client.getSnapshot().histories.session).toMatchObject({ loaded: true, error: '' });
    expect(client.getSnapshot().error).toBe('');
  });
  it('should report a history error when no message in the session decrypts', async () => {
    // Arrange
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([])
        : response({ messages: [damagedMessage('a', 1), damagedMessage('b', 2)], hasMore: false }));
    await start();
    // Act / Assert
    await expect(client.loadHistory('session')).rejects.toThrow();
    expect(client.getSnapshot().histories.session.error).not.toBe('');
    expect(client.getSnapshot().sessions[0].messages).toEqual([]);
  });
  it('should find the reply and sent modes behind damaged messages', async () => {
    // Arrange
    session.seq = 3;
    await start();
    session.seq = 6;
    const reply = { id: 'reply', seq: 4, createdAt: 200, content: { t: 'encrypted', c: await client.encryption.encrypt({ role: 'agent',
      content: { type: 'codex', data: { type: 'message', message: 'A reply' } } }, null) } };
    const sent = { id: 'sent', seq: 1, createdAt: 150, content: { t: 'encrypted', c: await client.encryption.encrypt({ role: 'user',
      content: { type: 'text', text: 'Plan it' }, meta: { permissionMode: 'plan' } }, null) } };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([])
        : url.includes('before_seq=2147483647&limit=4') ? response({ messages: [damagedMessage('d6', 6), damagedMessage('d5', 5), reply], hasMore: true })
          : url.includes('before_seq=2147483647') ? response({ messages: [damagedMessage('d3', 3), damagedMessage('d2', 2)], hasMore: true })
            : response({ messages: url.includes('before_seq=2&') ? [sent] : [], hasMore: false }));
    // Act
    await client.refresh();
    const modes = await client.findSentModes('session');
    // Assert
    expect(client.getSnapshot().sessions[0].unread).toBe(true);
    expect(modes).toMatchObject({ permissionMode: 'plan', seq: 1 });
  });
  it('should restore the readable cached records around a damaged record key', async () => {
    // Arrange
    client.dispose();
    const wire = { ...session, metadata: undefined };
    vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue({ version: 1, savedAt: 50, machines: [], sessions: [
      { wire: { ...wire, id: 'a' }, metadata, agentState: {} },
      { wire: { ...wire, id: 'b', dataEncryptionKey: 'AQ==' }, metadata, agentState: {} },
      { wire: { ...wire, id: 'c' }, metadata, agentState: {} },
    ] } as never);
    // Act
    client = await HappyClient.create(credentials);
    // Assert
    expect(client.getSnapshot().sessions.map((row) => row.id).sort()).toEqual(['a', 'c']);
    expect(client.getSnapshot().cachedAt).toBe(50);
  });
});
