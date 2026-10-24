# WebKit virtualization, O02, and A01

Date: 2026-10-24. Production source: `3ec6672`.

Bounded rendering is worth a complete prototype for large desktop chats.
It cuts the median WebKit reply sample from 260 ms to 53 ms at 600 turns.
The experiment also removes older navigation targets. It is not ready for production.
For A01, the clearest download target is the demo image that the service worker precaches for every account.
O02 does not justify an urgent rewrite of grouping or input state.

## Measurement method

The probes and commands are in [benchmarks/README.md](benchmarks/README.md).
The [raw record](benchmarks/results/2026-10-24.json) contains samples, counters, HTTP requests, and cache entries.
All timing runs use a minified production build, one worker, and no CPU or network throttle.
Phone projects use Playwright emulation on the same Mac. They do not represent physical phone performance.

The reply sample starts before fixture encryption and event delivery.
It ends at the second animation frame after the matching DOM mutation.
This brackets a rendering opportunity; it does not measure a physical display timestamp.
Seven samples give the range and median. WebKit timer precision can round a short operation to zero.
The benchmark disables Playwright tracing and avoids whole-page text polling during the sample.

History loading waits for each client promise, including its cache flush, before the next click.
Those totals differ from the earlier probes in sections 6.6 and 6.7 of `PERFORMANCE-PLAN.md`.
They must not be read as another production improvement.

## 1. WebKit virtualization

The fixture has 600 turns, 3,000 tool calls, and 10,800 protocol records.
The full build renders about 3,600 chat blocks.
The experimental build renders only the last 60 blocks, while it retains all data and block preparation.
It has no spacer, height cache, or offscreen item navigation.

| Browser | Full list, median reply | Last 60 blocks, median reply | Full list DOM | Tail DOM |
|---|---:|---:|---:|---:|
| Desktop Chromium | 48.7 ms | 30.5 ms | 36,003 | 1,201 |
| Desktop WebKit | 260 ms | 53 ms | 36,003 | 1,201 |
| Phone Chromium | 31.5 ms | 31.9 ms | 16,803 | 561 |
| Phone WebKit | 74 ms | 48 ms | 16,803 | 561 |

DOM counts come from the first appended reply. Subsequent tail counts change as blocks leave the window.
Phone layouts start with collapsed tool groups, so they mount fewer elements.
Desktop WebKit ranges are 248–291 ms for the full list and 48–70 ms for the tail.
All measured replies remain at the bottom, with a zero-pixel gap.

At 200 turns, the full desktop list has a 31.4 ms median in Chromium and 78 ms in WebKit.
This supports a size threshold rather than a blanket switch for every chat.

Loading all 107 older pages takes 28.5 s in full desktop WebKit and 5.5 s in the tail build.
These figures include the client, cache, and UI. They are not pure layout times.
The tail numbers show potential benefit, before the cost of a real virtualizer and navigation adapter.
They do not establish a performance result for either library below.

### Candidate comparison

| Candidate | Fit for Rayno | Decision |
|---|---|---|
| TanStack Virtual | Headless API fits the existing scroller and custom rails. Dynamic measurement and stable item keys support mixed blocks | Preferred for a complete prototype |
| React Virtuoso | Includes dynamic item sizes, prepend support, and bottom following. A custom rail still needs an adapter | Viable alternative |
| Virtuoso Message List | Adds chat-specific scroll modifiers and prepend behavior. Production use requires its commercial license | Consider only if its integration benefit justifies the license |
| `content-visibility: auto` | Retains the DOM, but the earlier Rayno probe lost the WebKit bottom pin by 172–325 px | Keep rejected until that failure has a demonstrated fix |
| Custom virtualizer | Requires our own measurement, resize, and anchor logic | No current reason to take this maintenance cost |

