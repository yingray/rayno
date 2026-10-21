import type { Page, WebSocketRoute } from '@playwright/test';
import sodium from 'libsodium-wrappers';
import { base64, deriveKey, HappyCrypto, unbase64 } from '../../src/happy/crypto';
import { DEFAULT_SERVER } from '../../src/happy/auth';
import type { Json } from '../../src/happy/normalize';

// Browser contract fixture. All requests stay inside the isolated test context.
export class HappyServer {
  readonly secret = new Uint8Array(32).fill(11);
  readonly dataKey = new Uint8Array(32).fill(12);
  readonly credentials = {
    server: DEFAULT_SERVER,
    token: 'browser-fixture-token',
    secret: base64(this.secret, true),
  };
  encryption!: HappyCrypto;
  sessions: Json[] = [];
  messages: Json[] = [];
  private otherMessages = new Map<string, Json[]>();
  socket: WebSocketRoute | null = null;
  requests: { path: string; method: string }[] = [];
  mutations: string[] = [];
  usageReads = 0;
  usageReady: Promise<void> = Promise.resolve();
  usageFailure = false;
  usagePercent = 25;
  codexPercent = 31;
  sends: Json[] = [];
  failFirstSend = false;
  abortReply: unknown = undefined;
  authorized = false;
  denied = false;
  permissionReplies = 0;
  communicationReplies: Json[] = [];
  machineActive = true;
  machineMetadata: Json = { host: 'Real computer', platform: 'darwin', homeDir: '/real' };
  spawns: Json[] = [];
  bashCommands: Json[] = [];
  worktreeListing = '';
  workspaceReady: Promise<void> = Promise.resolve();
  workspaceFailure = false;
  async install(page: Page, signedIn = true) {
    this.encryption = await HappyCrypto.create(this.secret);
    await sodium.ready;
    const recipient = sodium.crypto_box_seed_keypair(
      await deriveKey(this.secret, 'Happy EnCoder', ['content']),
    );
    const sender = sodium.crypto_box_seed_keypair(new Uint8Array(32).fill(13));
    const nonce = new Uint8Array(24).fill(14);
    const wrapped = base64(
      new Uint8Array([
        0,
        ...sender.publicKey,
        ...nonce,
        ...sodium.crypto_box_easy(this.dataKey, nonce, recipient.publicKey, sender.privateKey),
      ]),
    );
    const metadata = {
      path: '/real/project',
      machineId: 'computer',
      flavor: 'claude',
      summary: { text: 'Connected workspace' },
      models: [{ code: 'model-from-daemon', value: 'Model from daemon' }],
    };
    this.sessions = [
      {
        id: 'real-session',
        seq: 3,
        active: true,
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        metadata: await this.encryption.encrypt(metadata, this.dataKey),
        metadataVersion: 1,
        agentState: await this.encryption.encrypt(
          { requests: { permission: { tool: 'Read', arguments: { file: 'README.md' } } } },
          this.dataKey,
        ),
        agentStateVersion: 1,
        dataEncryptionKey: wrapped,
      },
      {
        id: 'older-session',
        seq: 0,
        active: false,
        createdAt: 1690000000000,
        updatedAt: 1690000001000,
        metadata: await this.encryption.encrypt(
          { ...metadata, summary: { text: 'Older workspace' } },
          null,
        ),
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
      },
    ];
    this.messages = [
      await this.message('first', 1, {
        role: 'user',
        content: { type: 'text', text: 'Earlier message' },
      }),
      await this.message('reply', 2, {
        role: 'session',
        content: { role: 'agent', ev: { t: 'text', text: 'From the real protocol' } },
      }),
      await this.message('receipt', 3, {
        role: 'session',
        content: { role: 'agent', ev: { t: 'user-message-accepted', ref: 'first' } },
      }),
    ];
    await page.addInitScript(
      ({ credentials, signedIn }) => {
        localStorage.setItem('rayno.mode', 'live');
        // App-state checks can keep the static test server online for WebKit reloads.
        if (localStorage.getItem('fixture.online') === 'false')
          Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        if (signedIn && !sessionStorage.getItem('fixture.initialized')) {
          localStorage.setItem('rayno.credentials', JSON.stringify(credentials));
          sessionStorage.setItem('fixture.initialized', 'true');
        }
      },
      { credentials: this.credentials, signedIn },
    );
    await page.route('https://api.cluster-fluster.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      this.requests.push({ path: path + url.search, method });
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(body),
        });
      if (method === 'OPTIONS') return json({});
      if (path === '/v1/auth/account/request') {
        if (!this.authorized) return json({ state: 'requested' });
        const publicKey = unbase64(request.postDataJSON().publicKey);
        const sender = sodium.crypto_box_seed_keypair(new Uint8Array(32).fill(15));
        const nonce = new Uint8Array(24).fill(16);
        return json({
          state: 'authorized',
          token: this.credentials.token,
          response: base64(
            new Uint8Array([
              ...sender.publicKey,
              ...nonce,
              ...sodium.crypto_box_easy(this.secret, nonce, publicKey, sender.privateKey),
            ]),
          ),
        });
      }
      if (this.denied) return json({ error: 'Expired authorization' }, 401);
      if (path === '/v2/sessions') {
        await this.workspaceReady;
        if (this.workspaceFailure) return json({ error: 'Could not read the workspace. Try again.' }, 503);
        if (this.sessions.length <= 1) return json({ sessions: this.sessions, hasNext: false });
        return url.searchParams.has('cursor')
          ? json({ sessions: this.sessions.slice(1), hasNext: false })
          : json({
              sessions: this.sessions.slice(0, 1),
              nextCursor: 'cursor_v1_real-session',
              hasNext: true,
            });
      }
      if (path === '/v1/machines')
        return json([
          {
            id: 'computer',
            active: this.machineActive,
            metadata: await this.encryption.encrypt(
              this.machineMetadata,
              null,
            ),
            metadataVersion: 1,
            dataEncryptionKey: null,
          },
        ]);
      if (/^\/v3\/sessions\/[^/]+\/messages$/.test(path)) {
        const sessionId = path.split('/')[3];
        const session = this.sessions.find((session) => session.id === sessionId)!;
        const storedMessages = sessionId === 'real-session' ? this.messages : this.otherMessages.get(sessionId) || [];
        if (sessionId !== 'real-session') this.otherMessages.set(sessionId, storedMessages);
        if (method === 'POST') {
          this.mutations.push('send');
          const packet = request.postDataJSON().messages[0];
          this.sends.push(packet);
          let stored = storedMessages.find((message) => message.localId === packet.localId);
          if (!stored) {
            stored = {
              id: 'sent-' + packet.localId,
              seq: ++session.seq,
              localId: packet.localId,
              createdAt: 1700000002000,
              content: { t: 'encrypted', c: packet.content },
            };
            storedMessages.push(stored);
          }
          if (this.failFirstSend && this.sends.length === 1)
            return json({ error: 'Send confirmation lost. Retry this draft.' }, 503);
          return json({ messages: [{ ...stored, content: undefined }] });
        }
        const before = Number(url.searchParams.get('before_seq'));
        const after = url.searchParams.get('after_seq');
        const candidates = storedMessages.filter((message) => after !== null
          ? message.seq > Number(after) : message.seq < before)
          .sort((a, b) => after !== null ? a.seq - b.seq : b.seq - a.seq);
        const limit = Number(url.searchParams.get('limit') || 100);
        // Keep one older item for the history-page flow, with valid cursors.
        const size = after === null && before === 2147483647 && candidates.length > 1 && candidates.length <= limit
          ? candidates.length - 1 : limit;
        const messages = candidates.slice(0, size);
        return json({ messages, hasMore: candidates.length > messages.length });
      }
      if (/^\/v1\/sessions\/[^/]+\/archive$/.test(path)) {
        this.mutations.push('archive');
        this.sessions[0].active = false;
        return json({ success: true });
      }
      if (/^\/v1\/sessions\/[^/]+$/.test(path) && method === 'DELETE') {
        this.mutations.push('delete');
        this.sessions = this.sessions.filter((session) => session.id !== path.split('/')[3]);
        return json({ success: true });
      }
      return json({ error: `Unhandled fixture request: ${method} ${path}` }, 500);
    });
    await page.routeWebSocket('wss://api.cluster-fluster.com/**', (socket) => {
      this.socket = socket;
      socket.send(
        '0' +
          JSON.stringify({
            sid: 'engine-fixture',
            upgrades: [],
            pingInterval: 60000,
            pingTimeout: 60000,
            maxPayload: 1000000,
          }),
      );
      socket.onMessage(async (message) => {
        const frame = String(message);
        if (frame.startsWith('40')) {
          socket.send('40{"sid":"socket-fixture"}');
          return;
        }
        if (frame === '2') {
          socket.send('3');
          return;
        }
        const match = frame.match(/^42(\d*)(\[.*)$/s);
        if (!match) return;
        const [event, payload] = JSON.parse(match[2]);
        if (!match[1]) return;
        let answer: Json = {};
        if (event === 'update-metadata') {
          this.mutations.push('metadata');
          const session = this.sessions.find((session) => session.id === payload.sid)!;
          session.metadata = payload.metadata;
          session.metadataVersion++;
          answer = { result: 'success', version: session.metadataVersion };
        } else if (event === 'rpc-call') {
          const machine = payload.method.startsWith('computer:');
          const key = machine ? null : this.dataKey;
          const params = await this.encryption.decrypt<Json>(payload.params, key);
          const usageRead = payload.method.endsWith(':bash') && params.command.includes('HAPPY_CLI_DIR=');
          if (usageRead) {
            this.usageReads++;
            await this.usageReady;
          }
          else this.mutations.push(payload.method);
          if (payload.method.endsWith(':bash') && !usageRead) this.bashCommands.push(params);
          let result: unknown = payload.method.endsWith(':abort') ? this.abortReply : {};
          if (payload.method.endsWith(':permission')) {
            this.permissionReplies++;
            const session = this.sessions.find((session) => session.id === payload.method.split(':')[0])!;
            const state = await this.encryption.decrypt<Json>(session.agentState, this.dataKey);
            delete state.requests?.[params.id];
            session.agentState = await this.encryption.encrypt(state, this.dataKey);
            session.agentStateVersion++;
          }
          if (payload.method.endsWith(':communication')) {
            this.communicationReplies.push(params);
            const session = this.sessions.find((session) => session.id === payload.method.split(':')[0])!;
            const state = await this.encryption.decrypt<Json>(session.agentState, this.dataKey);
            delete state.communications?.[params.id];
            session.agentState = await this.encryption.encrypt(state, this.dataKey);
            session.agentStateVersion++;
          }
          if (payload.method.endsWith(':listDirectory'))
            result = { success: true, entries: [{ name: 'README.md', type: 'file', size: 17 }] };
          if (payload.method.endsWith(':readFile'))
            result = {
              success: true,
              content: base64(new TextEncoder().encode('Real file content')),
            };
          if (payload.method.endsWith(':bash'))
            result = {
              success: true,
              exitCode: 0,
              stdout: params.command.includes('HAPPY_CLI_DIR=')
                ? JSON.stringify({
                    capturedAt: Date.now(),
                    claude: this.usageFailure ? { ok: false, error: 'Usage unavailable' } : {
                      ok: true,
                      data: {
                        seven_day: {
                          utilization: this.usagePercent,
                          resets_at: new Date(Date.now() + 3 * 86400000).toISOString(),
                        },
                      },
                    },
                    codex: this.usageFailure ? { ok: false, error: 'Codex unavailable' } : {
                      ok: true, data: { rateLimits: { secondary: {
                        usedPercent: this.codexPercent, windowDurationMins: 10080,
                        resetsAt: Math.round((Date.now() + 3 * 86400000) / 1000),
                      } } },
                    },
                  })
                : params.command === 'git worktree list --porcelain'
                  ? this.worktreeListing
                : params.command.includes('power_source=')
                  ? 'os=Darwin\nbattery=77%; charging;\npower_source=AC Power\niface=en0\niface_port=Wi-Fi\nip=192.0.2.1\n'
                  : 'M README.md',
              stderr: '',
            };
          if (payload.method.endsWith(':spawn-happy-session')) {
            this.spawns.push(params);
            const session = {
              ...this.sessions[0],
              id: 'created-session',
              seq: 0,
              agentState: null,
              agentStateVersion: 0,
              metadata: await this.encryption.encrypt(
                { ...metadata, flavor: params.agent, path: params.directory, summary: { text: 'Created workspace' },
                  modelMode: params.modelMode, effortLevel: params.effortLevel,
                  ...(params.agent === 'rig' ? {
                    flavor: 'rig', client: { id: 'rig' }, models: this.machineMetadata.models,
                    currentModelCode: params.modelId, currentModelProviderId: params.providerId,
                    reasoning: { current: params.effort, levels: [] },
                  } : {}),
                },
                this.dataKey,
              ),
            };
            this.sessions.unshift(session);
            result = { type: 'success', sessionId: session.id };
          }
          if (payload.method.endsWith(':killSession')) result = { success: true };
          answer = { ok: true, result: await this.encryption.encrypt(result, key) };
        }
        socket.send('43' + match[1] + JSON.stringify([answer]));
      });
    });
  }
  private async message(id: string, seq: number, raw: Json, sessionId = 'real-session', createdAt = 1700000001000) {
    const key = this.sessions.find((session) => session.id === sessionId)?.dataEncryptionKey ? this.dataKey : null;
    return {
      id,
      seq,
      createdAt,
      content: { t: 'encrypted', c: await this.encryption.encrypt(raw, key) },
    };
  }
  async setMessages(raw: Json[], sessionId = 'real-session') {
    this.sessions.find((session) => session.id === sessionId)!.seq = raw.length;
    const messages = await Promise.all(raw.map((message, index) =>
      this.message(`fixture-${index + 1}`, index + 1, message, sessionId),
    ));
    if (sessionId === 'real-session') this.messages = messages;
    else this.otherMessages.set(sessionId, messages);
  }
  async pushReply(text: string) {
    await this.pushEvent({
      role: 'agent',
      content: { type: 'codex', data: { type: 'message', message: text } },
    });
  }
  async setWorking(thinking: boolean) {
    const session = this.sessions.find((session) => session.id === 'real-session')!;
    session.agentState = await this.encryption.encrypt({ thinking }, this.dataKey);
    session.agentStateVersion++;
    this.socket?.send('42' + JSON.stringify(['ephemeral', {
      type: 'activity', id: session.id, active: session.active,
      activeAt: Date.now(), thinking,
    }]));
  }
  setSessionActive(id: string, active: boolean) {
    this.sessions.find((session) => session.id === id)!.active = active;
    this.socket?.send('42' + JSON.stringify(['ephemeral', {
      type: 'activity', id, active, activeAt: Date.now(), thinking: false,
    }]));
  }
  async updateMetadata(patch: Json) {
    const session = this.sessions.find((session) => session.id === 'real-session')!;
    const metadata = await this.encryption.decrypt<Json>(session.metadata, this.dataKey);
    session.metadata = await this.encryption.encrypt({ ...metadata, ...patch }, this.dataKey);
    session.metadataVersion++;
    this.socket?.send('42' + JSON.stringify(['update', { body: { t: 'update-session', sid: session.id } }]));
  }
  async updateAgentState(state: Json) {
    const session = this.sessions.find((session) => session.id === 'real-session')!;
    session.agentState = await this.encryption.encrypt(state, this.dataKey);
    session.agentStateVersion++;
    this.socket?.send('42' + JSON.stringify(['update', { body: {
      t: 'update-session', id: session.id,
      agentState: { version: session.agentStateVersion, value: session.agentState },
    } }]));
  }
  setMachineActive(active: boolean) {
    this.machineActive = active;
    this.socket?.send('42' + JSON.stringify(['ephemeral', { type: 'machine-activity', id: 'computer', active }]));
  }
  async pushEvent(raw: Json, sessionId = 'real-session', broadcast = true, createdAt?: number) {
    const seq = ++this.sessions.find((session) => session.id === sessionId)!.seq;
    const message = await this.message('pushed-' + seq, seq, raw, sessionId, createdAt);
    if (sessionId === 'real-session') this.messages.push(message);
    else this.otherMessages.set(sessionId, [...(this.otherMessages.get(sessionId) || []), message]);
    if (!broadcast) return;
    this.socket?.send(
      '42' +
        JSON.stringify(['update', { body: { t: 'new-message', sid: sessionId, message } }]),
    );
  }
}
