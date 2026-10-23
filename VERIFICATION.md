# Verification

Updated: 2026-10-21.
Environment: macOS, Node.js 24.16.0, pnpm 11.10.0.

The sections before "Standalone repository" record checks made in the earlier private repository.
At that time, Rayno linked to a v1 web client. Those links are gone. See the last section.

## Results

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Production build | Passed; separate Rayno manifest, service worker, and static output |
| New-session permission mode | TypeScript and production build passed; 128 unit tests passed; 84 focused Chromium/WebKit checks passed without retries, including per-agent choice restore, Auto fallback, spawn/message parity, chat picks, Hand Off, demo sessions, and phone controls at 320/360/390/430px, short height, and landscape |
| Mermaid phone layout | TypeScript and production build passed; 120 unit tests passed; full suite passed with 146 Chromium and 143 serial WebKit checks, including smart fit at 0.7×, swipe hint, full screen viewer zoom, rotation refit, focus return, and 44px targets at 320/360/390/430px and landscape |
| Chat font size setting | TypeScript and production build passed; 120 unit tests passed; full suite passed with 144 Chromium and 141 serial WebKit checks, including Small/Medium/Large scaling, reload restore, and phone fit and 44px touch targets at 320/360/390/430px and landscape |
| Mermaid previews and message fades | TypeScript and production build passed; 116 unit tests passed; 61 focused desktop/mobile Chromium/WebKit checks passed with 3 existing duplicate PWA skips |
| Floating chat header | TypeScript and production build passed; 52 desktop/mobile Chromium/WebKit checks passed for full-height messages, header hit targets, history, unread state, offline content, drafts, and native/fallback input sizing |
| Header and capsule surfaces | TypeScript and production build passed; four desktop/mobile Chromium/WebKit header flows passed; 28 computed-style samples confirm a transparent container and a filled title capsule with its border and shadow |
| Chat header cleanup | TypeScript and production build passed; 68 focused browser checks passed across desktop/mobile Chromium and WebKit |
| Unit tests before header cleanup | 116 passed |
| Full browser suite before header cleanup | 271 checks passed: 137 Chromium checks and 134 WebKit checks; 9 intentional PWA project skips |
| Input latency follow-up | 16 checks across all four browser projects; native/fallback sizing, stable height during typing, Chinese composition during replies, and preservation of newer drafts during pending sends |
| React profiling | 48 inputs in a 1,000-response chat: provider renders 48→0, commits 96→48, and selector reads 96,576→96; live reply samples also reduce notification work |
| Line-wrap regression | The root-style guard fails against the old build; a comparison that changes only spacing updates reduces phone-size maximum input-to-frame samples from 339–387 ms to 16–23 ms |
| Production performance controls | Alternating old/new builds at 6× CPU with 1,000 replies; 480 inputs per build across desktop and phone-size viewports; see `PERFORMANCE.md` for medians, P95, maxima, and method |
| Render isolation and lazy screens | 8 checks across desktop/mobile Chromium and WebKit; old Markdown DOM survives input, activity, and new messages; lazy file tools retain drafts |
| Long-chat performance | 500 Markdown replies: script work per input changed from 124.40 ms to 0.47 ms; input-to-frame median changed from 160.2 ms to 6.2 ms; no input long tasks after the change |
| JavaScript entry | 1,124,603 to 283,749 bytes before gzip in the final merged build; optional modules load through lazy boundaries; see `PERFORMANCE.md` for scope and method |
| WebKit history controls | 18 checks passed across three consecutive runs of the desktop/mobile chat presentation flows after the scroll observer correction |
| Chat presentation update | 12 focused browser checks passed across desktop/mobile Chromium and WebKit |
| Reply option update | 20 focused browser checks passed, including option sends, retries, existing chat sends, tool/table rendering, and the demo lifecycle |
| Model/effort update | 16 model/effort checks passed across four browser projects; chat sends, reply options, creation, and layout regressions also passed |
| Working composer / Markdown update | 52 focused browser checks passed across four browser projects, including 12 working-composer and 4 numbered-list checks |
| Composer focus update | Build passed; desktop/mobile Chromium and WebKit checks confirm the purple outer frame, no inner textarea outline, reset on blur, and visible button focus |
| Latest-message shortcut | Build and 16 focused browser checks passed across four projects, including history reading, return to latest, tool/table rendering, working sends, and responsive layouts |
| Permission mode display | Build, 60 unit tests, and 32 focused browser checks passed; inherited/picked modes, daemon labels, reload persistence, unknown modes, locks, model settings, working sends, latest shortcut, and layouts |
| Session attention | Unread and pending-input flows passed across all four projects; reload, background/foreground recovery, offline rows, long tool histories, formal requests, and scroll-based read tracking |
| Session-list usage | 12 focused checks passed, followed by the full suite; real quota reads, expandable details, refresh, stale/error/offline states, 320px layout, and tablet/desktop breakpoints |
| Hand Off | 20 checks across desktop/mobile Chromium and WebKit; editable draft, reload/caret, encrypted initial send, provider switch, exact worktree reuse, unregistered worktree rejection, and new-worktree regression |
| New-session controls | The chat header has no draft shortcuts or Chat/Changes/Files tabs; searchable model selection retains its model/effort through reload and encrypted spawn; recent workspaces preserve checkouts |
| Concrete model choices | Agent-default rows are absent; per-agent selections survive switching, reload, fresh drafts, handoffs, and later chat changes; invalid or unavailable choices resolve against the current catalog |
| Phone interactions | Model selection and completion work at 320/360/390/430px widths, a 390×430 keyboard-height viewport, and 844×390 landscape; changed controls have 44px targets and the Start action stays reachable |
| Archive classification | Ended CLI sessions hide without a lifecycle marker; marked sessions stay archived; disconnected Rig sessions remain visible; live presence moves CLI rows between lists and archived history stays readable |
| Navigation cleanup | Inbox entries and their badge are hidden; the left rail has no v1 button; Settings provides one visible v1 link; 12 related regressions and 14 Tailscale interaction checks passed in Chromium/WebKit |
| Field focus | Native fields and composite frames use one rounded 1px indicator; login, server, rename, search, workspace, task, chat, questions, and settings were audited in desktop/mobile Chromium and WebKit |
| Final keyboard adjustment | Build and 24 focused browser checks passed after the iOS safe-area correction; the field audit covers narrow, short, landscape, and desktop viewports |
| Foreground usage polling | One-minute reads continue across routes, coalesce while pending, stop when hidden or unfocused, and pause for offline computers; a delayed result does not skip the next minute |
| Offline workspace | Encrypted session lists and loaded chat pages survive reloads; narrow/short/landscape controls stay operable; reconnect fills missed replies and retains unsent drafts |
| Cache isolation | Another account cannot read the saved workspace; offline sign-out drains pending writes and clears only its account cache; v1 storage remains intact |
| Connection warning | Startup and active retry remain quiet; a failed workspace read shows Retry; known offline use shows a muted status; file/Git reads wait for the realtime connection |
| Stop appearance | Composer Stop and Session info termination icons use the normal neutral color; working sends and Stop behavior retain browser coverage |
| Session-list menu | Search, grouping, Active/Archived, clear, and Reset share a glass popover; outside click, Done, nested Escape, focus restoration, active-filter dot, and Command/Ctrl+K pass across all four browser projects |
| Standalone package | Fresh copy outside this repository; frozen offline install and production build passed |
| Rayno Tailscale origin | HTTPS page, JavaScript asset, manifest, and service worker return HTTP 200 on port 5178 |
| V1 Tailscale origin | Existing service remains available; Settings returns HTTP 200 |
| Native browser navigation | Inspected the v1 Settings link and opened Rayno through it |
| Apple Simulator | iPhone 17 / iOS 26.5 Safari and installed PWA: search/chat focus retains width, the outer rounded frame appears, the keyboard leaves the send control visible, and dismissal restores the layout |
| Real authorization/read | Ray confirmed login and a real session list, with an actual session URL |