The [TanStack chat guide](https://tanstack.com/virtual/latest/docs/chat) describes end anchoring, stable keys, prepend stability, and streaming growth.
Its [API](https://tanstack.com/virtual/latest/docs/api/virtualizer) exposes measurements, snapshots, and indexed navigation.
The [React Virtuoso API](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/) provides `firstItemIndex` and `followOutput`.
The separate [Message List license](https://virtuoso.dev/message-list/licensing/) applies to `@virtuoso.dev/message-list`.
These are documentation findings. Neither library was installed or benchmarked in this evaluation.

### Integration plan

1. Virtualize `ChatBlock` values with stable block IDs. Keep tools, thinking, and replies as separate measured items.
   Keep the current DOM for short histories; choose the threshold after the 200- and 600-turn prototype runs.
2. Introduce one viewport adapter that owns scrolling, item measurements, and bottom following.
   Replace the current `Chat` resize-based pin logic in the virtual mode. Two independent owners would conflict.
   Use normal item order and end anchoring. Do not invert the list with CSS transforms.
3. Index every loaded reply and recap target in data.
   The rail must use virtual offsets for unmounted items. A jump must locate the block, mount it, expand tools, then find its quote.
4. Restore a stable message ID and its relative offset. Key height caches by viewport width, font size, and expansion state.
   Re-measure after images, diagrams, or tool details change height.
5. Provide a full-transcript reading mode for native page search and selection across messages.
   An app-level search can locate unmounted data, but it does not preserve native browser find by itself.
   Keep virtual mode opt-in until this behavior and its discoverability are accepted.
6. Validate history prepend, streaming growth, resize, recap jumps, rail jumps, reload, offline history, and selection.
   Reuse the phone matrix below. Require a real iPhone Safari run before rollout.

This is an engineering recommendation from the Rayno measurements and source code.
The 60-block experiment proves that reducing mounted content helps. It does not prove this integration plan correct.

### Phone interaction results

Both engines completed tool open/close, tool detail open/close, scroll-to-latest, draft input, and send.
Both full and tail builds covered 320x568, 360x640, 390x844, 430x932, 390x360, and 844x390.
The composer action remained reachable and at least 44px. All reply samples retained the bottom pin.

One existing defect remains: at 844x390, the tool-group button is 41px high and fails the 44px hit-area check.
Both builds show it in Chromium and WebKit. The portrait and short keyboard checks pass the 44px check.
Record this as a rollout requirement. The evaluation does not change the production control.

The tail also drops old rail pins: the first live reply has 21 pins instead of 601 on desktop.
Loaded early text disappears, so native find and cross-message selection lose those targets.
These are expected failures of the lower-bound experiment. Do not deploy the tail build.

## 2. O02: grouping, new-session input, and file suggestions

The session fixture uses 100 or 1,000 active sessions.
At 1,000 sessions it has 101 projects, including the original fixture project.
Each grouping sample switches from Flat to Projects and waits for two animation frames.

| Browser, 1,000 sessions | Group switch range | Median | Time inside repeated filters |
|---|---:|---:|---:|
| Desktop Chromium | 140–249 ms | 244 ms | 0.8–1.2 ms |
| Desktop WebKit | 168–191 ms | 182 ms | 0–1 ms |
| Phone Chromium | 125–291 ms | 216 ms | 0.9–1.2 ms |
| Phone WebKit | 207–238 ms | 231 ms | 0–2 ms |

Each switch visits 202,000 entries in the repeated filters.
At 100 sessions, median switches take 25.2 ms in desktop Chromium, 26 ms in desktop WebKit,
25.8 ms in phone Chromium, and 24 ms in phone WebKit.
The measured filter cost is small compared with the UI update.
One-pass grouping is reasonable cleanup, but it will not remove the measured delay.
Large lists need fewer mounted rows or less row movement if this becomes a practical problem.

New-session input sends 19 synthetic native input events, each followed by two animation frames.
At 1,000 sessions the median is about 33 ms in these projects. Desktop WebKit has one 72 ms sample.
The session list has zero renders during typing.
Desktop Chromium evaluates selectors 20,239 times; desktop WebKit evaluates them 19,228 times.
Phone WebKit evaluates them 179 times because the list unmounts on the new-session screen.
The global notification exists, but it does not mean every session row renders on each key.
Local draft state is a lower-priority improvement unless typing degrades on a real device.

The file probe uses the production parser and five queries, each with one warm-up and seven timed searches.
At 50,000 file paths, added folders make 100,101 index entries.
In the 1,000-session runs, parsing takes 25–41 ms.
The slowest query median is 17.6 ms in desktop Chromium, 15 ms in desktop WebKit,
17.3 ms in phone Chromium, and 21 ms in phone WebKit.
The largest individual search sample is 29.8 ms in these runs.
These costs exclude the ripgrep RPC and suggestion DOM. They are not end-to-end autocomplete latency.

Decision: no urgent O02 implementation.
Keep the probe. Revisit cached normalized keys or bounded top-50 ranking if real-device searches exceed a frame consistently.
Do not treat a `slice(0, 50)` as a bound on the work: the current matcher scores all entries first.

## 3. A01: PWA installation and updates

The probe uses clean builds, real service workers, and an HTTP server with gzip and ETags.
It counts response bodies at the server, including worker requests and duplicate downloads.
The changed release adds one unused CSS variable. The build timestamp also changes, as on normal builds.
The unchanged release keeps exactly the same files.

| Phase | Chromium | WebKit |
|---|---:|---:|
| Cold sign-in shell and service-worker install | 1,885,602 B; 92 requests | 2,413,209 B; 106 requests |
| Warm shell reload | 0 B; 0 requests | 0 B; 0 requests |
| Unchanged update check | 0 B; 2 requests | 9,697 B; 2 requests |
| Changed update | 446,389 B; 33 requests | 446,389 B; 33 requests |
| Offline shell reload | Pass; 0 network requests | Pass; 0 network requests |

The Cache Storage snapshot has 86 unique entries and 3,573,859 decoded response-body bytes in both engines.
The build lists 100 precache entries before Workbox deduplicates them.
WebKit sends duplicate requests for some startup assets; the raw record retains those requests.
This is a local observation, not a claim about every Safari release or the deployed site.

The [Workbox precaching contract](https://developer.chrome.com/docs/workbox/modules/workbox-precaching) downloads new or revised entries during worker installation.
Thus lazy imports reduce initial module execution, but do not exclude their files from Rayno's precache.
Rayno already excludes the Mermaid worker; the measured install does not fetch it.

The largest avoidable item is `demo-chat-*.png`: 822,180 decoded bytes and 781,318 gzip bytes.
It accounts for about 41% of Chromium's cold response bodies and 32% of WebKit's.
It is a demo image, not an encrypted account attachment.
The fonts directory accounts for another 791,899 decoded cache bytes, including files that `includeAssets` adds beyond the CSS references.

The small release changes many chunk URLs through imports of the main entry.
For example, the crypto chunk imports `index-*.js`, so its URL changes when the entry changes.
The update transfers the revised cache entries; it does not download every unchanged font and image again.

Recommended order:

1. Exclude the demo screenshot from unconditional precache. Cache it on first demo use if offline demo access remains required.
   Keep the account shell, encrypted history, and previously loaded chat behavior intact.
2. Review unused font precache entries. Preserve the required font files and license notices.
3. Evaluate stable vendor chunks if frequent small releases make the 446 KB update material.
   Measure before and after; moving imports can change startup and cache behavior.

Do not remove all lazy screen chunks from precache as a blanket optimization.
That can break offline access to a loaded workspace.

These are HTTP body counts. They exclude headers, TLS, account APIs, and attachment traffic.
The local gzip policy is not Cloudflare's production compression or cache configuration.
The offline check covers the sign-in shell, not encrypted account history.
No production service-worker policy changed in this evaluation.

## Decision and follow-up order

| Order | Work | State |
|---|---|---|
| 1 | Remove the demo screenshot from unconditional precache, with an offline demo decision | Implemented: bounded first-use cache; see follow-up below |
| 2 | Build a complete TanStack Virtual prototype with the viewport adapter and full-transcript mode | Implemented as an opt-in prototype; see section 6.12 of PERFORMANCE-PLAN.md |
| 3 | Fix the existing 41px landscape tool target before virtual-mode rollout | Implemented: 44px minimum and phone pointer checks |
| 4 | Optimize O02 only if real-device evidence justifies it | Measured; defer |

The original evaluation at `ca75206` added benchmark tools and records only.
It did not add a virtualizer dependency or change the product UI.

## A01 implementation follow-up (2026-10-24)

The evaluation above records the original measurements. This follow-up implements the first cache recommendation.
The before/after builds both use source base `00c9fa7`; the old-policy build comes from a clean Git archive.
The demo screenshot now loads and enters a bounded CacheFirst cache on its first use.
At most two versions remain for 60 days. An image that the user never loaded needs an online first use.
The account shell, encrypted history, and Mermaid caching keep their previous policies.

Cold gzip response bodies fall from 1,886,032 to 1,104,845 B in Chromium (41.4%),
and from 2,413,637 to 1,632,450 B in WebKit (32.4%).
Warm shell reloads still use no network bytes. The install makes no request for the demo image.
Both engines pass the service-worker update and updated offline-shell transfer probes.
The new browser regression also covers an uncached offline miss, a successful online retry,
and offline image view and download after a cold reload.

The before/after request record is [2026-10-24-pwa-slim.json](benchmarks/results/2026-10-24-pwa-slim.json).
The earlier virtualization and O02 recommendations remain unchanged.

## Complete prototype follow-up (2026-10-24)

The production prototype now uses TanStack Virtual 3.14.22. Its account preference remains off by default.
It adds data-based rail and recap navigation, loaded-history search, encrypted reading anchors, and a full-transcript mode.
The full-transcript mode supports native find and selection across loaded messages.
The earlier bounded tail remains a separate experiment.

In the paired 600-turn run, the WebKit reply median falls from 229ms to 46ms.
The conversation DOM median falls from 39,645 descendants to 280.
All loaded replies keep rail targets, and all reply samples have a zero bottom gap.
The virtual WebKit range is 43–49ms in this seven-reply sample. It does not establish a production latency bound.
The prototype still retains loaded protocol records and can mount a large internal tool group.

See [PERFORMANCE-PLAN.md, section 6.12](PERFORMANCE-PLAN.md#612-v01-complete-virtual-transcript-prototype-2026-10-24)
and the [raw paired record](benchmarks/results/2026-10-24-virtual-prototype.json).
Physical iPhone Safari and production latency remain follow-up checks.
