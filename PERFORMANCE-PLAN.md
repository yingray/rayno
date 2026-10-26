# Performance and sync improvement plan

Created: 2026-10-23. Updated: 2026-10-26 (React Compiler adoption and comparison).
Input: `rayno_audit_20261023.md` (audit commit `8cd14a2`).
Plan base: `main` at `0b15c38`.

This file tracks the work. Update the status column when a step changes.
Status values: `todo`, `in progress`, `done`, `dropped`.
Record the measured results in section 5.

## 1. Review of the audit

The audit is correct in most items. I read the code at `0b15c38` for each item.
`src/happy/client.ts` did not change between `8cd14a2` and `0b15c38`.
I did not run the six probes again. I did not check the Happy upstream code.
The "verified" column below means "the code shows this behavior". It does not mean a runtime test.

### 1.1 Status of each item

| ID | Audit claim | Status at `0b15c38` | Note |
|---|---|---|---|
| N01 | Timeout ends before the body read | Verified | `return response.json()` has no `await` (`client.ts:486`) |
| N02 | REST and socket race | Verified | Socket handler keeps `current` across `await` (`client.ts:1012`); machine REST path checks the version before `await` (`client.ts:758`) |
| N03 | Open chat waits for account-wide work | Verified, with a limit | Attention scans run only for sessions with `seq > inspectedSeq`. On a first visit, this is every session |
| N04 | One promise chain for all updates | Verified | Unknown `new-message`, `new-session`, and `update-session` run `refresh(true)` inside the chain (`client.ts:1002`, `client.ts:1070`) |
| N05 | Concurrent `loadHistory` calls run in series | Verified | Recursion after `await` (`client.ts:1154`). Directions differ, so a shared request must use the direction as part of the key |
| N06 | No catch-up on a seq gap | Verified | `mergeMessages` does not compare seq values |
| N07 | Backoff 15–30 s, one `connected` state | Verified | `SYNC_RETRY_MAX = 30000`, delay is `limit/2 .. limit` (`client.ts:683`) |
| R01 | Tool messages lose identity | Verified | `join()` and `toolCalls.map` make new objects (`normalize.ts:605`); `addRow` makes new `details` (`chatBlocks.ts:35`); comparator needs the same `details` (`MessageList.tsx:115`) |
| R02 | `withRequestHistory` makes a new array | Verified | It runs on every `publish()`, after the `visibleHistory` cache (`client.ts:263`) |
| R03 | Quadratic `replies.find` in the rail | **Fixed** | `ef179c8` puts `label` into each pin. The cost is now linear: each scroll frame makes a new `pins` array and renders all pins again |
| R04 | Full history work before React | Verified | `useDeferredValue` cannot stop this work |
| R05 | Collapsed tools build content | Verified | |
| R06 | One `InlineToolQuestion` per tool call | Verified | Also, the inline selector makes a new `createSelection` on each render (`store.tsx:44`) |
| E01 | Cache rewrites the full dirty history | Verified, **more severe** | `publish()` always calls `scheduleCache()` (`client.ts:293`). A presence heartbeat marks the workspace dirty. The full workspace snapshot is then encrypted up to two times each second while an agent works |
| E02 | Full key scan on each save, no image policy | Verified | Image keys are `image.<hash>`. The session cleanup cannot match them (`offlineCache.ts:80`) |
| E03 | Background does not stop work | Verified for the client side | Server behavior not checked |
| E04 | Usage RPC each 60 s | Verified | `LiveProvider.tsx:86` |
| M01, M02, A01, O01, O02 | Scale risks | Not checked in detail | Accepted as risks, not as defects |

### 1.2 Corrections to the audit

1. **Remove R03 from batch C.** The quadratic lookup is gone. Keep a small item for the per-frame render of all pins.
2. **Move the E01 presence part to batch A.** It is a one-line change with a large effect. Presence-only publishes must not mark the cache dirty.
3. **Add a direction key to N05.** An `older` request and a `forward` request must not share one promise.
4. **E01 encryption is not the main cost.** The phase 0 baseline measured about 2 ms of encryption for each save with 1,000 tool calls. See section 5.1.
5. **Add S01, a root cause that the audit missed.** Two `.shell:has(.resizablePanel[data-resizing])` rules in `app.module.css` made each DOM change in the chat restyle the whole tree. On desktop, each live reply blocked the main thread for about 200 ms in both engines. Phone layouts have no resizable panel, so they did not show it. A CDP trace showed 4.8 s of `UpdateLayoutTree` for 20 replies.
6. **Fix the report links.** The PDF link points to a ChatGPT sandbox path. It does not open. Some GitHub links carry `utm_source=chatgpt.com`.

### 1.3 Priority check

I agree with the audit order: correctness first, then active-chat recovery, then repeated work.
I change one thing. Cheap fixes with a large effect go into the first batch, also if they are about efficiency.

## 2. Plan

Each step is one PR. Each PR has a regression test that fails before the change.

### Phase 0: Measurement (1 PR)

Add the measurement before the changes. Without it, we cannot show which change helped.

| Step | Change | Done when | Status |
|---|---|---|---|
| 0.1 | Add `performance.mark` for `transport-disconnected`, `transport-connected`, `list-refreshed`, `active-chat-caught-up`, `first-rpc-ok` | A Playwright test reads the marks after a forced disconnect | done |
| 0.2 | Time `publish`, `visible-messages`, `request-history`, `group-chat-activity`, `cache-snapshot`, `cache-encrypt`, `cache-save` when localStorage `rayno.perf` is `1` | `__raynoPerf.table()` in the console shows each stage | done |
| 0.3 | Add a fixture with 1,000 tool calls, 20 denied requests, and 200 subagents | `tests/performanceBaseline.e2e.test.ts` loads it and reports the timings | done |

