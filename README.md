![Rayno demo with the session list, chat, tool activity, code, and message composer](docs/images/demo-chat.png)

<p align="center">
  <img src="public/icons/icon-512.png" width="120" alt="Rayno rhino logo" />
</p>

<h1 align="center">Rayno</h1>

<p align="center">A static web client for your own Happy CLI agents.</p>

## Quick start

You need three things:

- A Happy account
- The Happy CLI on your computer
- Claude Code or Codex, signed in on the same computer

### 1. Create a Happy account

Install the Happy app on your phone ([iOS](https://apps.apple.com/us/app/happy-claude-code-client/id6748571505) or [Android](https://play.google.com/store/apps/details?id=com.ex3ndr.happy)).
You can also use the [Happy web app](https://app.happy.engineering).
Select **Create account**.

### 2. Install the Happy CLI

```bash
npm install -g happy
```

### 3. Connect your computer

Go to a project folder and start an agent:

```bash
happy claude   # or: happy codex
```

The first time, the CLI asks you to sign in.
Scan the QR code with the Happy app, then approve the request.
The CLI also starts a background daemon. Rayno uses the daemon to start new sessions on this computer.

### 4. Open Rayno

Go to https://rayno-co6.pages.dev, select **Sign in**, and choose one of these methods:

| Method | In the Happy app | In Rayno |
|---|---|---|
| Scan QR code | **Settings → Account → Link New Device** | Scan the QR code on the screen |
| Recovery key | **Settings → Account → Secret Key**, then copy the key | Select **Recovery key** and paste it |

Your sessions now show in Rayno.

> [!WARNING]
> Keep your secret key private. It decrypts all of your sessions.
> Rayno keeps the key in this browser only when **Remember this login on this device** is selected.

## About the name

Rayno comes from "Ray no Happy CLI". "no" is the Japanese particle の, so the phrase means "Ray's Happy CLI".
The initials R and H turn it into RHino, the rhino in the logo. Rayno is the same word, spelled after "Ray no".

Rayno began as a personal patch of the Happy web app. It is now a separate product with its own code.

## What it is

Rayno is a static web client for [Happy](https://github.com/slopus/happy).
It is written in React, TypeScript, and Vite.
Rayno owns its UI, dependencies, authentication, encryption, realtime client, build, and browser storage.
It talks only to the Happy server. The Happy CLI daemon on your computer connects to the same server.
The server relays end-to-end encrypted session data and RPC calls between them.

## How it connects

```text
browser (Rayno) ──HTTPS/WSS──▶ Happy server ◀──── Happy CLI daemon on your computer
```

Rayno does not connect to your computer directly.
The "host" on the login screen is the Happy server that your CLI uses.
The default is `https://api.cluster-fluster.com`, the hosted Happy server.
If you run your own Happy server, it must use HTTPS and allow CORS from the Rayno origin.

## Sign in

The login screen opens **How to install** first, with the setup steps above and commands that you can copy.
After setup, select **Sign in**, then choose **Scan QR code** or **Recovery key**:

- Scan the QR code with a signed-in Happy mobile app, then approve this browser.
- Paste your Happy account recovery key. The key is the 32-byte account secret.

To use another Happy server, open **Happy server** on the login screen and enter its HTTPS origin.
The address applies when the field loses focus, when you press Enter, or when you connect with a key.
Rayno does not send requests to a partial address while you type.
An HTTP address is rejected, except for `localhost`.

With **Remember** selected, the token, the account secret, and the server address stay in this origin's `localStorage`.
Sign-out clears the token, the secret, drafts, pending packets, and the offline cache.
The server address stays, so the next login starts with the same server.
Without **Remember**, the login stays in this tab's session storage and the server address is not saved.
Anyone with access to this browser profile can read a remembered secret.

Server changes synchronize across clients. Rename, archive, and delete affect the shared session.
Restore removes the archive marker. It does not start an offline agent.
The default list hides explicitly archived sessions and ended CLI sessions, as the Happy app does.
Open the list options button above the list and choose Archived to read their history. A disconnected Rig session stays visible.
The same glass menu contains search, Flat/Projects grouping, and Reset. Command/Ctrl+K opens it and focuses search.
An ended CLI session has no archive or restore action in Rayno.
Use Resume session when the original computer is online and its daemon advertises recovery support. Otherwise use Hand Off to start a new session.
Archived Claude and Codex sessions show Resume even when the server still reports them as active. The owning daemon checks for an existing process.

## Connected features

The [Happy Web gap tracker](docs/happy-web-gap-tracker.md) lists every audited item, its status, evidence, and remaining limits.

- Paginated session lists and encrypted message history, with earlier-message loading.
  After the first complete read, a refresh reads only the sessions that changed. A reconnect or a manual retry reads the complete list again.
- An encrypted local session list and previously loaded chat pages that remain readable after an offline reload.
- Encrypted sends with stable local IDs, explicit acknowledgement, retained failed drafts, and deduplicated retries.
- Socket.IO updates and history catch-up after reconnect. Background tabs announce background state.
- Legacy NaCl records and per-record AES-GCM keys, with account key derivation and key unwrap.
- Stop the current response, terminate an agent, and allow a tool once or for the session.
- Answer agent question forms and Claude AskUserQuestion inside the matching tool activity, with a fallback for unloaded calls.
- Upload encrypted PNG, JPEG, GIF, and WebP images in chat or a new session; open received images and download a decrypted copy. Each message accepts up to 20 images, smaller than 10 MB each.
- Open local image paths in agent replies with **Load private image**. Rayno reads the image through the session's encrypted RPC and saves an encrypted attachment. It creates no public link. Local imports support PNG, JPEG, GIF, and WebP files up to 4 MB inside the session workspace. Saved imports remain available after reload and, once cached, offline.
- Expand tool calls to read arguments and results, including original file source, verified raster images, and complete reported diffs.
- Read denied or canceled command decisions even when the agent never emitted a tool call.
- Keep subagent work under its parent across message pages and offline reloads. Unplaced work stays readable without main reply actions.
- Spawn a real agent on an online machine, including optional Git worktree creation.
- Hand Off from Session info or the chat menu to an editable new-session draft on the same computer and checkout.
- A conversation and composer with full, moderate, and standard width choices in Settings > Appearance. Moderate width is the default.
- The floating chat header includes session actions, Hand Off, and a new session in the same workspace.
- Soft dark gradients at the message viewport's top and bottom, below the floating controls.
- Mermaid code fences render with `beautiful-mermaid`, with source copying, scrollable diagrams, and readable source when a preview is unavailable.
- Fenced code blocks show local syntax highlighting, a language label, and source copying. Unknown languages keep their plain source.
- Searchable model/effort selection with visible Claude and Codex choices.
- Recent workspace selection from real session activity and Rayno's own per-computer history.
- A chat-header menu provides archive, delete, Fork, and Duplicate. Fork copies the full provider conversation; Duplicate lets you choose the final message to keep. Both create a new session on the original computer with explicit model, effort, and permission choices.
- Rename with optimistic concurrency, archive, restore, and delete with server error handling.
- Read-only directory and file previews, Git status, and staged/unstaged diffs through the session RPC.
- Computer health and Claude/Codex quota reads on explicit Monitor refresh.
- Rename a computer, stop its daemon, or remove it from the account with confirmation. Removal preserves conversations.
- Read historical tokens and reported USD cost by period, session, model, and date in Settings > Usage.
- Select English or Traditional Chinese, keep reported context visible, and save an exact custom Codex model ID in Settings > Advanced.
- Use the desktop rail to jump to the start of each formal agent response, including responses without a recap.
- Agent icons identify the compact weekly-usage bars and retain accessible names.
- Independent appearance preferences, drafts, recent folders, responsive panels, and keyboard navigation. The composer warns when 10% or less of the context window remains. Advanced settings can keep the reading visible; Model & effort also shows it.

Existing sessions prefer the daemon's model catalog. New sessions offer agent, model, effort, and permission mode selection before Start.
Permission mode always has a selected value. It restores the last explicit choice for that agent from a new session or chat, or selects Yolo without a valid choice.
The spawn request, first encrypted message, and chat controls use the selected mode.
Known current provider, permission, model, and effort fields remain in outbound messages.
Unavailable battery, network, latency, or quota data never falls back to samples.
Monitor usage reads do not send an AI prompt or start a model turn.
While this Rayno tab is visible and focused, usage refreshes once per minute on every route.
Background or unfocused tabs stop polling. Offline computers receive no reads, and overlapping refreshes share one request.
Each online computer runs one quota query per cycle, with short-lived Claude SDK and Codex app-server processes.

The app opens saved content while it reads current data. Normal startup has no yellow connection warning.
A failed workspace or realtime connection shows a warning with Retry; an active retry hides the warning.
Known offline use shows a quiet status beside the list and conversation instead.
Reconnect merges missed replies with saved pages. An offline draft stays local and is not sent automatically.
Message-read failures stay inside the conversation, with a retry for the failed page and optional technical details.
File and Git views wait for the realtime connection before they read the computer.

The offline cache uses IndexedDB on this Rayno origin, encrypted with the current account key.
Its keys include the account and server scope. It does not cache authentication headers or private API responses in the service worker.
Only loaded message pages are available offline; unseen conversations explain how to save their content.
The diagram renderer loads only when a Mermaid preview comes into view. Once loaded, the service worker caches its static code for offline previews.
Diagram layout runs in a Web Worker, and SVG images stay outside the page's executable markup.
Browser storage availability and eviction can affect saved content. A cache failure does not replace live data with demo data.

Voice, push notifications, and general file uploads are not implemented. Image uploads use the Happy API and its local PUT or S3 POST storage contract. The storage service must allow this Rayno origin through CORS.
Failed image uploads retain the draft and attachments. Retrying a send with no confirmation reuses the encrypted message IDs. Selected image files remain in memory and must be selected again after a reload.
Received images load when they enter the viewport. Rayno stores verified images in the encrypted account/server cache so they can reopen after an offline reload. Browser quotas and eviction can affect availability. Sign-out clears this cache.
Session recovery supports Claude and Codex on the original online computer. Old daemons and sessions without a provider recovery ID show the reason recovery is unavailable. The account master secret never enters a resume request.
Preview supports UTF-8 files up to 1 MB. Files and Git commands require daemon support.
The app reports unsupported or failed operations instead of substituting local results.

A legacy spawn timeout has no safe automatic retry ID.
Rayno asks you to check the Happy app before you repeat that draft.
Happy Agent is hidden from creation and agent-switch controls. Existing sessions remain readable.
A failed initial send retains the new session ID so a retry does not spawn another agent.

Hand Off selects Codex for a Claude session and Claude for a Codex session.
It fills the prompt with the old Happy session ID and the provider's local transcript path, when available.
The cursor starts at the end so that you can add instructions. Start launches the new agent.
For a Happy worktree, the draft retains the repository and the exact existing checkout path.
The worktree picker accepts a branch name for a new checkout or an absolute path for an existing checkout.
Model and supported effort controls always select a concrete value. They restore the last valid choice for that agent.
When no saved choice is available, Rayno selects a concrete model from the catalog and a supported effort.
New sessions, same-workspace drafts, and handoffs share these Rayno account preferences. They do not use an agent-default alias.
Existing chats keep their explicit per-session choices. Later model changes also update the preference for future sessions.
The workspace picker groups recent folders by computer, merges duplicate paths, and preserves the selected worktree.
Successful starts save the workspace in this Rayno account's browser storage, including when the session later disappears.

## Explicit demo mode

Use Explore the demo on the login screen, or Settings > Developer > Open demo.
Demo mode uses a separate `rayno.demo.v1` schema store and simulated replies.
That key's `v1` is a data schema version, not the frontend version.
Demo computers, files, usage, and attachment names stay separate from real account data.
Use Settings > Account > Connect to Happy to return to the connected client.
Reset demo affects only demo data.

Open `/session/private-image-demo?demo=1` on your Rayno server to try the image preview.
Select **Load private image**, then select the thumbnail to open or download it.
This demo encrypts and decrypts the public README screenshot in this browser. It reads no computer file and uploads no attachment.
Reload the page to repeat the demo.

## Local development

Use Node.js 22.12 or newer and pnpm 11.10.0. `.nvmrc` pins Node.js 24.16.0.

```sh
pnpm install --frozen-lockfile
pnpm dev       # http://127.0.0.1:5180
pnpm build
pnpm preview   # production preview, http://127.0.0.1:5179
pnpm serve     # production preview, http://127.0.0.1:5178
```

The servers listen on loopback only.
To open them from another device, put a proxy in front, for example `tailscale serve`:

```sh
tailscale serve --bg --https=5180 http://127.0.0.1:5180
```

Vite accepts only known host names. Add the proxy's host name to `.env.local`:

```sh
RAYNO_ALLOWED_HOSTS=your-machine.your-tailnet.ts.net
```

`.env.local` stays out of git. `.env.example` lists the supported variables.
Each origin has its own login and browser storage.

## Deploy to Cloudflare Pages

Rayno is a static site. Cloudflare Pages serves it without a server runtime.

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=24.16.0` |
| Environment variable | `PNPM_VERSION=11.10.0` |

The Pages build image does not read the pnpm version from `package.json` or the lockfile, so set `PNPM_VERSION`.
`pnpm build` runs the type check before the Vite build.

`public/_headers` sets the response headers:

- A Content Security Policy. `connect-src` allows any HTTPS and WSS origin, because each user enters a Happy server.
  `'wasm-unsafe-eval'` lets libsodium compile its WebAssembly module.
- A one-year immutable cache for `/assets/*`. Vite adds a content hash to those file names.

Pages has no top-level `404.html` here, so it serves `index.html` for every unknown path.
Routes such as `/session/<id>` work after a reload.
`public/assets/404.html` makes a missing file under `/assets/` return status 404, not `index.html`.
A page from an old release then gets a clear load failure. The screen error clears the shell and reloads once.

Every Pages deployment, including each preview URL, is a separate origin.
Each origin needs its own login.

To check the Pages behavior locally, build and run the Pages emulator:

```sh
pnpm build
pnpm dlx wrangler@4 pages dev dist --ip 127.0.0.1 --port 8788
```

## PWA

The generated manifest identifies Rayno. Its service worker uses a `rayno` cache prefix.
Only static assets and the app shell enter the service worker cache.
Live API calls and credentials do not enter that cache.
Demo interactions work offline after the shell is cached. Real operations require the Happy server and daemon.
Adapted protocol copies have pinned provenance in `src/happy/PROTOCOL-SOURCES.md` and retain `HAPPY-LICENSE.txt`.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Browser tests start an isolated production preview on port 5179.
Stop another local preview there before the test run.
The tests mock the Happy server and use a Vite preview, so they do not apply `public/_headers`.
`MermaidPage.svg()` reads the diagram with `fetch()` on a `blob:` URL. The production CSP blocks that call, so run that test against a Vite preview.
Tests use Page Objects and fresh browser contexts.
Connected tests use encrypted fixtures and mock REST/WebSocket boundaries, with no production writes.
They verify browser compatibility rather than a live daemon deployment.
Every UI change also requires phone interactions at narrow widths, short keyboard heights, and landscape sizes.
Check touch targets and action reachability, in addition to overflow and screenshots.
See `VERIFICATION.md` for results, artifacts, and manual checks.
See `PERFORMANCE.md` for render isolation, lazy modules, and the production benchmark.

## Design and licenses

The implementation follows a design handoff for dimensions, opaque gradients, nested corners, and responsive panels.
Chromium and WebKit emulation do not verify a physical iOS keyboard or an installed iOS PWA.
Fonts and icons remain local.

Rayno uses the MIT license. See `LICENSE`.
Third-party notices are in `THIRD-PARTY-NOTICES.md`, `HAPPY-LICENSE.txt`, and `public/fonts/OFL-Geist.txt`.
Rayno is not affiliated with Happy, Anthropic, or OpenAI.
