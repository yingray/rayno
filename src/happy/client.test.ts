import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64 } from './crypto';
import { HappyClient } from './client';
import type { Json } from './normalize';
import { OfflineCache } from './offlineCache';
import { defaultNewDraft } from '../data/defaults';
import { DirectoryApprovalError } from './errors';
import { agentSubagentWork, taggedMainReads } from './subagentEnvelopes.fixture';

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
  it('should read historical usage with account headers and an explicit session filter',async()=>{
    fetchMock.mockResolvedValue(response({usage:[{timestamp:100,tokens:{model:9},cost:{model:0.01},reportCount:1}]}));
    const points=await client.queryUsage('7days','session');
    const [url,init]=fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('https://happy.test/v1/usage/query');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({sessionId:'session',groupBy:'day'});
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(points[0].tokens).toEqual({model:9});
  });
  it('should retry a computer rename on a metadata conflict and retain unknown fields',async()=>{
    const machine={id:'computer',active:true,metadataVersion:1,dataEncryptionKey:null,
      metadata:await client.encryption.encrypt({host:'Mac',extension:'keep'},null)};
    fetchMock.mockImplementation(async(url:string)=>url.includes('/v2/sessions')?response({sessions:[session],hasNext:false}):url.endsWith('/v1/machines')?response([machine]):response({messages:[],hasMore:false}));
    await start();socket.connected=true;
    socket.emitWithAck.mockResolvedValueOnce({result:'version-mismatch',version:2,metadata:await client.encryption.encrypt({host:'Mac',extension:'new'},null)})
      .mockResolvedValueOnce({result:'success',version:3});
    await client.renameMachine('computer','New Mac');
    const [event,payload]=socket.emitWithAck.mock.calls.at(-1)!;
    expect(event).toBe('machine-update-metadata');expect(payload.expectedVersion).toBe(2);
    expect(await client.encryption.decrypt(payload.metadata,null)).toEqual({host:'Mac',extension:'new',displayName:'New Mac'});
    expect(client.getSnapshot().machines[0].name).toBe('New Mac');
  });
  it('should remove only the computer and retain session history after a delete succeeds',async()=>{
    await start();
    fetchMock.mockResolvedValueOnce(new Response(null,{status:204}));
    await client.deleteMachine('computer');
    expect(client.getSnapshot().sessions.map(item=>item.id)).toContain('session');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://happy.test/v1/machines/computer');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

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
  it('should list session files through one ripgrep RPC, reuse it, and retry after a failure', async () => {
    // Arrange: the CLI handler in modules/common/registerCommonHandlers.ts returns { success, exitCode, stdout, stderr }.
    await start();
    socket.emitWithAck.mockResolvedValueOnce({ ok: true, result: await client.encryption.encrypt({ success: false, error: 'rg missing' }, null) });
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(
      { success: true, exitCode: 0, stdout: 'src/a.ts\nREADME.md\n', stderr: '' }, null) });
    // Act / Assert
    await expect(client.sessionFiles('session')).rejects.toThrow('rg missing');
    const files = await client.sessionFiles('session');
    expect(files.map((file) => file.fullPath)).toEqual(['src/a.ts', 'README.md', 'src/']);
    expect(await client.sessionFiles('session')).toBe(files);
    const calls = socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].method).toBe('session:ripgrep');
    expect(await client.encryption.decrypt(calls[1][1].params, null)).toEqual({ args: ['--files', '--follow'] });
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
  // Shape from Happy Web sync/storageTypes.ts AgentCommunicationSchema and sync/ops.ts sessionAnswerQuestion.
  const questionState = { communications: { 'form-1': { kind: 'form', createdAt: 1, toolUseId: 'call-1',
    form: { questions: [{ id: 'q1', header: 'Pick', question: 'Which?', options: [{ label: 'A' }] }] } } } };
  it('should close the form when the agent returns void to the communication answer', async () => {
    // Arrange: Happy Web sessionEncryption.ts decryptRaw reads an empty reply as null and completes the answer.
    session.agentState = await client.encryption.encrypt(questionState, null);
    await start();
    socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
    // Act
    await client.answerQuestions('session', 'form-1', { q1: { options: ['A'] } });
    // Assert
    const [, payload] = socket.emitWithAck.mock.calls.find(([event]) => event === 'rpc-call')!;
    expect(payload.method).toBe('session:communication');
    expect(await client.encryption.decrypt(payload.params, null))
      .toEqual({ id: 'form-1', kind: 'form', status: 'answered', answers: { q1: { options: ['A'] } } });
    expect(client.getAgentState('session').communications).toEqual({});
    await expect(client.answerQuestions('session', 'form-1', null)).rejects.toThrow('This request already has a reply.');
    expect(socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call')).toHaveLength(1);
  });
  it('should reject a damaged communication reply and keep the form open', async () => {
    // Arrange
    session.agentState = await client.encryption.encrypt(questionState, null);
    await start();
    const damaged = Uint8Array.from(atob(await client.encryption.encrypt(undefined, null)), (char) => char.charCodeAt(0));
    damaged[damaged.length - 1] ^= 1;
    socket.emitWithAck.mockResolvedValue({ ok: true, result: base64(damaged) });
    // Act / Assert
    await expect(client.answerQuestions('session', 'form-1', { q1: { options: ['A'] } })).rejects.toThrow();
    expect(Object.keys(client.getAgentState('session').communications)).toEqual(['form-1']);
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
  it('should read a session after a session-event ephemeral so a missed reply becomes unread', async () => {
    // Arrange
    session.seq = 3;
    await start();
    const missed = { id: 'missed', seq: 4, createdAt: 200, content: { t: 'encrypted',
      c: await client.encryption.encrypt({ role: 'agent', content: {
        type: 'codex', data: { type: 'message', message: 'Finished while the socket missed it' },
      } }, null) } };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.includes('/v1/machines') ? response([]) : response({ messages: [missed], hasMore: false }));
    fetchMock.mockClear();
    // Act
    socket.handlers.get('ephemeral')?.({ type: 'session-event', sessionId: 'unknown', kind: 'done', title: 'Done', body: 'Done', timestamp: 1 });
    socket.handlers.get('ephemeral')?.({ type: 'session-event', sessionId: 'session', kind: 'other', title: 'Done', body: 'Done', timestamp: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    socket.handlers.get('ephemeral')?.({ type: 'session-event', sessionId: 'session', kind: 'done', title: 'Claude finished', body: 'Ready', timestamp: 1 });
    // Assert
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].unread).toBe(true), { interval: 1 });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=2']);
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
  it('should keep subagent options out of needs reply until the main answer arrives', async () => {
    // Arrange
    const wire = await Promise.all(agentSubagentWork.map(async (raw, index) => ({ id: raw.content.id, seq: index + 1, createdAt: raw.content.time,
      content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } })));
    const stop = agentSubagentWork.findIndex((raw) => raw.content.ev.t === 'stop');
    session.seq = stop;
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions') ? response({ sessions: [session], hasNext: false })
      : url.includes('/v1/machines') ? response([]) : response({ messages: wire.slice(0, stop).reverse(), hasMore: false }));
    // Act
    await start();
    // Assert
    expect(client.getSnapshot().sessions[0].needsReply).toBe(false);
    // Act
    for (const message of wire.slice(stop)) socket.handlers.get('update')?.({ body: { t: 'new-message', sid: 'session', message } });
    // Assert
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].needsReply).toBe(true), { interval: 1 });
  });
  it('should clear an old false child attention state while preserving the read cursor',async()=>{
    // Arrange
    const option=agentSubagentWork.findIndex(raw=>raw.content.ev.text?.startsWith('Subagent found config.json'));
    const wire=await Promise.all(agentSubagentWork.slice(0,option+1).map(async(raw,index)=>({id:raw.content.id,seq:index+1,
      createdAt:raw.content.time,content:{t:'encrypted',c:await client.encryption.encrypt(raw,null)}})));
    session.seq=option+1;
    client.writeLocal('attention.session',JSON.stringify({readSeq:2,userSeq:1,assistantSeq:session.seq,optionsSeq:session.seq,inspectedSeq:session.seq}));
    fetchMock.mockImplementation(async(url:string)=>url.includes('/v2/sessions')?response({sessions:[session],hasNext:false})
      :url.endsWith('/v1/machines')?response([]):response({messages:[...wire].reverse(),hasMore:false}));
    // Act
    await start();
    // Assert
    expect(client.getSnapshot().sessions[0]).toMatchObject({needsReply:false,unread:false});
    expect(JSON.parse(client.readLocal('attention.session')!)).toMatchObject({readSeq:2,optionsSeq:0,classificationVersion:2});
  });
  it.each([['restores', true], ['does not have', false]])(
    'should place a running subagent option after a reload when the cache %s the subagent bounds', async (_name, cached) => {
      // Arrange
      const wire = await Promise.all(agentSubagentWork.map(async (raw, index) => ({ id: raw.content.id, seq: index + 1, createdAt: raw.content.time,
        content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } })));
      const option = agentSubagentWork.findIndex((raw) => raw.content.ev.text?.startsWith('Subagent found config.json'));
      const save = vi.spyOn(OfflineCache.prototype, 'save').mockResolvedValue(true);
      // A v3 page: rows before before_seq, newest first, at most `limit`.
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v2/sessions')) return response({ sessions: [session], hasNext: false });
        if (url.includes('/v1/machines')) return response([]);
        const query = new URL(url).searchParams, before = Number(query.get('before_seq')), limit = Number(query.get('limit'));
        const rows = wire.slice(0, session.seq).filter((row) => row.seq < before).reverse();
        return response({ messages: rows.slice(0, limit), hasMore: rows.length > limit });
      });
      session.seq = option;
      await start();
      await (client as any).flushCache();
      const workspace = save.mock.calls.at(-1)![0];
      client.dispose();
      vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue(cached ? workspace : { ...workspace, subagents: undefined });
      session.seq = option + 1;
      // Act
      client = await HappyClient.create(credentials);
      await start();
      // Assert
      expect(workspace.subagents).toEqual({ session: {
        marks: [{ id: 'c744020fe7d250cca47a5ae1', title: 'Find config', bounds: [[5, true]] }], read: [0, option] } });
      expect(fetchMock.mock.calls.map(([url]) => url)).toContain(`https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=2`);
      // An absent cache triggers an older-page read, so child options never become a main reply.
      expect(client.getSnapshot().sessions[0]).toMatchObject({ needsReply: false, unread: false });
      // Act
      session.seq = wire.length;
      await client.refresh(true);
      // Assert
      expect(client.getSnapshot().sessions[0]).toMatchObject({ needsReply: true, unread: true });
    });
  it('should show a tagged main answer after a reload when the subagent stop is on an older page than the answer', async () => {
    // Arrange
    const subagent = 'c744020fe7d250cca47a5ae1';
    const stop = agentSubagentWork.findIndex((raw) => raw.content.ev.t === 'stop');
    const answer = agentSubagentWork.findIndex((raw) => raw.content.ev.text?.startsWith('The config is config.json.'));
    const raws = [...agentSubagentWork.slice(0, answer), ...taggedMainReads(60), ...agentSubagentWork.slice(answer)];
    const wire = await Promise.all(raws.map(async (raw, index) => ({ id: raw.content.id, seq: index + 1, createdAt: raw.content.time,
      content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } })));
    const save = vi.spyOn(OfflineCache.prototype, 'save').mockResolvedValue(true);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/v2/sessions')) return response({ sessions: [session], hasNext: false });
      if (url.includes('/v1/machines')) return response([]);
      const query = new URL(url).searchParams, before = Number(query.get('before_seq')), limit = Number(query.get('limit'));
      const rows = wire.slice(0, session.seq).filter((row) => row.seq < before).reverse();
      return response({ messages: rows.slice(0, limit), hasMore: rows.length > limit });
    });
    // The cache keeps only the start: the subagent was still running.
    session.seq = stop;
    await start();
    await (client as any).flushCache();
    const workspace = save.mock.calls.at(-1)![0];
    client.dispose();
    vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue(workspace);
    session.seq = wire.length;
    // Act
    client = await HappyClient.create(credentials);
    await start();
    await (client as any).flushCache();
    // Assert
    expect(workspace.subagents?.session.marks).toEqual([{ id: subagent, title: 'Find config', bounds: [[5, true]] }]);
    // The newest page has the answer. The stop is on the second page, more than one page below the newest row.
    expect(wire.length - (stop + 1)).toBeGreaterThan(100);
    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/messages?')).slice(-2)).toEqual([
      `https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=100`,
      `https://happy.test/v3/sessions/session/messages?before_seq=${wire.length - 99}&limit=100`,
    ]);
    expect(client.getSnapshot().sessions[0]).toMatchObject({ needsReply: true, unread: true });
    expect(save.mock.calls.at(-1)![0].subagents?.session).toEqual({
      marks: [{ id: subagent, title: 'Find config', bounds: [[5, true], [stop + 1, false]] }], read: [0, wire.length] });
  });
  it('should not trust a cached open start when the cache read range ends before the attention boundary', async () => {
    // Arrange
    const stop = agentSubagentWork.findIndex((raw) => raw.content.ev.t === 'stop');
    const answer = agentSubagentWork.findIndex((raw) => raw.content.ev.text?.startsWith('The config is config.json.'));
    const wire = await Promise.all(agentSubagentWork.map(async (raw, index) => ({ id: raw.content.id, seq: index + 1, createdAt: raw.content.time,
      content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } })));
    const save = vi.spyOn(OfflineCache.prototype, 'save').mockResolvedValue(true);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/v2/sessions')) return response({ sessions: [session], hasNext: false });
      if (url.includes('/v1/machines')) return response([]);
      const query = new URL(url).searchParams, before = Number(query.get('before_seq')), limit = Number(query.get('limit'));
      const rows = wire.slice(0, session.seq).filter((row) => row.seq < before).reverse();
      return response({ messages: rows.slice(0, limit), hasMore: rows.length > limit });
    });
    session.seq = stop - 1;
    await start();
    await (client as any).flushCache();
    const workspace = save.mock.calls.at(-1)![0];
    // A later scan reads the stop and saves its boundary at once. The reload comes before the next cache save.
    session.seq = answer;
    await client.refresh(true);
    client.dispose();
    vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue(workspace);
    session.seq = answer + 1;
    // Act
    client = await HappyClient.create(credentials);
    await start();
    // Assert
    expect(workspace.subagents?.session).toEqual({
      marks: [{ id: 'c744020fe7d250cca47a5ae1', title: 'Find config', bounds: [[5, true]] }], read: [0, stop - 1] });
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(`https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=2`);
    // The stop can be in the rows between the read range and the boundary, so the tagged answer stays a main answer.
    expect(client.getSnapshot().sessions[0]).toMatchObject({ needsReply: true, unread: true });
  });
  it('should keep a subagent TodoWrite out of the todo chip when its start is only in the cached bounds', async () => {
    // Arrange
    const subagent = 'c744020fe7d250cca47a5ae1';
    // happy-cli claude/utils/sessionProtocolMapper.ts: the subagent TodoWrite call and its end, from inside the running subagent.
    const envelope = (id: string, ev: Json) => ({ role: 'session', content: { id, time: 1792678304099, role: 'agent',
      turn: 'w3cn3ht73qf295i3adyacvvq', subagent, ev }, meta: { sentFrom: 'cli' } });
    const rows = [
      envelope('m2v8k1q0t7c3x9r5w4n6b2za', { t: 'tool-call-start', call: 'toolu_child_todo', name: 'TodoWrite', title: 'TodoWrite call',
        description: 'TodoWrite call', args: { todos: [{ content: 'Subagent step', status: 'in_progress', activeForm: 'Doing the subagent step' }] } }),
      envelope('m2v8k1q0t7c3x9r5w4n6b2zb', { t: 'tool-call-end', call: 'toolu_child_todo' }),
    ];
    const wire = await Promise.all(rows.map(async (raw, index) => ({ id: raw.content.id, seq: index + 6, createdAt: 200,
      content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } })));
    session.seq = 7;
    client.dispose();
    vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue({ version: 1, savedAt: 50, machines: [],
      sessions: [{ wire: { ...session, metadata: undefined }, metadata, agentState: {} }],
      subagents: { session: { marks: [{ id: subagent, title: 'Find config', bounds: [[5, true]] }], read: [0, 5] } } } as never);
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions') ? response({ sessions: [session], hasNext: false })
      : url.includes('/v1/machines') ? response([]) : response({ messages: [...wire].reverse(), hasMore: false }));
    client = await HappyClient.create(credentials);
    await start();
    // Act
    await client.loadHistory('session');
    // Assert
    const current = client.getSnapshot().sessions[0];
    expect(current.messages.flatMap(message => message.toolCalls || []).flatMap(call => call.children || []).flatMap(message => message.toolCalls || [])).toMatchObject([{ id: 'toolu_child_todo', ended: true }]);
    expect(current.todos).toEqual([]);
    expect(current.needsReply).toBe(false);
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
  it('should accept a different send after sync shows the unacknowledged send', async () => {
    // Arrange: the server commits the first send, but the response is lost. The agent then replies with options.
    await start();
    const packets: Json[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const packet = JSON.parse(String(init?.body)).messages[0];
      packets.push(packet);
      if (packets.length === 1) throw new TypeError('Connection lost after server commit');
      return response({ messages: [{ id: 'option', seq: 2, localId: packet.localId, createdAt: 300 }] });
    });
    await expect(client.sendMessage('session', 'Ask me to choose')).rejects.toThrow('Connection lost');
    socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session',
      message: await wireMessage('first', 1, 'Ask me to choose', packets[0].localId) } });
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].messages).toHaveLength(1));
    // Act
    await client.sendMessage('session', 'Option 1');
    // Assert
    expect(packets).toHaveLength(2);
    expect(packets[1].localId).not.toBe(packets[0].localId);
    expect(client.getSnapshot().sessions[0].messages.map(message => message.content)).toEqual(['Ask me to choose', 'Option 1']);
  });
  it('should find an unacknowledged send in older history before a different send', async () => {
    // Arrange: a long agent turn pushed the committed send out of the loaded pages.
    await start();
    const packets: Json[] = [];
    const historyUrls: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        historyUrls.push(url);
        return response({ messages: [await wireMessage('first', 1, 'Ask me to choose', packets[0].localId)], hasMore: false });
      }
      const packet = JSON.parse(String(init.body)).messages[0];
      packets.push(packet);
      if (packets.length === 1) throw new TypeError('Connection lost after server commit');
      return response({ messages: [{ id: 'option', seq: 300, localId: packet.localId, createdAt: 300 }] });
    });
    await expect(client.sendMessage('session', 'Ask me to choose')).rejects.toThrow('Connection lost');
    // Act
    await client.sendMessage('session', 'Option 1');
    // Assert
    expect(historyUrls).toEqual(['https://happy.test/v3/sessions/session/messages?before_seq=2147483647&limit=100']);
    expect(packets).toHaveLength(2);
    expect(packets[1].localId).not.toBe(packets[0].localId);
  });
  it('should keep an unacknowledged send that the server history does not have', async () => {
    // Arrange
    await start();
    const packets: Json[] = [];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return response({ messages: [], hasMore: false });
      packets.push(JSON.parse(String(init.body)).messages[0]);
      throw new TypeError('Connection lost before server commit');
    });
    await expect(client.sendMessage('session', 'Keep this draft')).rejects.toThrow('Connection lost');
    // Act / Assert
    await expect(client.sendMessage('session', 'Option 1')).rejects.toThrow('original draft and model/effort/permission choices');
    expect(packets).toHaveLength(1);
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
    expect(client.getSnapshot().usage[0]).toMatchObject({ agent: 'Claude', week: { usedPercent: 42 }, machineId: 'computer', stale: false });
    // Act
    bash.mockRejectedValue(new Error('Computer did not answer'));
    await client.refreshUsage();
    // Assert
    expect(client.getSnapshot().usage[0]).toMatchObject({ week: { usedPercent: 42 }, stale: true });
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
  it('should start a side chat as a marked fork with the parent link and explicit modes', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    metadata.models = [{ code: 'model-a', value: 'Model A' }];
    session.metadata = await client.encryption.encrypt(metadata, null);
    const child = { ...session, id: 'side', createdAt: 300, metadata: await client.encryption.encrypt({ ...metadata,
      claudeSessionId: 'copied-session', parentSessionId: 'session', isSideChat: true, summary: undefined }, null) };
    const sessions = [session];
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({}, null) };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions') ? response({ sessions, hasNext: false })
      : url.endsWith('/v1/machines') ? response([machine]) : response({ messages: [], hasMore: false }));
    await start(); socket.handlers.get('connect')?.(); await client.refresh();
    socket.emitWithAck.mockImplementation(async (_event: string, payload: Json) => {
      if (payload.method.endsWith(':claude-fork-session')) return rpcReply({ type: 'success', newClaudeSessionId: 'copied-session' });
      sessions.push(child);
      return rpcReply({ type: 'success', sessionId: 'side' });
    });
    // Act
    const id = await client.branchSession('session', 'side', undefined, { model: 'model-a', permissionMode: 'acceptEdits' });
    // Assert
    expect(id).toBe('side');
    const methods = socket.emitWithAck.mock.calls.map(([, payload]) => payload.method);
    expect(methods).toEqual(['computer:claude-fork-session', 'computer:spawn-happy-session']);
    const spawn = await client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[1][1].params, null);
    expect(spawn).toMatchObject({ type: 'spawn-in-directory', directory: '/real/project', agent: 'claude', isSideChat: true,
      parentSessionId: 'session', resumeClaudeSessionId: 'copied-session', modelMode: 'model-a', permissionMode: 'acceptEdits' });
    expect(client.getSnapshot().sessions.find((item) => item.id === 'side')).toMatchObject({ isSideChat: true, parentSessionId: 'session', title: 'Side chat' });
    expect(client.branchUnavailable('side', 'side')).toBe('A side chat cannot start another side chat.');
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
  it('should ask before a fork creates a missing folder and retry the spawn with the same copied conversation', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    session.metadata = await client.encryption.encrypt(metadata, null);
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({}, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start(); socket.handlers.get('connect')?.(); await client.refresh();
    // Wire shapes from happy-cli claude/utils/forkSession.ts and daemon/run.ts spawnSession.
    socket.emitWithAck
      .mockResolvedValueOnce(await rpcReply({ type: 'success', newClaudeSessionId: 'copied-session' }))
      .mockResolvedValueOnce(await rpcReply({ type: 'requestToApproveDirectoryCreation', directory: '/real/project' }))
      .mockResolvedValueOnce(await rpcReply({ type: 'success', sessionId: 'session' }));
    const params = (call: number) => client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[call][1].params, null);
    // Act
    const asked = await client.branchSession('session', 'fork', undefined, {}).catch((error) => error);
    // Assert
    expect(asked).toBeInstanceOf(DirectoryApprovalError);
    expect(asked.directory).toBe('/real/project');
    expect(await params(1)).toMatchObject({ directory: '/real/project', approvedNewDirectoryCreation: false, resumeClaudeSessionId: 'copied-session' });
    // Act
    await expect(client.branchSession('session', 'fork', undefined, {}, true)).resolves.toBe('session');
    // Assert
    expect(socket.emitWithAck.mock.calls.map(([, payload]) => payload.method)).toEqual([
      'computer:claude-fork-session', 'computer:spawn-happy-session', 'computer:spawn-happy-session']);
    expect(await params(2)).toMatchObject({ directory: '/real/project', approvedNewDirectoryCreation: true,
      resumeClaudeSessionId: 'copied-session', parentSessionId: 'session' });
  });
  it('should copy the conversation again when a fork follows a cancelled folder question', async () => {
    // Arrange
    metadata.claudeSessionId = 'provider-session';
    session.metadata = await client.encryption.encrypt(metadata, null);
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    const machine = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({}, null) };
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start(); socket.handlers.get('connect')?.(); await client.refresh();
    socket.emitWithAck
      .mockResolvedValueOnce(await rpcReply({ type: 'success', newClaudeSessionId: 'copied-session' }))
      .mockResolvedValueOnce(await rpcReply({ type: 'requestToApproveDirectoryCreation', directory: '/real/project' }))
      .mockResolvedValueOnce(await rpcReply({ type: 'success', newClaudeSessionId: 'second-copy' }))
      .mockResolvedValueOnce(await rpcReply({ type: 'requestToApproveDirectoryCreation', directory: '/real/project' }));
    await expect(client.branchSession('session', 'fork', undefined, {})).rejects.toBeInstanceOf(DirectoryApprovalError);
    // Act
    client.discardBranch('session', 'fork');
    await expect(client.branchSession('session', 'fork', undefined, {})).rejects.toBeInstanceOf(DirectoryApprovalError);
    // Assert
    expect(socket.emitWithAck.mock.calls.map(([, payload]) => payload.method)).toEqual([
      'computer:claude-fork-session', 'computer:spawn-happy-session', 'computer:claude-fork-session', 'computer:spawn-happy-session']);
    expect(await client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[3][1].params, null))
      .toMatchObject({ resumeClaudeSessionId: 'second-copy' });
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
  it('should keep an ended side chat open and close it through the server archive and its archive marker', async () => {
    // Arrange: happy-cli runClaude marks a running side chat; the server ends it after missed keepalives.
    session.active = false;
    session.metadata = await client.encryption.encrypt({ ...metadata, isSideChat: true, parentSessionId: 'parent', lifecycleState: 'running' }, null);
    const machine = { id: 'computer', active: false, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Computer' }, null) };
    const originalFetch = fetchMock.getMockImplementation()! as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/v1/machines') ? response([machine]) : originalFetch(url));
    await start();
    const ended = client.getSnapshot().sessions[0];
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce({ result: 'success', version: 2 });
    // Act
    await client.archiveSession('session');
    // Assert
    expect(ended).toMatchObject({ archived: true, sideChatClosed: false });
    expect(requests()).toEqual(['POST /v1/sessions/session/archive']);
    expect(socket.emitWithAck.mock.calls.map(([event]) => event)).toEqual(['update-metadata']);
    const sent = await client.encryption.decrypt<Json>(socket.emitWithAck.mock.calls[0][1].metadata, null);
    expect(sent).toMatchObject({ lifecycleState: 'archived', isSideChat: true, unknownExtension: { keep: true } });
    expect(client.getSnapshot().sessions[0]).toMatchObject({ archived: true, sideChatClosed: true });
  });
  it('should close a connected side chat through killSession and keep it closed with the archive marker', async () => {
    // Arrange
    session.metadata = await client.encryption.encrypt({ ...metadata, isSideChat: true, parentSessionId: 'parent', lifecycleState: 'running' }, null);
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce(await rpcReply({ success: true, message: 'Killing happy-cli process' }))
      .mockResolvedValueOnce({ result: 'success', version: 2 });
    // Act
    await client.archiveSession('session');
    // Assert
    expect(socket.emitWithAck.mock.calls.map(([event, body]) => body?.method || event)).toEqual(['session:killSession', 'update-metadata']);
    expect(requests()).toEqual([]);
    expect(client.getSnapshot().sessions[0]).toMatchObject({ archived: true, sideChatClosed: true });
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
  // A bot is a Rig session. Shape from Happy Web sync/__testdata__/rigMetadata.ts and sync/storageTypes.spec.ts.
  const rigBot = (): Json => ({ ...metadata, rigMetadataVersion: 1, client: { id: 'rig', name: 'Rig', version: '0.0.30' },
    provider: { id: 'codex', kind: 'codex', name: 'OpenAI Codex' }, flavor: 'codex', startedBy: 'daemon', startedFromDaemon: true,
    bot: { id: 'bot-1', name: 'Assistant', username: 'assistant', workspaceId: 'bot-workspace', orderKey: '1' } });
  it('should archive a bot only through killSession and keep it inactive in the list', async () => {
    // Arrange: Happy Web hooks/useSessionQuickActions.ts archives a bot without the server archive.
    session.metadata = await client.encryption.encrypt(rigBot(), null);
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce(await rpcReply({ success: true }));
    // Act
    await client.archiveSession('session');
    // Assert
    expect(socket.emitWithAck.mock.calls).toEqual([['rpc-call', expect.objectContaining({ method: 'session:killSession' })]]);
    expect(requests()).toEqual([]);
    expect(client.getSnapshot().sessions[0]).toMatchObject({ status: 'offline', archived: false });
  });
  it.each([
    ['a refused kill', { success: false, message: 'Not now' }, 'Not now'],
    ['an unavailable agent', { ok: false, error: 'RPC method not available' }, 'RPC method not available'],
    ['a kill without a message', { success: false }, 'Connect to the bot’s computer to archive it.'],
  ])('should keep a bot after %s without a server archive', async (_name, reply, message) => {
    // Arrange
    session.metadata = await client.encryption.encrypt(rigBot(), null);
    await start();
    fetchMock.mockClear();
    socket.emitWithAck.mockResolvedValueOnce('ok' in reply ? reply : await rpcReply(reply));
    // Act / Assert
    await expect(client.archiveSession('session')).rejects.toThrow(message);
    expect(requests()).toEqual([]);
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().sessions[0]).toMatchObject({ status: 'idle', archived: false });
  });
  it('should refuse to restore an archived bot before any request', async () => {
    // Arrange
    session.metadata = await client.encryption.encrypt({ ...rigBot(), lifecycleState: 'archived' }, null);
    await start();
    fetchMock.mockClear();
    // Act / Assert
    await expect(client.archiveSession('session')).rejects.toThrow('Use the Happy app to restore this bot.');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(requests()).toEqual([]);
  });
  it('should refuse to delete a bot conversation before any request', async () => {
    // Arrange: Happy Web sync/ops.ts sessionDelete refuses a bot.
    session.metadata = await client.encryption.encrypt(rigBot(), null);
    await start();
    fetchMock.mockClear();
    // Act / Assert
    await expect(client.deleteSession('session')).rejects.toThrow('Archive the bot instead');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(requests()).toEqual([]);
  });
});
describe('Happy client worktree cleanup', () => {
  const worktree = '/real/project/.dev/worktree/feature';
  async function prepare(computerActive = true, extra: Json[] = []) {
    metadata.path = worktree;
    session.metadata = await client.encryption.encrypt(metadata, null);
    const machine = { id: 'computer', active: computerActive, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Computer' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session, ...extra], hasNext: false })
      : url.endsWith('/v1/machines') ? response([machine]) : response({ messages: [], hasMore: false }));
    await start();
  }
  // Shape from happy-cli modules/common/registerCommonHandlers.ts bash handler.
  const bashReply = (stdout: string) => rpcReply({ success: true, stdout, stderr: '', exitCode: 0 });
  it('should offer a clean worktree after a git status check on its computer', async () => {
    // Arrange
    await prepare();
    socket.emitWithAck.mockResolvedValueOnce(await bashReply(''));
    // Act
    const path = await client.worktreeCleanup('session');
    // Assert
    expect(path).toBe(worktree);
    const [, payload] = socket.emitWithAck.mock.calls[0];
    expect(payload.method).toBe('computer:bash');
    expect(await client.encryption.decrypt(payload.params, null)).toMatchObject({ command: 'git status --porcelain', cwd: worktree });
  });
  it.each([
    ['uncommitted changes', async () => bashReply(' M README.md\n')],
    ['a failed git status', async () => rpcReply({ success: false, stdout: '', stderr: 'not a git repository', exitCode: 128 })],
    ['a lost acknowledgement', async () => { throw new Error('Timeout'); }],
  ])('should skip the offer after %s', async (_name, reply) => {
    // Arrange
    await prepare();
    socket.emitWithAck.mockImplementationOnce(reply);
    // Act / Assert
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
  });
  it('should skip the offer without a computer request for a plain folder, a shared worktree, an offline computer, or a bot', async () => {
    // Arrange
    await start();
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
    client.dispose();
    client = await HappyClient.create(credentials);
    const other = { ...session, id: 'other', metadata: await client.encryption.encrypt({ ...metadata, path: worktree }, null) };
    await prepare(true, [other]);
    // Act / Assert
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
    client.dispose();
    client = await HappyClient.create(credentials);
    await prepare(false);
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
    client.dispose();
    client = await HappyClient.create(credentials);
    metadata.bot = { id: 'bot', username: 'helper' };
    await prepare();
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });
  it('should not offer the parent worktree when a side chat closes after its parent ended', async () => {
    // Arrange: happy-cli runClaude writes isSideChat and parentSessionId, and the side chat runs in the parent's folder.
    metadata.isSideChat = true;
    metadata.parentSessionId = 'parent';
    await prepare();
    // Act / Assert
    await expect(client.worktreeCleanup('session')).resolves.toBe('');
    expect(socket.emitWithAck).not.toHaveBeenCalled();
  });
  it('should remove the worktree from the main checkout with a quoted path', async () => {
    // Arrange: Happy Web utils/worktree.ts removeWorktree.
    await prepare();
    socket.emitWithAck.mockResolvedValueOnce(await bashReply(''));
    // Act
    await client.removeWorktree('session', worktree);
    // Assert
    const [, payload] = socket.emitWithAck.mock.calls[0];
    expect(await client.encryption.decrypt(payload.params, null)).toMatchObject({
      command: `git worktree remove '${worktree}' --force`, cwd: '/real/project' });
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
      socket.handlers.get('ephemeral')!({ type: 'activity', id: 'session', active: true, activeAt: 999 });
      socket.handlers.get('ephemeral')!({ type: 'machine-activity', id: 'computer', active: false, activeAt: 999 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(save).not.toHaveBeenCalled();
      expect(client.getSnapshot().cachedAt).toBe(50);
    });
  it('should save the cache again after a readable read follows a failed read after a restore', async () => {
    // Arrange
    client.dispose();
    vi.spyOn(OfflineCache.prototype, 'workspace').mockResolvedValue({ version: 1, savedAt: 50, machines: [],
      sessions: [{ wire: { ...session, metadata: undefined }, metadata, agentState: {} }] } as never);
    const save = vi.spyOn(OfflineCache.prototype, 'save').mockResolvedValue(true);
    let readable = false;
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [readable ? session : { ...session, metadataVersion: 2, metadata: damaged }], hasNext: false })
      : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
    client = await HappyClient.create(credentials);
    client.start();
    await expect(client.refresh()).rejects.toThrow();
    socket.handlers.get('ephemeral')!({ type: 'activity', id: 'session', active: true, activeAt: 999 });
    readable = true;
    // Act
    await client.refresh();
    // Assert
    expect(save).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({ error: '', cachedAt: Date.now() });
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
  // Hold one decryption until the test releases it, so a second read can run during it.
  function holdDecrypt(target: string) {
    const decrypt = client.encryption.decrypt.bind(client.encryption);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    vi.spyOn(client.encryption, 'decrypt').mockImplementation(async (...args: Parameters<typeof decrypt>) => {
      if (args[0] === target && !held) { held = true; await gate; }
      return decrypt(...args);
    });
    return { release, held: () => held };
  }
  it('should apply a realtime session update to the record that a list read put in place during the decryption', async () => {
    // Arrange
    await start();
    const value = await client.encryption.encrypt({ ...metadata, summary: { text: 'New title' } }, null);
    const decryption = holdDecrypt(value);
    // Act
    socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session', metadata: { version: 2, value } } });
    await vi.waitFor(() => expect(decryption.held()).toBe(true), { interval: 1 });
    await client.refresh(true);
    decryption.release();
    // Assert
    await vi.waitFor(() => expect(client.getSnapshot().sessions[0].title).toBe('New title'), { interval: 1 });
    await client.refresh(true);
    expect(client.getSnapshot().sessions[0].title).toBe('New title');
  });
  it('should keep a newer realtime computer update when an older list read finishes after it', async () => {
    // Arrange
    const old = await client.encryption.encrypt({ host: 'Old name' }, null);
    const computer = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null, metadata: old };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([computer]) : response({ messages: [], hasMore: false }));
    await start();
    const decryption = holdDecrypt(old);
    // Act
    const read = client.refresh(true);
    await vi.waitFor(() => expect(decryption.held()).toBe(true), { interval: 1 });
    socket.handlers.get('update')!({ body: { t: 'update-machine', machineId: 'computer',
      metadata: { version: 2, value: await client.encryption.encrypt({ host: 'New name' }, null) } } });
    await vi.waitFor(() => expect(client.getSnapshot().machines[0]?.name).toBe('New name'), { interval: 1 });
    decryption.release();
    await read;
    // Assert
    expect(client.getSnapshot().machines[0]?.name).toBe('New name');
  });
  it('should share one later history read among the callers that come during a running read', async () => {
    // Arrange
    await start();
    const first = await wireMessage('a', 1, 'First');
    fetchMock.mockImplementation(async (url: string) => response({ messages: url.includes('/messages') ? [first] : [], hasMore: false }));
    await client.loadHistory('session');
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let forwardReads = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes('after_seq=')) return response({ messages: [], hasMore: false });
      forwardReads++;
      if (forwardReads === 1) await gate;
      return response({ messages: [], hasMore: false });
    });
    // Act
    const running = client.loadHistory('session', 'forward');
    await vi.waitFor(() => expect(forwardReads).toBe(1), { interval: 1 });
    const later = Array.from({ length: 10 }, () => client.loadHistory('session', 'forward'));
    release();
    await Promise.all([running, ...later]);
    // Assert
    expect(forwardReads).toBe(2);
  });
  it('should pass a failure of the running history read to the callers that wait for it', async () => {
    // Arrange
    await start();
    const first = await wireMessage('a', 1, 'First');
    fetchMock.mockImplementation(async (url: string) => response({ messages: url.includes('/messages') ? [first] : [], hasMore: false }));
    await client.loadHistory('session');
    let fail = (_error: Error) => {};
    fetchMock.mockImplementation((url: string) => url.includes('after_seq=')
      ? new Promise<Response>((_resolve, reject) => { fail = reject; })
      : Promise.resolve(response({ messages: [], hasMore: false })));
    // Act
    const running = client.loadHistory('session', 'forward').catch((error: Error) => error.message);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('after_seq='))).toBe(true), { interval: 1 });
    const later = client.loadHistory('session', 'forward').catch((error: Error) => error.message);
    fail(new Error('The relay is down.'));
    // Assert
    expect(await running).toBe('The relay is down.');
    expect(await later).toBe('The relay is down.');
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
  it('should skip a message that the agent rejected when it finds the sent modes', async () => {
    // Arrange
    await start();
    const wire = async (id: string, seq: number, raw: Json) => ({ id, seq, createdAt: 100 + seq,
      content: { t: 'encrypted', c: await client.encryption.encrypt(raw, null) } });
    const page = [
      await wire('refusal', 3, { role: 'session', content: { id: 'refused:refused', time: 3000, role: 'agent',
        ev: { t: 'user-message-rejected', ref: 'refused', reason: 'That model is not available.' } }, meta: { sentFrom: 'rig' } }),
      await wire('refused', 2, { role: 'user', content: { type: 'text', text: 'Try it' }, meta: { permissionMode: 'read-only', expectsAcceptance: true } }),
      await wire('sent', 1, { role: 'user', content: { type: 'text', text: 'Plan it' }, meta: { permissionMode: 'plan', expectsAcceptance: true } }),
    ];
    fetchMock.mockImplementation(async () => response({ messages: page, hasMore: false }));
    // Act
    const modes = await client.findSentModes('session');
    // Assert
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
  describe('terminal control', () => {
    const switchCalls = () => socket.emitWithAck.mock.calls.filter(([event, payload]) => event === 'rpc-call' && payload.method === 'session:switch');
    async function stateUpdate(state: Json, version: number) {
      socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session',
        agentState: { version, value: await client.encryption.encrypt(state, null) } } });
      await vi.waitFor(() => expect(client.getAgentState('session').controlledByUser).toBe(state.controlledByUser));
    }
    it('should send one switch request for a local-mode CLI and accept the void reply', async () => {
      // Arrange: claude/runClaude.ts writes { ...state, controlledByUser: true } for local mode.
      session.agentState = await client.encryption.encrypt({ controlledByUser: true }, null);
      session.agentStateVersion = 1;
      await start();
      socket.emitWithAck.mockResolvedValue({ ok: true, result: await client.encryption.encrypt(undefined, null) });
      // Act
      const first = client.takeControl('session');
      const concurrent = client.takeControl('session');
      await Promise.all([first, concurrent]);
      await client.takeControl('session');
      // Assert: the CLI handler toggles the mode, so a repeat before the state changes must not reach it.
      expect(switchCalls()).toHaveLength(1);
      expect(await client.encryption.decrypt(switchCalls()[0][1].params, null)).toEqual({ to: 'remote' });
      expect(client.getSnapshot().sessions[0].terminalControl).toBe(true);
      // Act
      await stateUpdate({ controlledByUser: false }, 2);
      // Assert
      expect(client.getSnapshot().sessions[0].terminalControl).toBe(false);
      await expect(client.takeControl('session')).rejects.toThrow('The terminal does not control this session.');
      expect(switchCalls()).toHaveLength(1);
      // Act: the terminal takes control again with a double space in claudeRemoteLauncher.ts.
      await stateUpdate({ controlledByUser: true }, 3);
      await client.takeControl('session');
      // Assert
      expect(switchCalls()).toHaveLength(2);
    });
    it('should refuse a remote-mode, disconnected, or Rig session without an RPC', async () => {
      // Arrange
      const rig = { ...session, id: 'rig', metadata: await client.encryption.encrypt({ ...metadata, flavor: 'rig', client: { id: 'rig' } }, null),
        agentState: await client.encryption.encrypt({ controlledByUser: true }, null), agentStateVersion: 1 };
      const ended = { ...session, id: 'ended', active: false, agentState: rig.agentState, agentStateVersion: 1 };
      session.agentState = await client.encryption.encrypt({ controlledByUser: false }, null);
      fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
        ? response({ sessions: [session, rig, ended], hasNext: false })
        : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
      await start();
      // Act / Assert
      for (const id of ['session', 'rig', 'ended', 'missing'])
        await expect(client.takeControl(id)).rejects.toThrow('The terminal does not control this session.');
      expect(socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call')).toEqual([]);
    });
    it('should read new messages of an open chat after a control handoff', async () => {
      // Arrange
      session.agentState = await client.encryption.encrypt({ controlledByUser: true }, null);
      session.agentStateVersion = 1;
      await start();
      const stopWatching = client.watchSession('session');
      await client.loadHistory('session');
      const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/v3/sessions/session/messages')).length;
      const before = reads();
      // Act
      await stateUpdate({ controlledByUser: true, requests: {} }, 2);
      // Assert
      expect(reads()).toBe(before);
      // Act
      await stateUpdate({ controlledByUser: false }, 3);
      // Assert
      await vi.waitFor(() => expect(reads()).toBe(before + 1));
      stopWatching();
    });
  });
});