Code: `src/happy/perf.ts`, `tests/fixtures/toolHeavyHistory.ts`, `tests/performanceBaseline.e2e.test.ts`.
To read the stages in a browser, set `localStorage['rayno.perf'] = '1'`, reload, then run `__raynoPerf.table()`.
`first-rpc-ok` is set only when an RPC runs after the connect. The baseline test sends no RPC, so it reports `null`.
Run the baseline with `pnpm build && pnpm exec playwright test tests/performanceBaseline.e2e.test.ts --workers=1`.
Four parallel workers made the cache timings two to three times higher.

### Phase 1: Correctness and quick wins (5 PRs) — done

| Step | ID | Change | Test | Status |
|---|---|---|---|---|
| 1.1 | N01 | Use `return await response.json()` in `request()`. Keep the timer and the controller until the body is read. Do the same in `transfer()` (`client.ts:1592`). `auth.ts` does not clear its signal early; see 1.1b | Mock fetch: headers arrive, the body stalls. The call rejects at 25 s. `dispose()` rejects it at once | done |
| 1.1b | N01 | `loginWithKey()` in `auth.ts` sends `authRequest()` with no signal, so it has no deadline. Add one | A stalled login rejects after the deadline | done |
| 1.2 | N02 | In the `update-session` handler, read the record again from `this.sessions` after each `await`. Write a new record object. In `applyMachines`, compare the version again after `await` | Two interleaving tests: session v1→v2 with a REST read in the middle; machine v2 then an old REST v1. The visible version never goes back | done |
| 1.3 | E01a | Add a `persist` flag to `publish()`. Presence and activity publishes do not call `scheduleCache()` | Unit test: 100 activity events cause zero cache saves | done |
| 1.4 | N05 | Key `historyRequests` by `id + direction`. A caller that finds a running request waits for it. If an invalidation came during that request, run one more request, not one for each caller | 10 concurrent `forward` calls cause at most 2 fetches | done |
| 1.5 | N06 | Keep `contiguousSeq` for each active session. When a socket message has `seq > contiguousSeq + 1`, schedule a `forward` read at once | Drop one socket message in the mock. The chat fills the gap without a reconnect | done |

### Phase 2: Active chat first (2 PRs) — done

| Step | ID | Change | Test | Status |
|---|---|---|---|---|
| 2.1 | N03 | Split `syncWorkspace()`. On reconnect, start the `forward` read for active sessions at the same time as the list read. Run `flushCache()` and the attention scans after both, without `await` in the recovery path | Make the attention fetch take 10 s. `active-chat-caught-up` still arrives in less than 2 s | done |
| 2.2 | N04 | Queue updates per session. Replace `refresh(true)` inside the queue with a coalesced, scheduled refresh. Events for known sessions do not wait for it | An unknown-session event with a slow refresh does not delay a `new-message` for the open chat | done |

Keep the full session list. Do not cut it to 150 rows. Make the list read progressive instead.

### Phase 3: Remove repeated work (5 PRs)

| Step | ID | Change | Test | Status |
|---|---|---|---|---|
| 3.1 | R02 | Cache the `withRequestHistory` result by `history.messages` and `agentState` identity | Two publishes with the same inputs return the same array | done |
| 3.2 | R01 | Keep a per-session cache from message id and tool result revision to the output object in `visibleMessages`. In `groupChatActivity`, reuse a block and its `details` when its inputs did not change | Append one text to 1,000 tool groups. 1,000 of 1,000 old groups pass the memo comparator | done |
| S01 | S01 | Move the drag state for the resizable panels to an attribute on the root. Remove the `.shell:has(...)` rules | During 20 live replies on desktop, frames over 50 ms go from 40 to at most 1. The resize test checks the root attribute during and after a drag | done |
| 3.3 | R06 | Build one `callId → question` map for each `agentState`. Mount `InlineToolQuestion` only for calls in that map. Hoist the selector out of the render | Subscriber count does not grow with the tool count | done |
| 3.4 | R05 | Mount tool details only when the row expands. Change the recap jump: find the target in the data, expand it, then scroll | Existing recap jump tests pass. Add one for a collapsed tool target. Verify RWD at 320, 360, 390, 430 px, short keyboard viewport, and landscape, in Chromium and WebKit | done |
| 3.5 | E01b, E03 | Save history in pages, or save only the new rows since the last save. Merge timestamp-only activity updates. Pause attention scans while the page is hidden; catch up on `visibilitychange` | Append 3 rows to a 1,000-row history. The save writes 3 rows, not 3,006. No attention fetch while hidden | done, changed: see results log |

Do not remove encryption to make the cache faster.
If the encryption is still a long task after 3.5, move it to a worker as a separate step.

### Phase 4: Long-term limits (as needed)

