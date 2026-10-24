import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import type { Page, WebSocketRoute } from '@playwright/test';
import sodium from 'libsodium-wrappers';
import { base64, deriveKey, HappyCrypto, unbase64 } from '../../src/happy/crypto';
import { DEFAULT_SERVER } from '../../src/happy/auth';
import type { Json } from '../../src/happy/normalize';

const receipt = (ref: string, runId: string, reason?: string): Json => ({
  role: 'session',
  content: reason === undefined
    ? { id: 'accepted:' + ref, time: 1700000001000, role: 'agent', ev: { t: 'user-message-accepted', id: 'durable-' + ref, ref, runId } }
    : { id: 'refused:' + ref, time: 1700000001000, role: 'agent', ev: { t: 'user-message-rejected', ref, reason } },
  meta: { sentFrom: 'rig' },
});

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
  usageQueries: Json[] = [];
  reportFailure = false;
  machineRemoved = false;
  machineVersion = 1;
  usageReady: Promise<void> = Promise.resolve();
  usageFailure = false;
  usagePercent = 25;
  codexPercent = 31;
  // The 5-hour windows that Claude get_usage and Codex account/rateLimits/read also report.
  fiveHourPercent = 12;
  codexFiveHourPercent = 44;
  // False when a plan reports only its 5-hour window: Claude sends `seven_day: null` and Codex sends no secondary window.
  weekReported = true;
  sends: Json[] = [];
  failFirstSend = false;
  abortReply: unknown = undefined;
  authorized = false;
  denied = false;
  permissionReplies = 0;
  permissionPayloads: Json[] = [];
  resumeRequests: Json[] = [];
  switchRequests: Json[] = [];
  switchReply: unknown = undefined;
  resumeFailure = false;
  uploadMethod: 'PUT' | 'POST' = 'PUT';
  uploadFailure = false;
  uploadRequests: Json[] = [];
  uploadHeaders: Record<string, string>[] = [];
  blobs = new Map<string, Buffer>();
  localImages = new Map<string, Uint8Array>();
  localImageReads: string[] = [];
  localImageReadFailure = false;
  private storageUrl = '';
  private storageServer?: ReturnType<typeof createServer>;
  communicationReplies: Json[] = [];
  machineActive = true;
  machineMetadata: Json = { host: 'Real computer', platform: 'darwin', homeDir: '/real' };
  spawns: Json[] = [];
  missingDirectories: string[] = [];
  branchCalls: { method: string; params: Json }[] = [];
  failBranchSpawn = false;
  rewindPoints = Array.from({ length: 18 }, (_, index) => ({ uuid: `claude-${index}`, itemId: `codex-${index}`, text: `Message ${index}: review the workspace`, timestamp: 1700000000000 + index * 1000 }));
  bashCommands: Json[] = [];
  goalActions: Json[] = [];
  goalFailure = '';
  // `rg --files --follow` output from the CLI `ripgrep` handler (modules/common/registerCommonHandlers.ts).
  ripgrepStdout = 'src/app/App.tsx\nsrc/app/app.module.css\nsrc/components/Panel.tsx\nREADME.md\n';
  ripgrepCalls: Json[] = [];
  worktreeListing = '';
  // `git status --porcelain` output for a worktree check. Other commands keep the dirty default.
  gitStatus = ' M README.md\n';
  workspaceReady: Promise<void> = Promise.resolve();
  workspaceFailure = false;
  historyFailure = false;
  historyReady: Promise<void> = Promise.resolve();
  async install(page: Page, signedIn = true) {
    page.on('close', () => { this.storageServer?.closeAllConnections(); this.storageServer?.close(); });
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
      // happy-agent puts the receipt where the agent took the message, before its reply.
      await this.message('receipt', 2, receipt('first', 'run-first')),
      await this.message('reply', 3, {
        role: 'session',
        content: { role: 'agent', turn: 't1', ev: { t: 'text', text: 'From the real protocol' } },
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
      if (path === '/v1/usage/query' && method === 'POST') {
        this.usageQueries.push(request.postDataJSON());
        return this.reportFailure ? json({error:'Usage report unavailable'},503) : json({usage:[
          {timestamp:Math.floor(Date.now()/1000)-86400,tokens:{'claude-test':1200,'codex-test':300},cost:{'claude-test':0.12,'codex-test':0.03},reportCount:2},
          {timestamp:Math.floor(Date.now()/1000),tokens:{'claude-test':500},cost:{'claude-test':0.05},reportCount:1},
        ]});
      }
      if (path === '/v1/machines/computer' && method === 'DELETE') {
        this.machineRemoved=true;this.mutations.push('delete-machine');return json({success:true});
      }
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
        return json(this.machineRemoved ? [] : [
          {
            id: 'computer',
            active: this.machineActive,
            metadata: await this.encryption.encrypt(
              this.machineMetadata,
              null,
            ),
            metadataVersion: this.machineVersion,
            dataEncryptionKey: null,
          },
        ]);
      if (path.endsWith('/attachments/request-upload')) {
        await this.startStorage();
        this.uploadRequests.push(request.postDataJSON());
        const ref = `image-${this.uploadRequests.length}`;
        return json({ ref, uploadUrl: `${this.storageUrl}/${ref}`, method: this.uploadMethod,
          ...(this.uploadMethod === 'POST' ? { formFields: { key: ref, policy: 'fixture-policy' } } : {}),
        });
      }
      if (path.endsWith('/attachments/request-download')) {
        return json({ downloadUrl: `${this.storageUrl}/${request.postDataJSON().ref}` });
      }
      if (/^\/v3\/sessions\/[^/]+\/messages$/.test(path)) {
        const sessionId = path.split('/')[3];
        const session = this.sessions.find((session) => session.id === sessionId)!;
        const storedMessages = sessionId === 'real-session' ? this.messages : this.otherMessages.get(sessionId) || [];
        if (sessionId !== 'real-session') this.otherMessages.set(sessionId, storedMessages);
        if (method === 'POST') {
          this.mutations.push('send');
          const packets = request.postDataJSON().messages;
          const receipts: Json[] = [];
          for (const packet of packets) {
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
          receipts.push({ ...stored, content: undefined });
          }
          if (this.failFirstSend) { this.failFirstSend = false;
            return json({ error: 'Send confirmation lost. Retry this draft.' }, 503); }
          return json({ messages: receipts });
        }
        await this.historyReady;
        if (this.historyFailure) return json({ error: 'Internal Server Error' }, 500);
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
        this.sessions.find((session) => session.id === path.split('/')[3])!.active = false;
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
        if (event === 'machine-update-metadata') {
          this.machineMetadata=await this.encryption.decrypt<Json>(payload.metadata,null);
          this.machineVersion++;this.mutations.push('rename-machine');
          answer={result:'success',version:this.machineVersion,metadata:payload.metadata};
        } else if (event === 'update-metadata') {
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
          if (payload.method.endsWith(':ripgrep')) this.ripgrepCalls.push(params);
          else if (usageRead) {
            this.usageReads++;
            await this.usageReady;
          }
          else this.mutations.push(payload.method);
          if (payload.method.endsWith(':bash') && !usageRead) this.bashCommands.push(params);
          let result: unknown = payload.method.endsWith(':abort') ? this.abortReply : {};
          if (payload.method.endsWith(':permission')) {
            // The CLI permission handler returns void, which encrypts as an empty plaintext.
            result = undefined;
            this.permissionReplies++;
            this.permissionPayloads.push(params);
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
          if (payload.method.endsWith(':goal-action')) {
            // happy-cli claude/runClaude.ts: the handler resolves after the new goal status reaches the agent state.
            this.goalActions.push(params);
            if (this.goalFailure) result = { error: this.goalFailure };
            else {
              const session = this.sessions.find((session) => session.id === payload.method.split(':')[0])!;
              const state = await this.encryption.decrypt<Json>(session.agentState, this.dataKey);
              const goal = state.agentGoalStatus;
              await this.updateAgentState({ ...state, agentGoalStatus: params.action === 'clear'
                ? { source: goal.source, observedAt: Date.now(), sourceSessionId: goal.sourceSessionId, status: 'inactive', reason: 'cleared' }
                : { ...goal, observedAt: Date.now(), text: params.objective } });
              result = { ok: true };
            }
          }
          if (payload.method.endsWith(':ripgrep'))
            result = { success: true, exitCode: 0, stdout: this.ripgrepStdout, stderr: '' };
          if (payload.method.endsWith(':listDirectory')) {
            const images = [...this.localImages].filter(([path]) => path.slice(0, path.lastIndexOf('/')) === params.path);
            result = { success: true, entries: images.length ? images.map(([path, data]) => ({ name: path.slice(path.lastIndexOf('/') + 1), type: 'file', size: data.length }))
              : [{ name: 'README.md', type: 'file', size: 17 }] };
          }
          if (payload.method.endsWith(':readFile')) {
            this.localImageReads.push(params.path);
            result = this.localImageReadFailure ? { success: false, error: 'File unavailable' } : {
              success: true, content: base64(this.localImages.get(params.path) || new TextEncoder().encode('Real file content')),
            };
          }
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
                        five_hour: {
                          utilization: this.fiveHourPercent,
                          resets_at: new Date(Date.now() + 2 * 3600000).toISOString(),
                        },
                        seven_day_opus: null,
                        seven_day: this.weekReported ? {
                          utilization: this.usagePercent,
                          resets_at: new Date(Date.now() + 3 * 86400000).toISOString(),
                        } : null,
                      },
                    },
                    codex: this.usageFailure ? { ok: false, error: 'Codex unavailable' } : {
                      ok: true, data: { rateLimits: { primary: {
                        usedPercent: this.codexFiveHourPercent, windowDurationMins: 300,
                        resetsAt: Math.round((Date.now() + 3 * 3600000) / 1000),
                      }, secondary: this.weekReported ? {
                        usedPercent: this.codexPercent, windowDurationMins: 10080,
                        resetsAt: Math.round((Date.now() + 3 * 86400000) / 1000),
                      } : null } },
                    },
                  })
                : params.command === 'git worktree list --porcelain'
                  ? this.worktreeListing
                : params.command === 'git status --porcelain'
                  ? this.gitStatus
                : params.command.includes('power_source=')
                  ? 'os=Darwin\nbattery=77%; charging;\npower_source=AC Power\niface=en0\niface_port=Wi-Fi\nip=192.0.2.1\n'
                  : 'M README.md',
              stderr: '',
            };
          if (/:(claude-list-rewind-points|codex-list-rewind-points)$/.test(payload.method))
            result = { type: 'success', points: this.rewindPoints };
          if (/:(claude-fork-session|claude-duplicate-session|codex-fork-thread|codex-duplicate-thread)$/.test(payload.method)) {
            this.branchCalls.push({ method: payload.method, params });
            result = { type: 'success', newClaudeSessionId: 'copied-claude-id', newCodexThreadId: 'copied-codex-id' };
          }
          if (payload.method.endsWith(':spawn-happy-session')) {
            this.spawns.push(params);
            if (params.parentSessionId && this.failBranchSpawn) {
              this.failBranchSpawn = false;
              result = { type: 'error', errorMessage: 'The copied conversation could not start. Retry.' };
            } else if (this.missingDirectories.includes(params.directory) && !params.approvedNewDirectoryCreation) {
              // happy-cli daemon/run.ts spawnSession: a missing folder needs approval first.
              result = { type: 'requestToApproveDirectoryCreation', directory: params.directory };
            } else {
            const session = {
              ...this.sessions[0],
              id: 'created-session',
              seq: 0,
              agentState: null,
              agentStateVersion: 0,
              metadata: await this.encryption.encrypt(
                // happy-cli runClaude/runCodex: HAPPY_SIDE_CHAT adds isSideChat, and a side chat starts without a summary.
                { ...metadata, flavor: params.agent, path: params.directory, summary: params.isSideChat ? undefined : { text: 'Created workspace' },
                  ...(params.isSideChat ? { isSideChat: true } : {}),
                  modelMode: params.modelMode, effortLevel: params.effortLevel,
                  parentSessionId: params.parentSessionId, claudeSessionId: params.resumeClaudeSessionId, codexThreadId: params.resumeCodexThreadId,
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
          }
          if (payload.method.endsWith(':switch')) {
            // claudeLocalLauncher.ts registers a void handler. runClaude.ts reports the new mode after the launcher exits.
            result = this.switchReply;
            this.switchRequests.push(params);
          }
          if (payload.method.endsWith(':resume-happy-session')) {
            this.resumeRequests.push(params);
            const resumed = this.sessions.find(session => session.id === params.sessionId)!;
            if (this.resumeFailure) result = { type: 'error', errorMessage: 'Recovery failed. Try again.' };
            else { resumed.active = true; result = { type: 'success', sessionId: resumed.id }; }
          }
          if (payload.method.endsWith(':killSession')) {
            // Like registerKillSessionHandler and runClaude cleanup({ archive: true }) in happy-cli.
            result = { success: true, message: 'Killing happy-cli process' };
            const killed = this.sessions.find((session) => session.id === payload.method.split(':')[0]);
            if (killed) {
              const killedKey = killed.dataEncryptionKey ? this.dataKey : null;
              const current = await this.encryption.decrypt<Json>(killed.metadata, killedKey);
              // A bot is a Rig session. Its agent is not in the Happy repo, so the client must not count on an archive marker.
              if (!current.bot) {
                killed.metadata = await this.encryption.encrypt({ ...current, lifecycleState: 'archived',
                  lifecycleStateSince: Date.now(), archivedBy: 'cli', archiveReason: 'User terminated' }, killedKey);
                killed.metadataVersion++;
                this.socket?.send('42' + JSON.stringify(['update', { body: { t: 'update-session', id: killed.id,
                  metadata: { version: killed.metadataVersion, value: killed.metadata } } }]));
              }
              this.setSessionActive(killed.id, false);
            }
          }
          answer = { ok: true, result: await this.encryption.encrypt(result, key) };
        }
        socket.send('43' + match[1] + JSON.stringify([answer]));
      });
    });
  }
  /** Serve an attachment blob for a download, as if an earlier upload stored it. */
  async serveBlob(ref: string, data: Uint8Array) {
    if (!this.storageUrl) await this.startStorage();
    this.blobs.set(ref, Buffer.from(data));
  }
  private async startStorage() {
    if (this.storageServer) return;
    // A real HTTP sink exercises multipart bytes and CORS in WebKit. Route
    // interception omits file parts there, so it cannot verify this contract.
    const server = createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (request.method === 'OPTIONS') { response.end(); return; }
      const ref = request.url!.slice(1);
      if (request.method === 'GET') {
        const blob = this.blobs.get(ref);
        response.writeHead(blob ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
        response.end(blob); return;
      }
      this.uploadHeaders.push(Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, String(value)])));
      if (this.uploadFailure) { response.writeHead(503); response.end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (request.method === 'POST') {
        const boundary = String(request.headers['content-type']).split('boundary=')[1].replace(/^"|"$/g, '');
        const start = body.indexOf('name="file"');
        const bytesStart = body.indexOf('\r\n\r\n', start) + 4;
        const end = body.indexOf(`\r\n--${boundary}`, bytesStart);
        if (start < 0 || end < bytesStart) { response.writeHead(400); response.end(); return; }
        this.blobs.set(ref, body.subarray(bytesStart, end));
      } else this.blobs.set(ref, body);
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    this.storageServer = server;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start attachment storage.');
    this.storageUrl = `http://127.0.0.1:${address.port}`;
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
  /** A child session like one that spawn-happy-session starts from real-session (happy-cli createSessionMetadata). */
  async addSession(id: string, patch: Json, { active = true, createdAt = 1700000005000 } = {}) {
    const base = this.sessions.find((session) => session.id === 'real-session')!;
    const { summary: _summary, ...metadata } = await this.encryption.decrypt<Json>(base.metadata, this.dataKey);
    this.sessions.push({ ...base, id, seq: 0, active, createdAt, updatedAt: createdAt, agentState: null, agentStateVersion: 0,
      metadata: await this.encryption.encrypt({ ...metadata, ...patch }, this.dataKey), metadataVersion: 1 });
  }
  async setMessages(raw: Json[], sessionId = 'real-session') {
    this.sessions.find((session) => session.id === sessionId)!.seq = raw.length;
    const messages = await Promise.all(raw.map((message, index) =>
      this.message(`fixture-${index + 1}`, index + 1, message, sessionId),
    ));
    if (sessionId === 'real-session') this.messages = messages;
    else this.otherMessages.set(sessionId, messages);
    return messages;
  }
  /** A Happy Agent send receipt for a stored message, as `pendingUserMessages.spec.ts` in happy-app shows it. */
  async pushReceipt(ref: string, reason?: string) {
    await this.pushEvent(receipt(ref, 'run-' + ref, reason));
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
  // The plaintext ephemeral from `buildSessionEventEphemeral` in happy-server `app/events/eventRouter.ts`.
  sendSessionEvent(sessionId: string, kind: 'done' | 'permission' | 'question') {
    this.socket?.send('42' + JSON.stringify(['ephemeral', {
      type: 'session-event', sessionId, kind, title: 'Claude finished', body: 'Ready for your next message', timestamp: Date.now(),
    }]));
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
