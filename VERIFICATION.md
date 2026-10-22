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