| ID | Change | Status |
|---|---|---|
| E02 | Store image keys with the session id. Add an LRU and a size budget. Run the stale-history cleanup at most once for each session list change, not on each save | done: session id in image keys, the scan on list change, persistent storage, and an image budget (section 6.5). Text history is never evicted |
| E04 | Refresh usage only while the usage UI is visible, or cache it on the daemon side. Stop the machine loop when the page becomes hidden | no change needed: the usage loop already stops when the tab is hidden or loses focus (`LiveProvider.tsx:89`). Live mode has no machine loop; monitor refresh runs on a click |
| M01 | Add an LRU for decrypted history of sessions that are not open. Evaluate list virtualization with the recap, anchors, selection, and copy | measured: no history LRU now; closed chats stay below the 50 MB trigger. After L01/L02, bounded rendering cuts a 600-turn desktop WebKit reply from 260 ms to 53 ms. A complete virtualizer prototype is now recommended; production UI stays unchanged (section 6.8) |
| M02 | Add a total size budget for attachments. Limit hash and upload concurrency | done: at most 4 at the same time. The limits stay at 20 images and 10 MB, the claude.ai limits (section 6.3). No resize |
| O01 | Add a queue limit to the Mermaid worker. Cancel stale jobs. Separate queue time from run time | done |
| O02 | Measure grouping, new-session input, and file suggestions | done, measured: group filters take at most about 2 ms of a 125–291 ms large-list switch. Typing does not render the session list. A 50,000-file search takes about 6–21 ms by query median. Defer implementation (section 6.9) |
| A01 | Measure cold install, warm cache, and updates; remove the demo image from unconditional precache | done: cache the demo image on first use, with at most 2 versions for 60 days. Cold gzip bodies fall from 1.89 to 1.10 MB in Chromium and 2.41 to 1.63 MB in WebKit. Warm shell reload remains 0 network bytes. Font and chunk changes remain optional follow-ups (section 6.11) |
| V01 | Build a complete virtualizer with data-based recap/rail navigation, scroll restoration, and a full-transcript mode | prototype complete, off by default: TanStack Virtual with data navigation, encrypted reading anchors, and full-transcript mode. The tool toggle minimum is 44px. Physical-device validation and production latency checks remain before default rollout (section 6.12) |
| L01 | Load older history pages without a new pass over all loaded rows | done: the cause was the reply rail, not the data pass. It ran one list query for each reply. A late page in a 600-turn chat: Chromium 199 to 274 ms to 107 to 137 ms, WebKit 845 to 927 ms to 512 to 593 ms (section 6.7) |
| L02 | Make the per-reply message pipeline (`visibleMessages`, `markSubagents`, `reuseEqual`) work on the changed rows only | measured, no change: the pipeline takes about 10 ms for 10,800 rows. The rail fix also cut a live reply: Chromium 114 to 116 ms to 31 to 46 ms, WebKit 426 to 469 ms to 252 to 310 ms (section 6.7) |
| R03 rest | Keep the pins array stable. Update only `active` and `thumb` on scroll | done |

## 3. Verification for the full plan

Fix these inputs for each before/after run: account, relay, daemon version, device, browser, network, data size, deploy SHA.

| Area | Metric |
|---|---|
| Recovery | Time from disconnect to each Phase 0 mark |
| Main thread | Long tasks and the time of each stage during an agent run |
| Steady cost | CPU, network, and IndexedDB writes in the foreground, the background, and with usage on and off |
| Growth | Heap, DOM nodes, and IndexedDB size after opening 10 long chats |

Keep the existing render isolation tests. Add the new fixtures to the same suite.

## 4. Open questions

1. Phase 2.1 changes when the warning appears. `AGENTS.md` says to show it only after a failed attempt. Does a slow attention scan count as a failure? My default: no.
2. Do we want a dual-site comparison with the official Happy app, or only before/after on Rayno? Before/after is enough to accept each PR.

## 5. Results log

Add one row for each measured run. Keep the raw JSON in `test-results/` or attach it to the PR.
The baseline uses Playwright emulation on a Mac, with no CPU throttle. It is not a physical phone.

### 5.1 Baseline, 2026-10-23, `0b15c38` plus phase 0

Fixture: 3,600 rows, 1,000 tool calls, 20 denied requests. The test loads all 36 history pages.
Times are in ms. "Mean / max" is for one call.

| Browser | `publish` | `visible-messages` | `group-chat-activity` | `cache-encrypt` | `cache-save` | Long tasks during load |
|---|---|---|---|---|---|---|
| Desktop Chromium | 1.6 / 3.3 | 0.9 / 2.2 | 0.03 / 0.3 | 1.9 / 3.7 | 219 / 678 | 1, 51 ms |
| Mobile Chromium | 1.6 / 3.5 | 0.9 / 2.3 | 0.03 / 0.2 | 1.9 / 3.6 | 53 / 114 | 0 |
| Desktop WebKit | 2.0 / 6 | 1.2 / 2 | 0.08 / 1 | 1.7 / 4 | 178 / 452 | not reported |
| Mobile WebKit | 1.9 / 4 | 1.1 / 2 | 0.05 / 1 | 1.5 / 3 | 141 / 1,379 | not reported |

Recovery after a forced socket close, in ms from `transport-disconnected`:

| Browser | `transport-connected` | `list-refreshed` | `active-chat-caught-up` |
|---|---|---|---|
| Desktop Chromium | 1,210 | 1,246 | 1,306 |
| Mobile Chromium | 1,071 | 1,089 | 1,128 |
| Desktop WebKit | 1,502 | 1,588 | 1,768 |
| Mobile WebKit | 1,068 | 1,094 | 1,144 |

What this baseline shows:

1. Most of the recovery time is the Socket.IO reconnect delay. The fixture has two sessions, so N03 cannot show here. A test for N03 needs many sessions and a slow attention fetch.
2. `cache-encrypt` is about 2 ms for each save. Most of the `cache-save` time is the IndexedDB transaction and its key scan (E02). That time is asynchronous, so it does not block input. The audit's main-thread concern for E01 is small at this size. The repeated writes are still real.
3. `publish` costs 1.5 to 2 ms for each event. During live replies, 20 activity pings and 20 replies made 40 publishes. Step 1.3 removes the cache work from the activity publishes.
4. `group-chat-activity` is cheap. The cost of R01 is in the React render of `ToolActivity`, which these stages do not time. Use a React profile for step 3.2.
5. The render cost shows in WebKit. The test pushes 20 replies, then waits until the last one is in the DOM.
   This time includes the time that the test needs to send the 20 replies.
   With four parallel workers, WebKit sometimes needed more than 5 s. So this is the main metric for steps 3.2 and 3.4.

| Browser | 20 replies shown after | `publish` total for those 40 events |
|---|---|---|
| Desktop Chromium | 699 ms | 58 ms |
| Mobile Chromium | 256 ms | 55 ms |
| Desktop WebKit | 3,053 ms | 110 ms |
| Mobile WebKit | 2,000 ms | 108 ms |

The client work is about 110 ms. Most of the 2–3 s in WebKit is React render and layout of the long list.