The Mermaid/fade update passes 31 Chromium and 30 WebKit checks without retries.
Coverage includes lazy worker loading, Unicode flowcharts and sequence diagrams, image identity during typing/replies,
unsupported-source fallback, SVG image isolation, source controls, phone overflow, and keyboard scrolling.
Phone coverage uses 320/360/390/430px widths, a 390×430 keyboard-height viewport, and 844×390 landscape.
The installed Chromium PWA caches the renderer after use and renders saved diagrams after a fully offline reload.
WebKit needs an explicit arrow-key handler for the diagram's scroll area; this behavior passes in both engines.
The existing chat, Chinese composition, Markdown, history, lazy tools, unread state, and offline flows also pass.
Earlier diagnostic runs exposed worker environment compatibility issues, a test selector that counted Copy icons,
and WebKit's missing native keyboard scrolling. Their logs remain separate from the passing final run.

The header cleanup passes 34 Chromium and 34 WebKit checks without retries.
The header container stays transparent. Its title capsule retains the reference design's gradient, 1px edge, inner highlight, and drop shadow.
Four focused header flows pass without retries; 28 computed-style samples distinguish the container from the capsule, and desktop/320px screenshots match the supplied Liquid Glass design.
The subsequent floating layout passes 26 Chromium and 26 WebKit checks without retries.
Conversation messages start at the chat panel's top edge and use its full height; header gaps pass pointer events to the messages underneath.
Initial content padding keeps the first message reachable, and scroll padding protects focused controls. Offline status stays visible below the floating header.
It covers 320/360/390/430px widths, a short keyboard viewport, landscape, tablet, and desktop.
Header controls meet 44px targets; session details, draft retention, Hand Off, lazy workspace tools, and native/fallback input sizing remain usable.
The full suite before that cleanup uses a frozen source copy and its production artifact, including the merged Stop and control-message updates.
Chromium and WebKit each run with one worker in separate commands.
Chromium passed 137 checks in 6.5 minutes; WebKit passed 134 checks in 6.0 minutes.
An earlier concurrent WebKit run hit page-load and action timeouts; single-worker validation used the same assertions without retries.
Earlier verification also includes 12 temporary field-audit checks outside the source repository.
The nine skips repeat the three PWA tests in the other three browser projects.
The generated service worker and upgrade path receive desktop Chromium coverage.
Browser retries remain disabled. No failed test remains skipped as a workaround.

The performance follow-up before the header cleanup uses production browser contract checks and synthetic performance measurements.
Native simulator and live-account notes below describe earlier revisions; this follow-up does not claim a new physical-device measurement.
The performance follow-up deploys a 62-file artifact that matches its frozen, tested output byte for byte.
The header cleanup deploys a 61-file artifact that matches its focused browser test output.
The port 5178 page, entry script, manifest, and service worker return HTTP 200; entry and worker hashes match the artifact.
Temporary profiling counters are absent from production JavaScript. Helper services and routes on ports 5179 and 5180 were removed after verification.

## Unit coverage

- Local demo state, validation, restoration, and cancellation.
- Pinned Happy key-derivation vector, independently produced NaCl/AES records, key unwrap, tamper rejection, and Ed25519 proof.
- Mixed legacy/Codex/session message formats, ordering, duplicate IDs, and hidden receipts.
- Provider-qualified model IDs, permission/effort metadata, and rejection of unsupported CLI permission modes.
- Session pagination, metadata CAS conflict handling, and preservation of unknown fields.
- V1 archive classification, explicit CLI resume guidance, and Rig archive restoration.
- Presence events remain current when an older workspace read finishes later.
- An offline startup makes no server request and rejects sends; a realtime failure remains distinct from a successful workspace read until reconnect.
- A lost send acknowledgement retains the encrypted packet and local ID.
- A change to model/permission choices cannot silently replay the old packet.
- Reconnect fills gaps even if a newer socket message arrived before the missing history.
- Expired authorization, account storage isolation, offline mutation refusal, and background socket state.
- Session dates use published meaningful activity, with creation as the fallback; background metadata updates do not change the order.
- Stable ID ordering for equal timestamps, future-clock clamping, and local date/time output from one day ago.
- Worktree labels and machine-based row fading match the inspected v1 rules.
- Consecutive tool calls form one group without deduplication; text, user messages, and attachments separate the groups.
- Mixed tool/text messages retain their text, and appended tools keep the existing group ID.
- Inline and multiline Happy option blocks retain their exact labels and surrounding Markdown.
- Code, inline code, indented code, and quoted option examples stay literal; incomplete or invalid blocks do not become buttons.
- Option sends preserve the local draft.
- Model catalogs prefer daemon data and fall back to the inspected v1 Claude/Codex catalogs.
- Provider-qualified model IDs, per-model effort limits, model locks, and legacy effort-reset protocol compatibility.
- An unconfirmed send cannot replay a different effort selection.
- A current activity event can clear a stored working state.
- Read cursors are monotonic across tabs; only meaningful assistant content marks a session unread.
- First account sync establishes a baseline; sessions discovered afterward can become unread.
- Hidden/unfocused views and unloaded tail scans do not mark messages read.
- Usage requests coalesce, and a failed refresh preserves previous readings as stale without raising a workspace error.
- Handoff drafts retain the source computer/checkout, swap Claude/Codex, restore valid choices for the target agent, and use the matching transcript path.
- Concrete model preferences reject default aliases, scope agents independently, preserve locked reported models, and do not invent missing models.
- Workspace recency combines session activity and per-computer local history, keeps distinct checkouts, and excludes side chats and other computers.

External HTTP, Socket.IO, storage, time, and UUID sources use test doubles where applicable.
Crypto uses the real browser-compatible library and deterministic producer fixtures.

## Browser coverage

Connected tests use the real compiled frontend and encryption, with mock REST and WebSocket boundaries.
They run in fresh contexts and never use production credentials or write to Ray's real sessions.
These are browser contract checks, not a live backend E2E run.

