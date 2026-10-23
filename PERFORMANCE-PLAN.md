# Performance and sync improvement plan

Created: 2026-10-23. Updated: 2026-10-24 (Phase 4: E02 image budget).
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
| M01 | Add an LRU for decrypted history of sessions that are not open. Evaluate list virtualization with the recap, anchors, selection, and copy | todo |
| M02 | Add a total size budget for attachments. Limit hash and upload concurrency | todo |
| O01 | Add a queue limit to the Mermaid worker. Cancel stale jobs. Separate queue time from run time | todo |
| O02, A01 | Measure first, then decide | todo |
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
| 2026-10-24 | after `e08a7db` | E02 image budget | Vitest, image budget browser test, full browser suite | Images are deleted least recently viewed first above 250 MB or 10% of the quota. With a budget of 2.5 images, a third image removes the oldest one, and the two newest open offline. Full suite: 1,242 passed, 0 failed |

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