| Date | Commit | Step | Browser | Result |
|---|---|---|---|---|
| 2026-10-23 | `2b7fed4` | 0 | All four projects | Baseline above |
| 2026-10-23 | `e47b3f3` | 1.1 | Vitest | Three new tests fail before the change and pass after it |
| 2026-10-23 | `84458f3` | 1.1b | Vitest, 32 login and connection browser checks | The stalled sign-in test fails before the change and passes after it |
| 2026-10-23 | `9a8df11` | 1.2 | Vitest, 165 sync browser checks | Two race tests fail before the change and pass after it |
| 2026-10-23 | `8088e84` | 1.3 | Vitest, 81 offline and presence browser checks, baseline | 100 activity events now cause no cache save. The baseline live phase still saves 0–2 times, because the replies change history |
| 2026-10-23 | `796d091` | 1.4 | Vitest, 183 history browser checks | 11 forward calls during one read now make 2 reads, not 11 |
| 2026-10-23 | `281aaef` | 1.5 | Vitest, full browser suite | A seq gap now reads at once. Full suite: 1,217 passed, 1 failed (`newSessionControls.e2e.test.ts:6`, a layout check right after a resize; it passed 12 of 12 runs alone with four workers) |
| 2026-10-23 | `bc37fa7` | 2.1 | Vitest, 157 recovery browser checks, baseline | A never-ending attention scan no longer blocks the open chat. Baseline connect to caught-up: 55–160 ms, before 57–266 ms; the two-session fixture has no slow scan |
| 2026-10-23 | `2c50faf` | 2.2 | Vitest, full browser suite | An update that waits for the list no longer blocks other sessions. Full suite: 1,218 passed, 54 existing skips, 0 failed |
| 2026-10-23 | `a7bcec9` | 3.1 | Vitest, 76 request and tool browser checks | An activity event keeps the same message array for a session with a denied request |
| 2026-10-23 | `c417db4` | 3.2 | Vitest, 162 chat browser checks | After one new reply, 200 of 200 old tool messages and all old tool groups keep their identity; without the change, 0 of 200 |
| 2026-10-23 | `c8820b5` | S01 | Vitest, 26 resize browser checks, diagnostic, baseline | Desktop Chromium frames over 50 ms during 20 replies: 40 (6,043 ms) before, 1 (55 ms) after. 20 replies shown after: desktop Chromium 215 ms, mobile Chromium 161 ms, desktop WebKit 1,722 ms, mobile WebKit 1,128 ms |
| 2026-10-23 | `a014cea` | 3.3 | Vitest, 276 chat and request browser checks, baseline | With 200 tool calls and 2 open questions, the chat mounts 2 question components, not 200. 20 replies shown after, one run each: desktop Chromium 441 ms, mobile Chromium 333 ms (0 long tasks; the Chromium change from S01 is run noise), desktop WebKit 1,546 ms, mobile WebKit 897 ms |
| 2026-10-23 | `2e85235` | 3.4 | Vitest, full browser suite, baseline | Load long tasks in Chromium: desktop 826 ms to 0, mobile 561 ms to 0. 20 replies shown after, one run each: desktop Chromium 168 ms, mobile Chromium 135 ms, desktop WebKit 1,373 ms, mobile WebKit 670 ms. Also fixed an older bug: on phones, a recap jump into a collapsed tool group did not scroll |
| 2026-10-23 | `30a78b6` | 3.5 | Vitest, full browser suite | History saves in pages of 100 rows by seq. 3 new rows in a 1,000-row history rewrite 1 page, not all 1,003 rows. A hidden tab scans attention every 30 s, not every 5 s; it does not stop, because the tab title shows the attention count. Activity updates were not merged: after 1.3 they cost about 2 ms and save nothing |
| 2026-10-23 | `2f97cb8` | R03 rest | 152 recap, response dot, and parity browser checks | The rail keeps its pins array while only the scroll position changes. Each pin is a memo component, so a scroll frame renders only the pins whose active state changed. No new test: this changes render work only |
| 2026-10-23 | `9b760f3` | E02 part 1 | Vitest, full browser suite | New image keys hold the session id, and a scan deletes the images of removed sessions. Reads fall back to the old key. The key scan runs only when the session list changes; a removed page is deleted by its key |
| 2026-10-23 | `e08a7db` | E02 persist | Vitest, 8 sign-in and 41 offline and connection browser checks | A remembered sign-in asks for persistent storage in the click. A session from an earlier visit asks on the first click or key press, once, and not when the data is already persistent |
| 2026-10-24 | `33d4f9b` | E02 image budget | Vitest, image budget browser test, full browser suite | Images are deleted least recently viewed first above 250 MB or 10% of the quota. With a budget of 2.5 images, a third image removes the oldest one, and the two newest open offline. Full suite: 1,242 passed, 0 failed |
| 2026-10-24 | `2b4bbd2` | M02 | Vitest, 162 image and composer browser checks | Image hashing and uploads run at most 4 at the same time. Before, hashing read all images together and uploads ran one at a time |
| 2026-10-24 | `e80cc14` | O01 | Vitest, full browser suite | The Mermaid worker gets one job at a time. The timeout starts when a job runs, and a timeout ends only that job. A changed or unmounted diagram removes its waiting job. At most 8 jobs wait. Full suite: 1,242 passed, 0 failed |
| 2026-10-24 | after `e80cc14` | M01 measurement | Memory browser test, desktop Chromium, two runs | A visited chat with only its first page keeps 58 to 117 KiB after the user leaves it. A chat with all 1,000 tool calls loaded uses about 12.3 MB while open and keeps about 4.0 to 4.5 MB after the user leaves it. Decision: no LRU now |
| 2026-10-24 | `7878e91` | Virtualization evaluation | Temporary frame probe, desktop Chromium and WebKit, one worker | See section 6.6. Decision: no list virtualization now; no `content-visibility` |
| 2026-10-24 | after `23aea8d` | L01, L02 | Vitest, temporary probe in an unminified build, rail and recap browser checks, full browser suite | See section 6.7. A new browser test fails on the old build (19 rail queries for one reply). Full suite: 1,247 passed, 0 failed |
| 2026-10-24 | `3ec6672` plus retained probes | WebKit virtualization, O02, A01 | 22 successful browser probes across four projects; real service workers in Chromium and WebKit; 556 unit tests | See sections 6.8–6.10 and `WEBKIT-SCALING-EVALUATION.md`. Timing builds are isolated. No production behavior changed. Raw samples are checked into `benchmarks/results/2026-10-24.json` |
| 2026-10-24 | after `ca75206` | A01 demo image | Generated-worker regression, demo UI matrix, offline account flows, PWA update, HTTP transfer probe | Cold gzip bodies: Chromium 1,886,032 to 1,104,845 B; WebKit 2,413,637 to 1,632,450 B. Demo image works offline after first online use. Raw record: `benchmarks/results/2026-10-24-pwa-slim.json` |