| Flow | Verified behavior |
| --- | --- |
| Authorization | QR account approval decrypts the account key and opens the connected client |
| History | Session pagination, AES/legacy metadata, modern envelopes, earlier messages |
| Send | Failed draft remains; retry uses the same ciphertext/local ID; one visible message; socket reply appears |
| Permissions | Explicit allow sends an encrypted permission RPC once |
| Files | Directory list and UTF-8 file preview use the session RPC |
| Monitor | Real-mode machine/usage data comes from RPC results; sample selectors stay hidden |
| Creation | One daemon spawn and one encrypted initial prompt |
| Management | Rename, archive, restore, and delete await confirmation; restore does not spawn an agent |
| Version link | Current real session ID remains in the counterpart URL; no agent mutation occurs |
| Logout | Rayno clears its own authorization and returns to sign-in |
| Demo | Complete local lifecycle, drafts, preferences, drawers, responsive screens, offline shell |
| Session list update | Initial progress appears during a held workspace load, disappears while an agent still runs, and activity dates control the order; side chats stay hidden |
| Chat presentation update | Legacy and session tool events group in order; collapse state survives an appended event; GFM table headers, alignment, links, inline code, escaped pipes, and horizontal overflow render correctly |
| Reply options | Exact Unicode labels become buttons; a click sends encrypted text, preserves the draft, and deduplicates a retry; answered choices remain disabled after reload; archived sessions cannot send a choice |
| Model and effort | Per-session selections survive reload; encrypted packets carry a concrete model and supported effort; CLI sessions without catalogs receive fallback choices; no agent-default row is available |
| Creation settings | Claude/Codex spawns and the encrypted first prompt receive the same explicit model/effort choices; saved Happy Agent drafts migrate to a concrete CLI choice without a spawn |
| Working composer | Button, Enter, and option sends use encrypted messages while the agent works; sends do not call abort; a separate Stop button calls abort and keeps the draft; failed sends retain the same packet for retry |
| Numbered Markdown | Numbered lists and nested bullets render bold labels next to Chinese punctuation; links, literal code, escaped stars, tables, and option buttons retain their behavior |
| Latest-message shortcut | A glass pill appears above the composer when the reader scrolls away from the bottom; new replies preserve the reading position; click or Enter returns to the latest reply and restores automatic following without a send or draft change |
| Permission mode display | Desktop/mobile composers show the selected or inherited mode; daemon updates refresh inherited labels; explicit picks survive reload and use the matching wire code; unreported modes stay unknown; locked modes cannot change |
| Session attention | Purple unread and orange pending-input dots work independently, survive reload and offline rows, and clear only after viewing the latest loaded reply or confirming the matching response; options buried behind 145 tool events are recovered |
| Foreground recovery | Returning to a visible chat catches replies missed while hidden; reading older history retains unread until the latest-message shortcut is used |
| Session-list usage | Separate desktop capsule and mobile capsule above navigation show decrypted Claude/Codex weekly readings and pace markers; expanded details include source computer, reset/read timestamps, refresh, errors, and Monitor navigation |
| Hand Off | Session info opens an editable draft; only Start spawns an agent and sends the encrypted prompt; source session data stays unchanged; a registered checkout is reused even if its path and branch name differ |
| Chat header | Main conversation, New session, Hand Off, and Chat/Changes/Files controls are absent from the header; session details open and close without changing the draft |
| New-session model picker | Agent cards and a searchable model/effort panel expose Codex directly; selections survive reload and reach both spawn and encrypted first-message metadata |
| Workspace picker | Actual sessions populate recent workspaces on first use; paths deduplicate by computer; selected worktrees retain the exact checkout; manual folders remain recent after reload without their original session |
| Remembered model choices | Claude and Codex keep separate model/effort selections; same-workspace drafts and handoffs restore the matching choice; a later chat selection overrides stale new-session settings |
| Phone input | Agent, model, effort, workspace, Done, and Start remain operable at narrow and short viewports in Chromium and WebKit; model dialogs scroll to their actions; Happy Agent is absent from creation controls |
| Offline workspace | Loaded messages and the session list remain readable after offline reloads; cached content stays encrypted in IndexedDB; account switching and sign-out isolate storage; missed replies merge after reconnect without a send |
| Quiet connection state | A held first load has no warning or false missing-session state; only a failed attempt shows Retry, and a pending retry hides that warning |
| List options | Compact header opens one menu; search and grouping update rows, Archived changes visibility without a mutation, and Reset clears all conditions; the keyboard shortcut survives route changes from chat and Monitor |

The numbered-list regression failed on the original parser because three Chinese labels stayed plain text.
The renderer now uses the parse-only entry point of [remark-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly/tree/main/packages/remark-cjk-friendly).
It extends emphasis parsing without text rewrites or raw HTML support.
The demo collects instructions that arrive before its simulated response, so a second instruction does not cancel the first.
After the final control sizing, eight focused Markdown/layout checks also passed across all four projects.
The final permission chip sizing also passed 16 focused checks, including full label visibility on mobile, daemon updates, working sends, and layouts.

The updated ZIP's `Rayno A Floating Panels.dc.html` supplies the usage capsule reference.
The connected provider reads usage once per minute while its tab is visible and focused, across all routes.
Hidden or unfocused pages stop the polling timer. Offline computers receive no reads, and pending reads coalesce.
The tests distinguish these read-only quota RPCs from session mutations.
No production usage credentials or daemon reads were used by the automated suite.

Native phone checks used Apple Simulator through the Tailscale URL. Only the simulator used demo data.
The list-menu update was also checked in iPhone 17 Safari: opening the menu leaves the keyboard closed, search shows the rounded outer focus frame without zoom, the software keyboard reduces panel height, and filtering, Reset, and Done work.
Automated menu checks cover 320/360/390/430px widths, a 390×430 short viewport, 844×390 landscape, and desktop; all menu controls remain reachable by scrolling, and touch targets are at least 44px.
Safari reproduced the original focus zoom and excess bottom spacing before the fix.
The final PWA check used its home-screen icon and the iOS software keyboard.
Input text remains at least 16px, and the viewport still permits user-controlled zoom.
Navigation and usage share the same bottom spacing. The keyboard removes the unused home-indicator reserve from the composer.
These checks do not measure CPU or network cost on a real agent computer.

The offline update adds three browser contract flows in each of the four browser projects.
They simulate the browser's offline state while the static test server remains available for WebKit reloads.
A separate Chromium context enables the generated service worker and disables the network completely.
It verifies cold navigation to the saved session list and a chat, followed by another offline chat reload.
The worker check runs once; the other three projects intentionally skip this duplicate worker test.
Only previously loaded message pages are saved. No production account data or live agent write was used for these checks.

The handoff checks use the same isolated backend fixture. They do not start an agent on a real computer.
Existing worktrees are checked through `git worktree list --porcelain` before the normal spawn call.
An unknown checkout stops before any worktree creation, spawn, or send.
Prefilled draft focus also applies after a reload.
The final draft focus styling also passed the handoff checks in all four browser projects.

Read tracking lives in Rayno's own account-scoped browser storage. It synchronizes Rayno tabs on that browser;
it is not a cloud read receipt shared with v1 or other devices. Existing history is initially treated as read.