describe('private local images', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  async function prepare(options: { size?: number; content?: Uint8Array; failMetadata?: boolean } = {}) {
    await start();
    socket.connected = true;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const content = options.content || bytes;
    let metadataFails = !!options.failMetadata;
    socket.emitWithAck.mockImplementation(async (event, payload) => {
      if (event === 'update-metadata') {
        if (metadataFails) { metadataFails = false; throw new Error('Lost confirmation'); }
        return { result: 'success', version: 2 };
      }
      const params = await client.encryption.decrypt<Json>(payload.params, null);
      const result = payload.method.endsWith(':listDirectory')
        ? { success: true, entries: [{ name: 'private.png', type: 'file', size: options.size ?? content.length }] }
        : { success: true, content: base64(content) };
      expect(params.path).toMatch(/^\/real\/project/);
      expect(JSON.stringify(payload)).not.toContain('/real/project');
      return { ok: true, result: await client.encryption.encrypt(result, null) };
    });
    fetchMock.mockImplementation(async (url: string | URL) => String(url).endsWith('/attachments/request-upload')
      ? response({ ref: 'private-ref', uploadUrl: 'https://storage.test/blob' }) : new Response(null, { status: 200 }));
    fetchMock.mockClear();
  }
  it('should encrypt the file, persist its private binding, and coalesce repeated imports without sending an agent message', async () => {
    // Arrange
    await prepare();
    // Act
    const first = client.importLocalImage('session', 'reply', './private.png');
    const second = client.importLocalImage('session', 'reply', './private.png');
    const file = await first;
    // Assert
    expect(first).toBe(second);
    expect(file).toEqual({ ref: 'private-ref', name: 'private.png', size: bytes.length, type: 'image/png' });
    const calls = socket.emitWithAck.mock.calls;
    expect(calls.filter(([event]) => event === 'rpc-call')).toHaveLength(2);
    const upload = fetchMock.mock.calls.find(([url]) => String(url).endsWith('request-upload'))!;
    expect(JSON.parse(upload[1].body)).toEqual({ filename: 'image.png', size: bytes.length + 40 });
    const transfer = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://storage.test'))!;
    expect(transfer[1].headers.get('Authorization')).toBeNull();
    expect(await client.encryption.decryptBlob(transfer[1].body, null)).toEqual(bytes);
    const metadataCall = calls.find(([event]) => event === 'update-metadata')!;
    const saved = await client.encryption.decrypt<Json>(metadataCall[1].metadata, null);
    expect(saved.unknownExtension).toEqual({ keep: true });
    expect(Object.values(saved.raynoLocalImages)).toEqual([file]);
    expect(JSON.stringify(metadataCall[1])).not.toContain('private.png');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/messages'))).toBe(false);
    // Act / Assert: a saved binding needs neither a disk read nor another upload.
    socket.emitWithAck.mockClear(); fetchMock.mockClear();
    expect(await client.importLocalImage('session', 'reply', './private.png')).toEqual(file);
    expect(socket.emitWithAck).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should retry metadata persistence without reading or uploading the same image twice', async () => {
    // Arrange
    await prepare({ failMetadata: true });
    // Act
    await expect(client.importLocalImage('session', 'reply', './private.png')).rejects.toThrow('confirm');
    const reads = socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call').length;
    fetchMock.mockClear();
    await client.importLocalImage('session', 'reply', './private.png');
    // Assert
    expect(socket.emitWithAck.mock.calls.filter(([event]) => event === 'rpc-call')).toHaveLength(reads);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should reject a file outside the workspace before asking the computer to read it', async () => {
    await prepare();
    await expect(client.importLocalImage('session', 'reply', '/real/private.png')).rejects.toThrow('outside');
    expect(socket.emitWithAck).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should refuse an oversized file before reading it through the RPC', async () => {
    await prepare({ size: 4 * 1024 * 1024 + 1 });
    await expect(client.importLocalImage('session', 'reply', './private.png')).rejects.toThrow('4 MB');
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should refuse a renamed text or SVG file before uploading it', async () => {
    await prepare({ content: new TextEncoder().encode('<svg onload="alert(1)"/>') });
    await expect(client.importLocalImage('session', 'reply', './private.png')).rejects.toThrow('supported image');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('should refuse an invalid raster image before uploading it', async () => {
    await prepare();
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Bad image')));
    await expect(client.importLocalImage('session', 'reply', './private.png')).rejects.toThrow('not a valid');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe('Happy client background sync', () => {
  // A real fetch rejects with the abort reason of its signal.
  const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
  // The headers arrive, but the body never ends. Like a real fetch, an abort of the signal fails the body.
  const stalledBody = (_url: string | URL, init?: RequestInit) => {
    let fail = (_reason: unknown) => {};
    init?.signal?.addEventListener('abort', () => fail(init.signal!.reason));
    return Promise.resolve(new Response(new ReadableStream({ start: (stream) => { fail = (reason) => stream.error(reason); } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  const failSessions = () => fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
    ? response({ error: 'Could not read the workspace. Try again.' }, 503)
    : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(window, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    vi.spyOn(Math, 'random').mockReturnValue(1);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('should name the timeout instead of an abort without a reason', async () => {
    // Arrange
    await start();
    fetchMock.mockImplementation(hang);
    // Act
    const read = client.refresh(true);
    const result = expect(read).rejects.toThrow('Happy did not answer within 25 seconds.');
    await vi.advanceTimersByTimeAsync(25000);
    // Assert
    await result;
  });
  it('should time out a response whose body stalls after the headers', async () => {
    // Arrange
    await start();
    fetchMock.mockImplementation(stalledBody);
    // Act
    const read = client.refresh(true);
    const result = expect(read).rejects.toThrow('Happy did not answer within 25 seconds.');
    await vi.advanceTimersByTimeAsync(25000);
    // Assert
    await result;
  });
  it('should cancel a stalled response body when the client closes', async () => {
    // Arrange
    await start();
    fetchMock.mockImplementation(stalledBody);
    const read = client.refresh(true);
    const result = expect(read).rejects.toThrow('The connection closed before Happy answered.');
    await vi.advanceTimersByTimeAsync(0);
    // Act
    client.dispose();
    // Assert
    await result;
  });
  it('should time out an image download whose body stalls after the headers', async () => {
    // Arrange
    await start();
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => String(url).includes('request-download')
      ? response({ downloadUrl: 'https://happy.test/blob' }) : stalledBody(url, init));
    // Act
    const image = client.loadImage('session', 'image-ref');
    const result = expect(image).rejects.toThrow('The image server did not answer within 45 seconds.');
    // The download timer starts after the cache read and the download request.
    const downloading = () => fetchMock.mock.calls.some(([url]) => String(url) === 'https://happy.test/blob');
    for (let step = 0; step < 50 && !downloading(); step++) await vi.advanceTimersByTimeAsync(0);
    expect(downloading()).toBe(true);
    await vi.advanceTimersByTimeAsync(45000);
    // Assert
    await result;
  });
  it('should not save the offline cache for activity events alone', async () => {
    // Arrange
    await start();
    await vi.advanceTimersByTimeAsync(1000);
    const save = vi.spyOn(OfflineCache.prototype, 'save').mockResolvedValue(true);
    // Act
    for (let index = 0; index < 100; index++) {
      socket.handlers.get('ephemeral')!({ type: 'activity', id: 'session', active: true, activeAt: 1000 + index, thinking: index % 2 === 0 });
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(1000);
    const afterActivity = save.mock.calls.length;
    socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session', metadata: { version: 2,
      value: await client.encryption.encrypt({ ...metadata, summary: { text: 'Saved title' } }, null) } } });
    await vi.advanceTimersByTimeAsync(1000);
    // Assert
    expect(afterActivity).toBe(0);
    expect(client.getSnapshot().sessions[0].status).toBe('idle');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].sessions[0].wire.activeAt).toBe(1099);
  });
  it('should keep a loaded workspace quiet while background reads fail, warn after three failures, and recover', async () => {
    // Arrange
    await start();
    failSessions();
    // Act
    socket.handlers.get('connect')!();
    await vi.advanceTimersByTimeAsync(0);
    const first = client.getSnapshot().error;
    await vi.advanceTimersByTimeAsync(1000);
    const second = client.getSnapshot().error;
    await vi.advanceTimersByTimeAsync(2000);
    const third = client.getSnapshot().error;
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
    await vi.advanceTimersByTimeAsync(4000);
    // Assert
    expect([first, second]).toEqual(['', '']);
    expect(third).toBe('Could not read the workspace. Try again.');
    expect(client.getSnapshot()).toMatchObject({ error: '', loading: false });
    expect(client.getSnapshot().sessions.map((row) => row.id)).toEqual(['session']);
  });
  it('should keep a loaded chat free of the failure notice while its background update fails', async () => {
    // Arrange
    await start();
    client.watchSession('session');
    await vi.waitFor(() => expect(client.getSnapshot().histories.session?.loaded).toBe(true));
    fetchMock.mockImplementation(async (url: string) => url.includes('/messages')
      ? response({ error: 'Internal Server Error' }, 500)
      : url.includes('/v2/sessions') ? response({ sessions: [session], hasNext: false }) : response([]));
    // Act
    socket.handlers.get('connect')!();
    await vi.advanceTimersByTimeAsync(0);
    // Assert
    expect(client.getSnapshot().histories.session).toMatchObject({ loading: false, loaded: true, error: '' });
    expect(client.getSnapshot().error).toBe('');
  });
  it('should show a manual retry failure at once and keep retrying in the background', async () => {
    // Arrange
    await start();
    failSessions();
    // Act
    await client.retry();
    const shown = client.getSnapshot().error;
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([]) : response({ messages: [], hasMore: false }));
    await vi.advanceTimersByTimeAsync(1000);
    // Assert
    expect(shown).toBe('Could not read the workspace. Try again.');
    expect(client.getSnapshot()).toMatchObject({ error: '', retrying: false });
  });
  it('should not warn about a request that going offline stopped', async () => {
    // Arrange
    const events = new Map<string, () => void>();
    vi.mocked(window.addEventListener).mockImplementation((name: string, handler: any) => { events.set(name, handler); });
    await start();
    fetchMock.mockImplementation(hang);
    // Act
    socket.handlers.get('connect')!();
    await vi.advanceTimersByTimeAsync(0);
    events.get('offline')!();
    await vi.advanceTimersByTimeAsync(60000);
    // Assert
    expect(client.getSnapshot()).toMatchObject({ offline: true, error: '' });
  });
});
describe('Happy client request load', () => {
  const reads = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part)).length;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(window, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('should read the activity of a working session once per burst of session updates', async () => {
    // Arrange
    await start();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();
    // Act: the CLI writes a message, then changes its agent state, ten times in a row.
    for (let seq = 1; seq <= 10; seq++) {
      socket.handlers.get('update')!({ body: { t: 'new-message', sid: 'session', message: await wireMessage(`m${seq}`, seq, `Step ${seq}`) } });
      socket.handlers.get('update')!({ body: { t: 'update-session', id: 'session',
        agentState: { version: seq, value: await client.encryption.encrypt({ step: seq }, null) } } });
      await vi.advanceTimersByTimeAsync(100);
    }
    const duringBurst = reads('/messages');
    await vi.advanceTimersByTimeAsync(5000);
    // Assert
    expect(duringBurst).toBe(0);
    expect(reads('/messages')).toBe(1);
    expect(reads('/v2/sessions')).toBe(0);
  });
  it('should apply a computer update in place and read only the computer list for a new computer', async () => {
    // Arrange
    const computer = { id: 'computer', active: true, metadataVersion: 1, dataEncryptionKey: null,
      metadata: await client.encryption.encrypt({ host: 'Old name' }, null) };
    fetchMock.mockImplementation(async (url: string) => url.includes('/v2/sessions')
      ? response({ sessions: [session], hasNext: false })
      : url.endsWith('/v1/machines') ? response([computer]) : response({ messages: [], hasMore: false }));
    await start();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();
    // Act
    socket.handlers.get('update')!({ body: { t: 'update-machine', machineId: 'computer',
      daemonState: { version: 4, value: await client.encryption.encrypt({ status: 'running' }, null) } } });
    socket.handlers.get('update')!({ body: { t: 'update-machine', machineId: 'computer',
      metadata: { version: 2, value: await client.encryption.encrypt({ host: 'New name' }, null) } } });
    await vi.waitFor(() => expect(client.getSnapshot().machines[0]?.name).toBe('New name'));
    const inPlace = fetchMock.mock.calls.length;
    socket.handlers.get('update')!({ body: { t: 'new-machine', machineId: 'second' } });
    await vi.waitFor(() => expect(reads('/v1/machines')).toBe(1));
    // Assert
    expect(inPlace).toBe(0);
    expect(reads('/v2/sessions')).toBe(0);
    expect(reads('/messages')).toBe(0);
  });
});