## 6. Research for the Phase 4 limits (2026-10-23)

The remaining Phase 4 items need limits. This section records what browsers and similar apps do.
Section 6.5 gives the recommendation. A number that no source gives is marked as a judgment.

### 6.1 Browser storage

| Fact | Source |
|---|---|
| Chrome and Edge: up to 60% of the disk for each origin | MDN |
| Firefox best-effort: 10% of the disk or 10 GiB, the smaller. Persistent: up to 50% of the disk | MDN |
| Safari 17 and later: about 60% of the disk for the browser app | MDN |
| Under storage pressure, the browser deletes best-effort origins in LRU order. It deletes all data of an origin at once | MDN |
| Safari deletes script data of an origin after 7 days of browser use with no user interaction. A Home Screen web app does not have this rule | MDN |
| `navigator.storage.persist()` protects the origin from pressure eviction. Ask for it in a user gesture, not on page load | web.dev |

Rayno does not call `navigator.storage.persist()`. So all offline data is best-effort now.
The quota is not the real risk. The real risk is that the browser deletes all of the data at once.

### 6.2 Similar apps

| App | Text history | Media |
|---|---|---|
| Signal | Kept forever by default. The user can set a limit by count (100 to 5,000) or by age (30 days to 1 year) | Removed with the trimmed messages |
| Telegram | Kept in the cloud | Local cache with a size limit (5, 16, or 32 GB) and a "keep media" age. The oldest files go first, and they download again on demand |
| Slack web | Persists its store in IndexedDB. No public message limit | The browser cache holds files. Cache buckets older than 7 days are deleted |
| Workbox (runtime cache) | Not applicable | `maxEntries`, `maxAgeSeconds`, and `purgeOnQuotaError: true` for caches that can download again |

The common pattern: keep text, and put a size or age limit only on media that the app can download again.

### 6.3 Image attachments

| Fact | Source |
|---|---|
| claude.ai: 20 images for each message, 10 MB for each image | Anthropic vision docs |
| Claude 4.7 and later models scale an image down to a long edge of 2,576 px. Other models use 1,568 px | Anthropic vision docs |
| Signal standard quality sends images at about 1600 px | Signal Desktop issues |
| Uppy uploads at most 5 (XHR) or 6 (S3) files at the same time. 6 is the HTTP/1.1 limit for each host | Uppy docs |

Rayno already uses the claude.ai limits (`attachments.ts:3`). The gap is the work before the upload:
all images are read and hashed at the same time.

### 6.4 Worker queues and memory

No standard gives numbers. The common rules for a worker queue are: a bounded queue with an admission rule,
an id for each job so that the page drops a stale result, and a timeout that starts when the job runs, not when it waits.
For memory (M01), no public limit from a chat app was found. Measure first.

### 6.5 Recommendation

| Item | Recommendation | Basis |
|---|---|---|
| E02 persist | Ask for `navigator.storage.persist()` after sign-in, in the user gesture. Show nothing extra if the browser declines | MDN, web.dev |
| E02 text history | Do not evict. This matches AGENTS.md and the Signal default | Signal |
| E02 images | LRU by last view, with a budget of 250 MB or 10% of the quota from `navigator.storage.estimate()`, the smaller. On `QuotaExceededError`, delete images first, then save the history again | Telegram, Workbox. The 250 MB number is a judgment |
| M02 | Hash and read at most 4 images at the same time. Upload at most 4 at the same time. Keep the 20 image and 10 MB limits | Uppy. The number 4 is a judgment |
| M02 resize | Do not resize now. The image is also the copy that the user sees in the chat. This needs a separate decision | Anthropic vision docs |
| O01 | At most 1 pending job for each diagram (a new one replaces the old one), and at most 8 in total. Start the timeout when the job runs | Worker queue practice. The numbers are judgments |
| M01 | Measure the heap with 20 open and closed tool-heavy chats first. Decide after the measurement | No source |

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://web.dev/articles/persistent-storage
- https://developer.chrome.com/docs/workbox/modules/workbox-expiration
- https://slack.engineering/service-workers-at-slack-our-quest-for-faster-boot-times-and-offline-support/
- https://telegram.org/blog/cache-and-stickers
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://github.com/signalapp/Signal-Desktop/issues/7725
- https://uppy.io/docs/aws-s3/
- https://uppy.io/docs/xhr-upload/

### 6.6 List virtualization evaluation (2026-10-24)

Input: HEAD `7878e91`, a production build, desktop Chromium and desktop WebKit, one worker.
The chats use `toolHeavyHistory`, with all history pages loaded. One turn has 5 tool calls.
A temporary probe measured the time to the next paint. In Chromium, it also read long animation frames.
The probe is not in the repo.