The session-list update runs in all four browser projects. It also checks desktop/mobile layouts across the six reference screens.
The final full suite includes these focused checks.

## PWA update correction

The original worker waited for every old page to close. No update prompt activated that worker.
A browser regression check reproduced the stale shell before the correction and passed after it.
The new worker activates and claims clients without an automatic page reload.
The next page reload uses the current shell; open page content and local storage stay intact.
The upgrade check keeps two old tabs open and verifies stored draft/auth sentinels after the reload.
Chromium also passes the offline-shell and connected session-date checks with this worker.

Projects use desktop 1440 × 900 and mobile 390 × 844 in Chromium and WebKit.
Reference screens also receive overflow and uncaught-error checks.
Breakpoint checks cover 767/768, 1023/1024, and 1279/1280 CSS pixels.

One test originally navigated before archive confirmation. It now waits for the completed route change.
Mobile tests also exposed inconsistent version-link names and a hidden-footer selector.
The final suite passes with the correct accessible labels and visible controls.

Artifacts remain under ignored `test-results/` and `playwright-report/` directories.
The independent copy also runs the send-retry checks against its own production build.

## Live verification limits

Ray confirmed the live session list after independent Rayno authorization.
The agent inspected the independent login page and v1-to-Rayno link through Tailscale.
The browser used for automated checks has separate test credentials.

The following checks remain manual and are not claimed as completed:

- Send, stop, spawn, rename, archive, delete, files, or Monitor against a real daemon.
- Simultaneous real Happy app and Rayno writes and cross-client synchronization.
- A running real agent continuing through a version switch.
- Live reads with the v1 frontend service stopped, or the reverse.
- Physical iOS devices and hardware keyboards.

The code shares no frontend runtime or storage with v1. The backend and daemon remain shared dependencies.
File uploads, voice, account notifications, and cold-session resume explicitly link to v1.

The updated ZIP includes the HTML reference. The usage capsule was visually checked in desktop and mobile screenshots.
The current JavaScript entry is about 89 kB after gzip; lazy modules and PWA precaching add separate bytes.
See `PERFORMANCE.md` for the measurement scope and the input-latency follow-up.

## Standalone repository, 2026-10-21

The source moved to its own repository without git history.
Changes in this move:

- All v1 links are gone. Text that pointed to v1 now names the Happy app.
- An ended CLI session shows no archive, restore, or resume action. The composer and chat say to resume it in the Happy app.
- The login server field applies on blur, Enter, or key login. It sends no request to a partial address.
  A remembered login also saves the server address, and sign-out keeps it.