| Measure | 200 turns, Chromium | 600 turns, Chromium | 200 turns, WebKit | 600 turns, WebKit |
|---|---|---|---|---|
| DOM elements in the list | 12,006 | 36,006 | 12,006 | 36,006 |
| Live reply shown | 15 ms | 66 to 104 ms | 80 to 111 ms | 282 to 285 ms |
| Open the chat again | 169 ms | 549 to 681 ms | 378 ms | 908 ms |
| Forced layout after a width change | 6 ms | 18 ms | 20 ms | 56 ms |
| Scroll frame, 95th percentile | 20 ms | 18 ms | 33 ms | 23 ms |

Where a live reply spends its script time (600 turns, Chromium, unminified build, CPU profile):

| Part | Share | Changes with virtualization |
|---|---|---|
| Message pipeline: `visibleMessages`, `markSubagents`, `reuseEqual`, normalize | about 57% | no |
| React render and commit | about 39% | partly; `MessageList` itself is 10% to 14% |

`content-visibility: auto` on messages and tool groups was also tested:

- It cuts the forced layout (18 ms to 2 ms in Chromium, 56 ms to 7 ms in WebKit).
- It adds paint work later. Long animation frames for a live reply went from about 65 ms to about 220 ms in Chromium.
- In WebKit, the list does not stay at the bottom after a live reply. The gap was 172 to 325 px.

Decision:

- No list virtualization now. Scrolling is smooth at 600 turns. Below 200 turns, a live reply costs 15 ms in Chromium.
- Most of the cost that grows with the chat is in the message pipeline. Virtualization does not change it. L02 is the next step. Correction in section 6.7: this share counted only script time and left out DOM queries. The rail was the larger cost.
- Loading old history is the slowest part. The 600-turn chat has 10,800 rows in 108 pages. Loading all pages took 88 s in Chromium and 192 s in WebKit, with two workers in parallel. Each page runs a pass over all loaded rows (L01). Correction in section 6.7: most of this time was the Playwright text search of the test.
- Virtualization breaks features that read the DOM: the recap jump (`findRecapTarget`), the reply rail (`ResponseRail`), page search, copy across messages, and scroll restore. Each needs a new design.
- No `content-visibility`, because it breaks the bottom pin in WebKit.
- Do it again when a live reply in WebKit takes more than 200 ms after L02, at the chat size that real users load.

### 6.7 L01 and L02 (2026-10-24)

A new probe waits inside the page, so Playwright text queries do not add DOM work.
It loads all 107 older pages of the 600-turn chat, then sends 3 live replies.
Both builds are unminified. Each run uses one worker.

| Measure | Chromium before | Chromium after | WebKit before | WebKit after |
|---|---|---|---|---|
| All 107 older pages | 10.6 s | 7.9 s | 42.6 s | 38.5 s |
| One of the last 5 pages | 199 to 274 ms | 107 to 137 ms | 845 to 927 ms | 512 to 593 ms (one 1,119 ms) |
| Live reply shown | 114 to 116 ms | 31 to 46 ms | 426 to 469 ms | 252 to 310 ms |

Corrections to section 6.6:

- The 88 s and 192 s came mostly from the test. Its `getByText` search read the whole DOM on each poll.
- The 57% share counted only script time. A CPU profile of page 100 showed the real cost: the reply rail (`ResponseRail`) ran one `querySelector` over the list for each reply. That was about 120 of 230 ms.
- In Node, the message pipeline takes about 10 ms for 10,800 rows: `visibleMessages` 6.8 ms, `markSubagents` 1.3 ms, `contextUsage` 1.1 ms, `latestTodos` 1.2 ms, `reuseEqual` 0.2 ms.

Change: the rail reads all `[data-message-id]` elements with one query. `contentOffsets` reads the scroll box once for all replies.
The rail pass on page 100 went from about 120 ms to about 26 ms.

L02 has no code change. A pass over changed rows only would need new rules for receipts, subagent bounds, and joins of results.
That saves at most about 10 ms for each reply at this size.

What remains grows with the DOM: style and layout for 36,000 elements, and the React pass over 3,600 blocks.
This is the case for virtualization in section 6.6. WebKit pays about 4 times more than Chromium for it.

### 6.8 WebKit bounded rendering (2026-10-24)

The retained probe uses a minified production build and one browser worker.
It waits inside the page and reports seven event-to-rendering-opportunity samples.
At 600 turns, desktop WebKit has a 260 ms median with the full list and 53 ms with only 60 rendered blocks.
The first sample has 36,003 DOM elements in the full list and 1,201 in the tail.
At 200 turns, the full list has a 78 ms median in desktop WebKit.

Decision: a complete virtualizer prototype is worthwhile for large chats.
Prefer TanStack Virtual with stable block keys and one owner for scroll and resize behavior.
The prototype must move recap and rail navigation to data, restore anchors, and offer full-transcript search and selection.
The current 60-block experiment loses old pins and text. Do not deploy it.
The full and tail phone probes both show an existing 41px landscape tool target.

See `WEBKIT-SCALING-EVALUATION.md` for the candidate comparison, method, limits, and integration plan.

### 6.9 O02 (2026-10-24)

At 100 sessions, a project-group switch has a 24–26 ms median across the four projects.
At 1,000 sessions, it has a 182–244 ms median. Repeated filters take about 0–2 ms.
The session list has no renders during 19 new-session input events.
Desktop selectors still run about 19,000–20,000 times, while phone selectors run 179 times.
The sampled input median is about 33 ms, with a two-frame floor. It is not a physical typing latency measurement.

The 50,000-file index has 100,101 entries after folders are added.
Its parse takes 25–41 ms in the 1,000-session runs; query medians reach 21 ms.
Decision: keep the measurements; defer O02 changes until real-device evidence shows a practical delay.
One-pass grouping alone does not address the measured UI cost.

### 6.10 A01 (2026-10-24)

An HTTP server counts gzip response bodies from the page and service worker.
Cold installs transfer about 1.89 MB in Chromium and 2.41 MB in WebKit.
The warm shell reload sends no network request. A small CSS/build update transfers about 446 KB in both engines.
The unchanged check uses two validation requests: no response body in Chromium, about 9.7 KB in WebKit.
Both engines reopen the updated sign-in shell offline.

The demo screenshot alone transfers 781,318 gzip bytes on cold install.
Recommend removing it from unconditional precache, with first-use caching if offline demo access remains required.
Then review unused font entries and hash changes through shared imports.
Keep the account shell and offline history behavior. No service-worker policy changed in this evaluation.

### 6.11 A01: cache the demo image on first use (2026-10-24)

`vite.config.ts` excludes `demo-chat-*.png` from precache.
A separate `rayno-demo-images` CacheFirst route stores successful responses on first use.
The cache keeps at most two versions for 60 days. The Mermaid route and the other precache resources stay as before.
The paired builds use the same source base, `00c9fa7`, so the comparison excludes unrelated product changes since the original evaluation.

| Cold response bodies, gzip | Before | After | Reduction |
|---|---:|---:|---:|
| Chromium | 1,886,032 B | 1,104,845 B | 781,187 B (41.4%) |
| WebKit | 2,413,637 B | 1,632,450 B | 781,187 B (32.4%) |

The HTTP probe sees no demo image request during installation in either engine.
The warm reload still transfers no bytes. A small release transfers 446,742 B in both engines.
The decoded shell cache falls from 3,575,657 to 2,753,477 B, with 85 unique entries instead of 86.

The generated-worker regression fails on the previous precache build and passes on the new build.
It checks first-use caching, an offline miss with a usable retry, online retry, and offline image view and download after reload.
An unused demo image requires an online load before it becomes available offline.
Existing account-history and image encryption remain unchanged.

The installed-account test now covers desktop WebKit as well as Chromium.
It delays worker registration until the mocked account data is saved, because a controlling WebKit worker bypasses page-route API mocks.
It then loads the real diagram worker through the installed service worker and reopens the account fully offline.

### 6.12 V01: complete virtual transcript prototype (2026-10-24)

The prototype uses TanStack Virtual 3.14.22 with stable `ChatBlock` keys and measured, variable row heights.
It is off by default. Enable **Settings → Appearance → Faster long chats (preview)** for one Rayno account.
It applies when a chat has at least 300 loaded blocks. Shorter chats retain the normal full list.

- The viewport mounts the visible range, eight extra rows on each side, and any focused or selected target row.
  A tool group remains one row. Its internal tool list is not a second virtual list.
- The reply rail uses every loaded reply and virtual measurements. A rail jump mounts its target before the DOM jump.
  A recap searches reply and tool data within its user turn, then mounts and reveals its target.
- Chat has no transcript toolbar or loaded-message search dialog.
- Turn off **Settings → Appearance → Faster long chats (preview)** to show the full transcript.
  The account preference controls the mode. Saved session positions do not override it.
  Mode changes preserve the reading row and its offset below the overlay header.
- The chat viewport owns virtual scrolling, resize correction, and follow-to-latest behavior.
  The original resize follower stops while the prototype owns the conversation, including full-transcript mode.
  Explicit user input can stop a pending jump. Focused controls remain mounted during a scroll.
- Width, font, compact-tool, and language changes clear stale height estimates.
  Position restoration waits for history and encrypted position reads. It also accounts for loading banners and overlay padding.
- Tool and thinking expansion state stays in the account-owned UI store through virtual unmounts.
  Saved live reading anchors use the account encryption key and storage scope for its account and server.
  Scrolling does not publish a workspace update or rewrite the message history cache.
- Tool group toggles now have a 44px minimum height, including landscape.
  Chat reserves no space for transcript tools. The first loaded message stays below the header.
  Embedded side chats retain their offline banner and composer spacing.
- The normal full list also handles a queued scroll event after a tall reply increases the scroll height.
  That event keeps the existing tail pin unless the user scrolls upward. A manual history position still stays fixed.

The isolated source uses base `d9b8f64` plus this change. It excludes changes from other active work sessions.
Both timing variants include the same code and the tail-pin fix; the virtual build changes only the preference default.
These are paired rendering measurements, not a comparison with the previous release.
One browser worker runs each case in sequence. Each case sends seven replies after all history loads and the view returns to latest.
The timer starts before fixture encryption and send, then ends at the second animation frame after the tail article mutation.
It does not measure a physical display timestamp. Full raw samples and source hashes are in
[`2026-10-24-virtual-prototype.json`](benchmarks/results/2026-10-24-virtual-prototype.json).

| Engine | Turns | Full reply median (range), ms | Virtual reply median (range), ms | Full → virtual history load, s |
|---|---:|---:|---:|---:|
| Chromium | 200 | 30.9 (30.8–32.5) | 30.1 (29.3–34.1) | 1.25 → 1.22 |
| Chromium | 600 | 41.8 (39.4–45) | 29.3 (28.5–48) | 5.77 → 3.62 |
| WebKit | 200 | 84 (80–89) | 30 (27–32) | 3.76 → 2.23 |
| WebKit | 600 | 229 (225–246) | 46 (43–49) | 29.51 → 8.00 |

The 600-turn fixture has 10,800 protocol records and 3,000 tool calls.
The conversation DOM median falls from 39,645 descendants to 280, while all loaded replies retain rail targets.
Every reply sample has a zero bottom gap. The WebKit median falls by 79.9% at 600 turns.
The final WebKit ranges are 27–32ms at 200 turns and 43–49ms at 600 turns.
These seven-reply samples do not establish a production tail-latency bound. Keep the preference off by default.

The full pipeline, loaded history, and search data remain in memory. A very large single tool group can still mount many controls.
Anchors identify blocks, not inner tool calls. Exact restoration when older records merge into the first tool group needs a separate probe.
Physical iPhone Safari, real keyboard transitions, assistive technology, and production latency need validation before a default rollout.
Automated phone checks use Chromium and WebKit emulation, including a short keyboard viewport and landscape.