- `vite.config.ts` reads extra dev and preview host names from `RAYNO_ALLOWED_HOSTS`.
- `public/_headers` adds the Cloudflare Pages CSP, security headers, and immutable caching for `/assets/*`.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm test` | 19 files, 132 tests passed |
| `pnpm build` | Passed |
| Browser suite on a Vite preview (port 5189) | 332 passed, 15 skipped by project, 1 failed |
| The failed test, rerun 5 times | 5 passed; a layout measurement during a viewport change |
| Browser suite on `wrangler pages dev` with `_headers` | 317 passed, 15 skipped; Mermaid preview failed in 4 projects |
| Cause of the Mermaid failure under the CSP | `MermaidPage.svg()` calls `fetch()` on a `blob:` URL; the app does not |
| CSP probe: custom-server key login, live chat, Mermaid image | No CSP violations in Chromium and WebKit, desktop and phone |
| Pages routing | `/session/<id>` returns `index.html`; a missing `/assets/` file also returns `index.html` with 200 |
| Phone layout probe | Login, Settings > Account and Voice, session info, and chat for an ended session |
| Probe sizes | 320×568, 360×640, 390×844, 430×932, 390×430, 844×390; Chromium and WebKit |
| Probe checks | No page overflow, 44px touch targets, 16px server field text, focused field in view |

The CSP and phone layout probes were temporary test files. They are not in the repository.
A Cloudflare Pages deployment was not made. These checks used the local Pages emulator.

## Priority features in the isolated worktree (2026-10-21)

Branch: `feat/priority-features`, based on `3685019`.

- Build and TypeScript checks passed. All 150 unit tests passed.
- The full browser sweep ran 392 cases: 373 passed, 15 existing project skips, and four failures from the old archive placeholder assertion. That assertion now matches the local recovery flow.
- The subsequent chat, archive, mode, attention, and offline regression run passed 113 cases with three existing skips, including the corrected archive assertion in every browser project.
- After the encrypted image cache change, the final connected, offline, and priority-feature run passed 97 cases with three existing skips. It includes all 56 new priority checks across desktop/mobile Chromium and WebKit.
- Phone interactions cover 320, 360, 390, and 430px widths, a 360x350 keyboard-sized viewport, and 844x390 landscape. Tests select and submit answers, open and close images, expand tool details, resume the same session, remove attachments, and reach Start. Changed touch controls measure at least 44px.
- Image tests use a real HTTP storage fixture for PUT, multipart POST, CORS, encrypted bytes, downloads, lost confirmations, and retries. WebKit route interception omits multipart file bytes, so it cannot verify that transfer by itself.
- Received images reopen after an offline reload. IndexedDB stores encrypted image payloads under an account/server scope, and filenames do not appear in stored values. Account-isolation and sign-out checks passed.
- A separate live browser check used the Pages origin against the official Happy API and `files.cluster-fluster.com`. Chromium and WebKit each returned upload 204 and download 200 for a tiny encrypted test image. The downloaded bytes decrypted to the original PNG. No chat messages or agent requests were sent.
- The storage OPTIONS probe returned 403, while the browser's actual multipart POST and GET succeeded with readable CORS responses. The form upload does not need that preflight.
- The Tailscale preview on port 5186 returned HTTP 200 and serves the current build. Existing routes and the original checkout remain unchanged.

Voice, general file uploads, bot management, social features, and a browser terminal are outside this change.

## Session actions and final regression (2026-10-21)

- Added the chat-header menu beside session info, with archive/restore, delete confirmation, provider-native fork, and duplication through a selected message. Ended sessions offer the existing resume flow.
- Claude and Codex copy/start contracts are covered with explicit model, effort, permission, and parent-session settings. A failed child start reuses the copied conversation; an unknown copy result does not silently create another copy.
- Appearance omits the fixed Rayno theme option. The compact usage bar uses accessible agent icons. Messages and the composer span the available chat width with shared edge spacing.
- All 152 unit tests passed. TypeScript and the production build passed.
- The final full browser sweep ran 424 cases: 405 passed, 15 existing project skips, and four failures from the old usage-name assertion. After updating that assertion for agent icons, all 12 usage checks passed across desktop/mobile Chromium and WebKit. The combined runs cover all 409 non-skipped cases successfully.
- The 32 session-action checks passed, including keyboard focus, confirmation/cancellation, duplicate-history scrolling, 44px targets, and full-width layout at 1440px, phone widths 320/360/390/430px, a 360x350 short viewport, and 844x390 landscape.
- Provider mutation checks use the isolated backend fixture. Fork, duplicate, resume, and permission changes were not run against a real agent daemon.

## Chat width and session menu follow-up (2026-10-21)

- Settings > Appearance saves full, moderate, and standard chat widths. Moderate is the default; its maximum is 1120px. Standard uses 880px. Messages and the composer share the same centered width and fit smaller viewports.
- The composer has no connection, weekly-usage, or context footer. The obsolete Show usage setting is removed. Connection-error and offline notices still use the existing availability flow.
- The header menu offers Hand Off and New session in same workspace. Both prepare an editable draft on the same computer and checkout. Neither starts an agent before Start.
- Archived Claude and Codex sessions show Resume in chat, session info, and the menu even if the server still marks them active. Resume calls the owning daemon before it removes the archive marker; the daemon checks existing process ownership.
- All 152 unit tests and the production build passed. The final focused browser run passed all 84 cases across desktop/mobile Chromium and WebKit.
- Broader browser runs also verified the working composer, Markdown, connections, archive filtering, encrypted image transfer, permissions, offline reloads, font size, and existing handoff flows. Five existing project skips remain in the offline/font-size selection.
- Width choices survive reloads in both live and demo modes, and drafts remain intact. Responsive interactions cover 320/360/390/430px phones, 360x350 short height, and 844x390 landscape. The new selector uses 16px text and a single 1px focus indicator. Touch composer controls remain at least 44px in landscape.
- Connection checks now observe the chat's connection state without requiring a visible footer. WebKit touch measurements round to a hundredth of a CSS pixel to avoid a false failure at 43.999992px.
- Session mutations use the isolated backend fixture. This follow-up did not resume or start a real agent.

## Happy Web parity and gap tracking (2026-10-23)

The [gap tracker](docs/happy-web-gap-tracker.md) preserves all 54 items from the original audit, later findings, and selected requests.
Each row records a stable ID, status, reason, and source or test evidence. It also distinguishes deliberate product choices from missing features.

This change adds historical usage reports, computer management, advanced preferences, inline tool questions, more result views, and subagent recovery.
The header uses its title capsule for info and gives the menu the same surface. The rail anchors formal response starts without a recap.
Dense rails scroll internally so that touch targets do not overlap. Recap phrase links retain their existing behavior.

Protocol checks cover encrypted rename conflicts, 204 removal responses, authenticated usage queries, and exact model IDs in spawn and send payloads.
Subagent checks cover older pages, encrypted caches, missing stops, legacy parent IDs, unresolved work, and old false attention counters.
The attention migration preserves the user's read cursor and rebuilds derived counters. It does not change Happy app state.

Responsive interactions cover 320, 360, 390, and 430px phones, a 390x360 keyboard viewport, and 844x390 landscape.
Checks include 44px targets, 16px fields, reachable dialog actions, form scrolling, inline answers, and unchanged safe-area behavior.
Chromium and WebKit cover desktop and touch contexts. Screenshots include the 320px report, 390px question, and short Chinese conversation.

The complete browser run and a final run of affected paths form the delivery evidence.
The first run found old width assertions that did not reserve rail space, and a test that expected child text in the main thread.
The revised assertions check the reserved space, nested child content, and real action reachability. They do not relax the viewport or touch requirements.
Type checking, the production build, and 459 unit tests passed. The final affected-path run passed 231 cases, with 5 conditional skips.
Across the complete and final runs, 1,010 unique cases passed and 54 have project-specific skips. No failure remains.
See the gap tracker for the per-run counts and delivery evidence.

The fixtures perform no writes to a real computer or session. No live daemon stop, machine removal, or real model turn ran during verification.
A physical iOS keyboard, installed iOS PWA, and Cloudflare production deployment remain outside these checks.
Seven known findings and five deferred features remain open in the tracker. Passing these checks does not close those items.

The existing previews on Tailscale ports 5178 and 5179 serve the tested build. The gap tracker links both URLs.
The preview check used a working-tree build before this commit, so that build displays the base commit ID.

## Private local image imports (2026-10-23)

Markdown images and image links with local paths show **Load private image** instead of a broken browser image.
Rendering a path performs no computer read or upload. The user action reads a workspace file through the CLI's encrypted
`listDirectory` and `readFile` RPCs. Rayno validates the size, raster signature, and browser decoder, then encrypts the blob
with the existing session blob key and uploads it through the authenticated attachment API.
The upload policy uses a generic filename. Original names and message/source bindings stay in encrypted session metadata.
No public URL, GitHub upload, user message, or new agent turn is created.

Imports support PNG, JPEG, GIF, and WebP files up to 4 MB inside the session workspace.
The limit leaves room for the nested base64 layers in the server's 8 MB socket frame.
Outside paths retain an actionable error; the flow does not execute a shell command to bypass the CLI's path checks.
A metadata failure can retry the uploaded ref within the same client. Saved images reopen after reload, and cached copies work offline.

- Type check and production build: passed.
- Unit tests: 482 passed across 42 files, including path resolution, invalid/outside paths, encrypted reads and uploads,
  generic upload filenames, duplicate import coalescing, invalid images, size limits, and metadata retry without another upload.
- Browser regression: 100 passed across desktop/mobile Chromium and WebKit. This includes 44 new private-image cases and
  56 existing question, permission, image upload, recovery, and tool-detail cases.
- Final private-image run: all 44 passed after adding actual download checks. Downloaded bytes match the source image.
- Responsive interactions cover 320, 360, 390, and 430px widths, a 390x360 short viewport, and 844x390 landscape.
  Touch contexts tap the changed controls. Checks include 44px targets, image dialogs, download and close reachability,
  no path-based HTTP requests, explicit retries, encrypted persistence, and offline reloads.
- The shared one-pixel PNG fixture had an invalid IDAT checksum. Its checksum was corrected so both browser decoders validate the test image.

The tests use isolated encrypted server/CLI fixtures. No private file was read from a real daemon or uploaded during verification.
Physical iOS keyboard behavior and Cloudflare production delivery were not tested. P10 is recorded as locally implemented in the gap tracker.
The build is available through the existing Tailscale route on [port 5180](https://rays-macbook-pro.tailf62d7d.ts.net:5180).
The preview's HTTP response was verified. No Tailscale route or existing service configuration was changed.

### Interactive image demo follow-up

The general preview entry had no image example. A direct demo now opens at
[`/session/private-image-demo?demo=1`](https://rays-macbook-pro.tailf62d7d.ts.net:5180/session/private-image-demo?demo=1).
It uses the already-public README screenshot and labels the operation as a demo.
The button encrypts the bundled sample in memory, and the shared image component decrypts it for the thumbnail,
dialog, and download. It performs no computer read, authenticated upload, or external request. Reload resets the example.
The direct link adds the demo session when an older saved demo state does not contain it.

All 28 demo browser cases passed across desktop/mobile Chromium and WebKit, including 320/360/390/430px,
390x360 short height, 844x390 landscape, touch activation, 44px controls, real image dimensions, download, dialog scrolling,
and the older saved state. The 482 unit tests and production build also passed.
Direct Tailscale checks in Chromium and WebKit opened and decoded the 2880x2080 image through a blob URL without page errors.

## Resizable session panels (2026-10-23)

Screens at least 1280px wide now have a draggable separator between the main conversation and Side Chat or Session Info.
Session Info supports 320–560px; Side Chat supports 360–720px. The maximum also adapts to the available space so that
at least 520px of usable main chat width remains, excluding its border. Navigation expansion and viewport changes update this limit.
Automatic clamping does not overwrite the user's preferred width, so a wider viewport restores that preference.
Each panel keeps its own width in Rayno account-scoped browser storage; demo widths use separate demo storage.

Pointer capture keeps a drag active outside the divider. Coarse pointer devices receive a separate 44px-wide target
without overlap over chat controls. Keyboard arrows adjust by 10px, Shift+arrows by 50px, and Home/End select the bounds.
Double-click or Enter restores the default. Escape cancels an active drag without closing the panel or saving its partial width.
The separator exposes its orientation, bounds, current width, and controlled panel to assistive technology.
The divider uses its line color for keyboard focus. It has no outline around the drag target.
Phone pages and tablet drawers retain their existing layouts without a resize control.

- Type check and production build: passed.
- Unit tests: 486 passed across 43 files.
- Browser tests: all 92 passed across desktop/mobile Chromium and WebKit, including 24 new resize cases and 68 existing
  Side Chat and chat appearance cases. Checks cover drag, keyboard limits and reset, cancellation, persistence, viewport and
  navigation changes, unchanged drafts, and reachable composers at minimum width.
- Chromium touch contexts exercise native touch drags through the browser input protocol. WebKit exercises pointer drag,
  keyboard operation, and the existing touch/page flows. A physical tablet gesture was not tested.
- Narrow-screen interactions cover 320, 360, 390, and 430px widths, 390x360 short height, and 844x390 landscape.
  Checks include rename forms, field focus, 16px phone text, Side Chat navigation, scrolling, and send action reachability.
- Direct Tailscale checks in Chromium and WebKit dragged both panels by 100px and verified the resulting widths without page errors.
  Screenshots remain in the ignored `test-results/screenshots/` directory.

Open the [Session Info demo](https://rays-macbook-pro.tailf62d7d.ts.net:5180/session/floating-panels/info?demo=1)
or the [Side Chat demo](https://rays-macbook-pro.tailf62d7d.ts.net:5180/session/floating-panels/side?demo=1) on a desktop viewport.
The existing preview route serves this working-tree build. No Tailscale route or existing service configuration changed.
Provider operations use isolated fixtures; no real agent was started or mutated during verification.
Cloudflare production delivery and a physical iOS keyboard remain outside these checks.


## Navigation updates and unread dots (2026-10-23)

The desktop rail and mobile tabs include an Updates icon. A new version opens a nonmodal prompt without
stealing draft focus. Users can dismiss a version for the current browser session, or explicitly reload and update.
The icon retains its available-update dot after dismissal and installs directly on click. Background failures stay
quiet; a failed explicit update preserves the page and allows retry. Online, visible pages check every five minutes
and on entry, focus, reconnect, or visibility return. The Sessions icon displays an empty dot for unread main
sessions; archived sessions, hidden side chats, and read permission requests do not create that dot.

- Type check and production build: passed.
- Unit tests: 486 passed across 43 files.
- Browser checks: 51 passed, five existing project-specific skips, across desktop/mobile Chromium and WebKit.
  All 28 new navigation-status cases passed. Existing Settings update, actual service-worker replacement,
  background unread delivery, reconnect catch-up, tab-title counts, and attention favicon cases also passed.
- Interactions cover 320/360/390/430px phones, 390x360 keyboard-height viewport, 844x390 landscape, and expanded
  desktop navigation. Tests activate controls by click or touch, verify 44px targets and hit testing, preserve drafts
  across explicit reload, dismiss and rediscover releases, and clear the unread dot after viewing a reply.
- The existing Tailscale preview also showed and dismissed the prompt in Chromium and WebKit at desktop and phone widths, with no page errors. Synthetic-release visual checks block service workers so page routing can intercept the version response.
- Release detection uses controlled version responses in browser tests; no production release was published.
  Physical iOS keyboard and Cloudflare delivery were not verified.

## Response dividers and timestamps (2026-10-23)

Each formal main-agent response begins with a 1px line and a date/time header, using the same response boundaries
as the desktop response rail. The time comes from the original server record, uses the local time zone, and follows
the interface language with a 24-hour clock including seconds. Reloading preserves that timestamp. Tool activity,
thinking, events, and recap-only records keep their existing presentation. Missing legacy timestamps show
"Time unavailable" rather than a fabricated date. Fresh demo replies include their simulated creation time.

- Type check and production build: passed.
- Unit checks at implementation time: 487 passed across 43 files, including original-server-time retention.
- Final browser run: 22 passed, two existing mobile response-rail skips, across desktop/mobile Chromium and WebKit.
  All eight new header cases passed, covering timestamp values, English/Traditional Chinese, reloads, and response boundaries.
  Existing chat-width preference and response-rail navigation checks also passed.
- Responsive interactions cover 320/360/390/430px, 390x360 keyboard height, 844x390 landscape, and 1440x900 desktop.
  Tests scroll response headers, verify line/date fit, focus and send from the composer, and check phone touch targets.
- The existing Tailscale preview displayed dated demo replies in both engines at desktop and 320px phone widths,
  accepted draft input, and reported no page errors. Screenshots remain in ignored test-results/screenshots/.
  Cloudflare production and a physical phone keyboard were not verified.

### Hide update navigation when current (2026-10-23)

The rail and phone tabs now render the update action only after detecting a newer release. Initial checks and
unknown/offline status create no placeholder or navigation gap. A later current-version response removes the action;
a confirmed update remains accessible after dismissing the prompt or a failed install. Settings retains manual checks.

- Type check and production build passed.
- All 47 applicable browser checks passed across desktop/mobile Chromium and WebKit; five existing project skips.
  Checks cover current-to-available-to-current transitions at 320/360/390/430px, short keyboard height, landscape,
  and desktop, plus update retries, dismissal, explicit reloads, unread indicators, and Settings updates.

## New-session history (2026-10-23)

Successful creation now replaces the /new history entry with the created chat. Browser Back returns to the page
before the form; Forward returns to the chat. Previously, Back reopened the completed form. Live and demo sessions
use the same navigation. Folder approval and cancellation keep the unfinished form and its draft.

- Reproduced the old behavior in mobile WebKit: Back returned to /new after successful creation.
- Type check and production build passed.
- Final browser run: all 36 cases passed across desktop/mobile Chromium and WebKit. The 32 new cases cover
  creation, Back/Forward navigation, no completed form in the DOM, usable chat drafts, and a single spawn/first send.
  Four existing folder-approval cases confirm cancellation keeps the draft and approval still starts the session.
- Interactions cover 320/360/390/430px phones, 390x360 keyboard height, 844x390 landscape, and 1440x900 desktop.
  They include touch activation, form scrolling, reachable Start controls, and the tablet session-list drawer.
- The existing Tailscale preview passed the same Back/Forward flow in both engines at 390x844 using isolated demo data.
  No real agent started. Native edge-swipe animation on a physical phone and Cloudflare delivery were not tested.

## Optional intense glass (2026-10-23)

Settings > Appearance now offers Standard and Intense glass. Standard keeps the previous appearance and is the
migration default. Intense adds static purple/blue light, translucent panels, brighter edges, and 28px backdrop blur
on floating chat controls, navigation, usage surfaces, menus, autocomplete lists, and dialogs. It does not animate the background. The setting
uses existing Rayno preference storage, including account isolation in live mode; it does not change Happy settings.
Reduced-transparency CSS and an unsupported-filter fallback provide opaque floating surfaces.

- Type check and production build passed. All 501 unit tests passed, including restoration of valid, missing,
  and malformed glass preferences.
- Browser verification covers 24 cases across desktop/mobile Chromium and WebKit: eight live/demo persistence
  and restore cases and 12 existing appearance cases passed in the combined run. All four new responsive interaction
  cases passed in the final focused run after correcting an assertion to check outline style rather than its hidden width.
- Interactions cover 320/360/390/430px, 390x360 short height, 844x390 landscape, and desktop. They change the setting,
  scroll the form, open/close Session Info and model dialogs, focus the composer, and send at every size. Changed phone
  selects use 16px text and 44px targets. Intense dialogs have 44px close controls on phones/touch devices.
- Checks confirm actual computed blur, one outer composer focus indicator, unchanged drafts, immediate restoration
  of the original body background, and persistence after reload in live and demo modes.
- Direct Tailscale checks in both engines rendered Standard and Intense, verified computed blur, and captured desktop
  and phone screenshots without page errors. Images stay in ignored test-results/screenshots/.
- Reduced-transparency hardware, unsupported browser engines, physical phone GPU performance, and Cloudflare delivery
  were not tested. A native platform preference was not changed during verification.

The final menu/modal refinement uses the same glass surface tokens for Session actions and dialogs. Intense modal
backdrops use a lighter dim layer and blur the underlying page to retain light without legible background text. Responsive checks compare the computed menu and
dialog backgrounds and open/close both by touch or pointer. Standard retains the original menu and backdrop styles.

The modal refinement also increases the minimum tint opacity of floating surfaces. This keeps underlying text
secondary even when a browser reports backdrop-filter support but omits the visual blur in its screenshot renderer.

## DiceBear Planets avatars (2026-10-23)

Appearance > Avatar style now includes DiceBear Planets. The session ID is the only seed, so session list rows,
chat headers, and Session Info share the same SVG across renames and reloads. Non-session agent choices keep provider
marks. Existing provider and initials styles remain available, with provider marks as the migration default.

The renderer uses pinned @dicebear/core 10.7.0 and only the Planets definition from @dicebear/styles 10.6.0.
It generates image data URIs locally and never calls the DiceBear API. The lazy avatar chunk is about 182 kB
(29 kB gzip), and the production service-worker precache includes it. Notices cover the MIT core and CC0 artwork.

- Type check and production build passed. All 508 unit tests passed across 44 files, including deterministic
  generation, different session seeds, and restoration of valid, missing, and invalid avatar settings.
- All 12 browser cases passed across desktop/mobile Chromium and WebKit, covering live/demo preference persistence,
  matching list/header/info sources, different sessions, rename/reload stability, encrypted-cache offline reads,
  loaded image dimensions, and restoration of provider and initials styles. No DiceBear network requests occurred.
- Responsive interactions cover 320/360/390/430px, 390x360 short height, 844x390 landscape, and desktop.
  They select the 16px/44px avatar control, open and close Session Info, send messages, and verify provider marks in
  new-session controls. Avatar images keep their existing bounds and do not add touch controls.
- Direct Tailscale checks in both engines loaded the local avatar and verified header/info consistency at phone size.
  Screenshots remain in ignored test-results/screenshots/. No real agent started or external account changed.
- Offline browser checks use the existing offline-workspace fixture and encrypted history cache. A physical phone,
  fully disconnected production service-worker reload, and Cloudflare deployment were not verified in this change.

## Reading-position response dots (2026-10-23)

The reading rail shows all loaded formal responses as a compact overview, including history fetched with Load earlier.
Dots fit in the rail whenever their minimum target spacing permits, and overflow only when necessary. Chat scroll
progress synchronizes the rail's own scroll range: oldest at the top, latest at the bottom. Independently scrolling
the dot list does not move the chat; clicking a dot jumps to its response. The current reply retains its accessible
location state, and buttons retain numbered accessible labels without displaying the numbers.

Small/medium/large dots are 6/10/14px for fewer than 500, 500–1,999, and at least 2,000 visible non-whitespace Unicode
characters. Markdown syntax, link destinations, recaps, and reply options do not contribute. Code text does count.
A weak cache retains each immutable message's metadata so streaming updates do not reparse unchanged replies.
Dot size does not change the existing 20px desktop button or 46px coarse-pointer hit area. Dense replies retain gaps.
Portrait phone layouts keep their existing no-rail behavior; the rail remains available from 768px.

- Updated behavior: type check and production build passed; all five focused anchor metadata and rail layout unit tests passed.
- Browser verification: 22 passed and two existing phone skips across desktop/mobile Chromium and WebKit.
  Covers all three dot sizes, empty button text, compact fitting, independent overflow scrolling, and chat/rail progress
  at the top, middle, and latest bottom. Loading an older response adds its dot; scrolling to the latest end still shows
  the newest dot. Clicking distant dots retains jump/flash behavior and independent touch hit areas.
- Phone interactions cover 320/360/390/430px, 390x360 short height, and 844x390 landscape, including sending, 16px inputs,
  and 44px-or-larger touch controls. The landscape rail runs in coarse-pointer contexts.
- Physical device gestures and Cloudflare deployment were not verified.

## Performance measurement baseline (2026-10-23)

`PERFORMANCE-PLAN.md` tracks the work that follows the performance and sync audit. Phase 0 adds the measurement.
Recovery marks record disconnect, connect, list refresh, open-chat catch-up, and the first RPC after a connect.
Stage timings run only when `localStorage['rayno.perf']` is `1`; `__raynoPerf.table()` shows them.
A new fixture has 3,600 session-protocol rows: 1,000 tool calls, 200 subagents, and 20 denied requests.

- Type check, production build, and 515 unit tests passed, including three new tests for the timing module.
- The baseline browser test passed in all four projects with one worker, and 12 of 12 runs passed with four workers.
  It loads all 36 history pages, closes the socket, waits for recovery, and pushes 20 replies with activity events.
- Results are in `PERFORMANCE-PLAN.md`, section 5.1. WebKit needs 2–3 s to show 20 replies in the long chat;
  the client work for those events is about 110 ms. Encryption is about 2 ms for each cache save.
- The full browser suite had 1,216 passed and 2 failed before the final test change. One failure was the new baseline
  test under parallel load, now fixed. `newSessionControls.e2e.test.ts:6` failed once under load and passed 3 of 3
  runs alone; this change does not touch that layout.
- Emulated browsers only, with no CPU throttle. A physical phone and Cloudflare deployment were not verified.

## Response body deadlines (2026-10-23)

A Happy request and an image download now read the whole response body before they clear their timer and controller.
Before this change, a body that stalled after the headers had no timeout, and closing the client could not cancel it.

- Three new unit tests cover a stalled request body, a stalled body when the client closes, and a stalled image download.
  All three fail against the previous code and pass after the change. All 515 unit tests and the type check passed.
- The image download keeps its 45-second deadline over the full body. Uploads do not read a body.
- Follow-up: each sign-in request now has a 25-second deadline. A caller cancel keeps its reason.
  Three new auth tests passed; the stalled sign-in test fails against the previous code. All 518 unit tests passed.
  32 login and connection browser checks passed across the four projects.

## Realtime and list read races (2026-10-23)

A realtime session update now applies its decrypted fields to the record that is in place after the decryption.
Before, a list read could replace the record during the decryption, and the update went to the old object.
A list read of computers now skips a row when a realtime update brought a newer version during its decryption.
New messages raise the seq of the current record, not of an object that a list read replaced.

- Two new tests hold one decryption while the other read runs. Both fail against the previous code and pass after it.
- All 520 unit tests and the type check passed. 165 browser checks passed with 3 existing skips across four projects:
  connection, agent requests, handoff, navigation status, offline workspace, and session operations.

## Activity events and the offline cache (2026-10-23)

Session and computer activity events now update the screen without a cache save.
Before, each activity event scheduled a save of the full workspace snapshot, up to two times each second.
The next save for a real change still writes the latest presence.

- A new test sends 100 activity events, then one metadata update. It fails against the previous code.
  After the change, the activity makes no save, and the metadata update makes one save with the latest `activeAt`.
- All 521 unit tests and the type check passed. 81 browser checks passed with 3 existing skips: offline workspace,
  navigation status, connection, and render isolation across four projects.

## Shared history reads (2026-10-23)

Callers that ask for the same history direction during a running read now share one later read.
Before, each caller waited and then made its own read, so ten callers made ten reads in a row.
A failure of the running read still reaches the callers that wait for it.

- The new sharing test makes 11 reads against the previous code and 2 after the change.
  A second test keeps the failure behavior; it passes before and after.
- All 523 unit tests and the type check passed. 183 browser checks passed with 5 existing skips: chat presentation,
  handoff, connection, offline workspace, recap, transcript, response dots, and response headers across four projects.

## Seq gaps in an open chat (2026-10-23)

The history cursor now moves with a realtime message that directly follows it.
A realtime message after a gap starts a quiet forward read at once for an open chat.
Before, the chat waited for a reconnect, a focus change, or a control handoff to fill the gap.

- A new gap test fails against the previous code: the missing message did not appear.
  A second test shows that a forward read starts after the realtime messages, not before them.
- One existing test now expects both forward reads after seq 5, because the realtime messages 4 and 5 move the cursor.
- All 525 unit tests and the type check passed.
- Full browser suite: 1,217 passed, 54 existing skips, 1 failed. The failure is
  `newSessionControls.e2e.test.ts:6`, which measures the header right after a viewport resize. It also failed in
  the phase 0 run, and passed 12 of 12 runs with four workers. This change does not touch layout.

## Open chat first after a reconnect (2026-10-23)

After a reconnect, an open chat that the client already knows reads its new messages at the same time as the list.
Before, it waited for the full list read, the cache save, and the attention scans of all other sessions.
An open chat that is not known yet still waits for the list. The sync still fails when any open chat fails.

- A new test keeps the attention scan of another session from answering, then reconnects.
  It fails against the previous code: the open chat never got its new reply. It passes after the change.
- All 526 unit tests and the type check passed. 157 browser checks passed with 3 existing skips: connection,
  offline workspace, navigation status, chat presentation, handoff, and agent requests across four projects.
- The baseline recovery marks are in `PERFORMANCE-PLAN.md`. That fixture has two sessions, so the change shows only in the unit test.

## Realtime update queues (2026-10-23)

Realtime updates now wait in one queue for each session and one queue for the computers.
Before, all updates shared one queue. An update for an unknown session waited for a full list read and held back
the updates of every other session.

- A new test keeps the list read from answering after an update for an unknown session.
  It fails against the previous code: the open chat did not show its new message. It passes after the change.
- A second test keeps the order inside one session: messages, then a delete, then a late message. It passes before and after.
- All 528 unit tests and the type check passed.
- Full browser suite: 1,218 passed, 54 existing skips, 0 failed.

## Stable request history (2026-10-23)

The client keeps the last result of `withRequestHistory()` with its message list and agent state.
When both are the same objects, the next publish returns the same message array.
Before, a session with a denied request and no tool call got a new array on each publish, also for activity events.

- A new test sends an activity event to such a session. It fails against the previous code and passes after it.
- All 529 unit tests and the type check passed. 76 browser checks passed: agent requests, tool results, and render
  isolation across four projects.

## Stable tool messages and groups (2026-10-23)

Each history pass and each chat grouping now reuses the previous objects that did not change.
Lists of objects with an `id` match by id, so older pages that load at the top still match.
Before, every pass built new tool messages and new `details` lists, so the ToolActivity memo check always failed.

- With 50 fixture turns and one new reply, 200 of 200 old tool messages and all old tool groups keep their identity.
  The same check without the reuse keeps 0 of 200.
- All 533 unit tests and the type check passed. 162 browser checks passed with 2 existing skips: chat content,
  tool results, transcript, recap, response dots, chat presentation, render isolation, and agent events.

## Panel resize state on the root (2026-10-23)

A drag on a resizable panel now sets `data-panel-resizing` on the root element.
Before, two `.shell:has(.resizablePanel[data-resizing])` rules set the drag cursor.
With those rules, each DOM change in the chat made the browser restyle the whole tree.
On desktop, each live reply blocked the main thread for about 200 ms.

- A diagnostic run pushed 20 replies on desktop Chromium. Frames over 50 ms went from 40 (6,043 ms in total) to 1 (55 ms).
- The resize browser test now checks that the root has the attribute during a drag and loses it after the drag.
  26 resize checks passed across four projects.
- Baseline, 20 replies shown after: desktop Chromium 215 ms (before 699 ms), desktop WebKit 1,722 ms (before 3,053 ms).
- All 533 unit tests, the type check, and the build passed.

## Inline questions only for calls with a question (2026-10-23)

The chat now builds one set of the tool call ids that have an open question, from the agent state.
A tool group mounts an `InlineToolQuestion` only for the calls in that set.
Before, each tool call mounted one, and each one subscribed to the store with a new selector on each render.
The selector is now stable for each session.

- A new unit test checks that `questionCallIds` matches `questionForTool` for 200 calls with open, closed, and form questions.
- All 535 unit tests, the type check, and the build passed.
- 276 browser checks passed with 4 existing skips: agent requests, chat actions, chat content, chat presentation,
  render isolation, tool results, web parity, and reply recap. The web parity test checks inline questions
  at phone, short, and landscape sizes in Chromium and WebKit.