## 8. React Compiler adoption, 2026-10-26

Base: `8400406`. The build uses `babel-plugin-react-compiler@1.0.0` through Vite's `reactCompilerPreset`, with React 19 as its target.
Development and production builds enable it by default. `RAYNO_REACT_COMPILER=0` disables it for a comparison build.
Existing manual memoization and store subscriptions stay in place.
A source audit reports 78 successful function compilations and diagnostics for 32 distinct functions that the compiler leaves unchanged.
Unsupported `try/finally`, render-time ref access, and the virtualizer's incompatible-library diagnostic account for most exclusions.
No compiler safety checks are disabled. A successful build does not mean that every component is compiled.

The comparison uses `tests/performanceBaseline.e2e.test.ts`, one worker, and three runs per browser project for each build.
The fixture has 200 turns, 1,000 tool calls, and 20 live replies.
`shownAfter` includes fixture encryption, socket delivery, React work, and layout. It does not isolate React rendering.
The browsers use desktop and phone emulation on a Mac, without CPU throttling. No physical iPhone is measured.

| Project | Compiler off median (range), ms | Compiler on median (range), ms | Later off control (two runs), ms |
|---|---:|---:|---:|
| Desktop Chromium | 122 (118–131) | 252 (172–256) | 281–286 |
| Mobile Chromium | 193 (95–194) | 133 (122–366) | Not run |
| Desktop WebKit | 1,239 (1,011–1,351) | 1,356 (1,353–2,048) | 1,146–1,912 |
| Mobile WebKit | 861 (704–945) | 865 (754–963) | Not run |

The later control overlaps the compiler results. These sequential samples do not establish a consistent speedup or an isolated compiler regression.
Keep this as an adoption and compatibility change; do not claim a measured production speedup.
Local build wall time changes from 2.17s to 4.15s in one sample per variant.
The Workbox precache report changes from about 2,753.9 to 2,807.5 KiB; this is an uncompressed asset sum, not transfer size.
Raw browser samples and the source audit are in [2026-10-26-react-compiler.json](benchmarks/results/2026-10-26-react-compiler.json).

To repeat the comparison, build with `RAYNO_REACT_COMPILER=0 pnpm build`, run the stage-timing case with one worker,
then run `pnpm build` and repeat the same case. Finish with the compiler enabled.

Validation for the default compiled build: all 577 unit tests pass.
The production browser selection has 320 passes and 72 device-specific skips across Chromium and WebKit.
It covers input and IME, suggestions, reply options and its demo, full and virtual reading positions,
model choices, session menus, new sessions, resizing, and embedded side chats at phone and desktop sizes.
Two additional demo interaction cases pass against the development server, with Compiler output and Fast Refresh both verified.
All 28 timing cases pass. Frozen-lockfile installation, typecheck, production build, and diff checks pass.

The built site also serves `/reports/react-compiler.html` without sign-in, with a JSON download beside it.
The page derives its timing tables from the raw result file. Report disclosure, download, and mobile reading pass in 24 Chromium and WebKit cases.


## 9. Paired Compiler measurements, 2026-10-26

The follow-up uses runtime gating in one payload per phase. Fresh pages alternate off/on and on/off in eight adjacent pairs per device project.
Each page loads the same 200-turn, 1,000-tool fixture, discards three warm-ups, and measures seven operations per scenario.
There are 128 isolated pages, 64 adjacent pairs across the two phases, and 2,688 recorded interactions.
The analysis uses page medians. Repeated operations within a page are not treated as independent experiments.

One isolated production-profiling build wraps the workspace in a root React Profiler and uses `react-dom/profiling`.
Its CPU metric sums `actualDuration` for committed renders from the native event through two frames after the DOM update.
This measures render CPU; it is not DOM commit-phase duration.
A second isolated build uses the normal production renderer for DOM and frame timing, without Profiler overhead.
A native WebSocket listener excludes fixture encryption and transport before browser delivery. Client decryption and state work remain in reply DOM latency.
Input and option timing start at document event capture. Text input waits for the controlled textarea's defaultValue update.
Two animation callbacks bracket a rendering opportunity; these timings are not INP or a physical screen timestamp.

| Project | New-reply render CPU, off → on (ms) | Paired render delta, 95% CI (ms) | Reply delivery → DOM, off → on (ms) |
|---|---:|---:|---:|
| Desktop Chromium | 2.80 → 2.95 | +0.10, −0.10 to +0.30 | 9.95 → 9.95 |
| Mobile Chromium | 3.55 → 3.70 | +0.05, −0.10 to +0.20 | 6.50 → 6.20 |
| Desktop WebKit | 4 → 4 | 0, 0 to 0 | 38 → 39 |
| Mobile WebKit | 3 → 3.5 | 0, −1 to +1 | 9 → 9 |

Draft and option render medians in Chromium are about 0.1–0.2ms in both variants.
WebKit returns integer-millisecond profiling durations; many small operations report zero. These values do not establish zero work or equivalence.
All Holm-adjusted sign-flip p values are 1 across the 12 comparisons per metric.
The seeded 20,000-resample paired bootstrap intervals are descriptive, not simultaneous intervals.
The paired results show no material render, DOM, or next-frame improvement for this fixture.
They support no performance claim for enabling the compiler by default. Production defaults are not changed by the benchmark.

The profiling renderer, runtime gate, and observers exist only in `.performance/compiler-*` builds.
Normal app builds retain their normal entry and renderer. These probes do not measure cold download, physical iPhone latency, battery use, or thermal behavior.
Raw samples, adjusted statistics, browser versions, and source hashes are in [2026-10-26-react-compiler-paired.json](benchmarks/results/2026-10-26-react-compiler-paired.json).
The public report at `/reports/react-compiler.html` now leads with the paired results and retains the earlier trial in a collapsed section.
Reproduction commands and timing boundaries are in [benchmarks/README.md](benchmarks/README.md#paired-react-compiler-probe).
