# Frontend performance

Updated: 2026-10-21. The latest investigation is in the final section.

## Rendering and state

The UI uses React 19, TypeScript, Vite, CSS Modules, and React Router.
`useDemo(selector)` subscribes to the fields that a component needs.
Its external store publishes committed provider values and retains equal selections.
Drafts, quota reads, cache timestamps, and connection changes do not invalidate every consumer.

The live client retains session, machine, and message references when their values do not change.
Activity events normalize only the affected session or computer.
Loaded message arrays remain cached until their records change.
Normalized messages and parsed reply options use weak caches tied to immutable records.
Permission and form replies replace the affected agent state so that selectors see the change.

The message list, Markdown, tool groups, session rows, avatars, icons, and timestamps have separate render boundaries.
Stable event callbacks read the latest committed handler.
Old Markdown retains its DOM during typing, activity events, and new replies.
Session search defers list filtering, and viewport subscriptions notify React only at layout breakpoints.
Resize observers coalesce height and scroll writes into animation frames.
Tool expansion preserves the reader's position instead of forcing the chat to the bottom.

Draft persistence waits for a 250 ms pause between edits.
It flushes on blur, pagehide, hidden state, and provider unmount.
An abrupt browser termination without lifecycle events can lose the last pending interval.
AES keys and record keys remain scoped to the encryption client; cached imports do not reuse encryption nonces.

## Lazy modules

The login screen, live provider, demo provider, and application shell have separate entrypoints.
The shell loads these screens on demand:

- Session list and chat
- Session information and actions
- New session and its model/workspace pickers
- Monitor and computer details
- Settings and Inbox
- Markdown messages, agent requests, and workspace files/Git changes

Authentication storage and encoding helpers do not import the realtime client or cryptography runtime.
Demo fixtures do not enter the live provider.
Each lazy surface has a loading state and a reload action after a failed load.

The PWA still precaches static modules for offline use.
Code splitting defers module execution; service-worker installation can fetch those modules in the background.
The entry bundle comparison below does not represent total application bytes or a transfer-speed guarantee.

## Measurements

The comparison uses production output, desktop Chromium at 1440 × 900, and no CPU throttle.
Each fresh browser context uses the encrypted Happy protocol fixture with one session.
Responses contain headings, links, lists, a table, and a code block.
The test loads the complete history and measures twelve input events after warmup.
It does not send messages or access real account data.

| Assistant responses | Script time/input before | Script time/input after | Input-to-frame median before | Input-to-frame median after |
| --- | ---: | ---: | ---: | ---: |
| 20 | 7.75 ms | 0.38 ms | 13.1 ms | 14.5 ms |
| 100 | 26.51 ms | 0.36 ms | 32.6 ms | 13.7 ms |
| 500 | 124.40 ms | 0.47 ms | 160.2 ms | 6.2 ms |

The 500-response input sample changed from twelve long tasks to zero.
Input-to-frame measurements include frame scheduling and are not field INP measurements.
The benchmark does not measure physical phone hardware or live backend latency.
Messages remain in the DOM; this change does not add list virtualization.

| JavaScript entry | Before | After |
| --- | ---: | ---: |
| Uncompressed | 1,124,603 bytes | 283,560 bytes |
| Gzip | 362,139 bytes | 87,143 bytes |

The baseline entry is `index-CR7brUAR.js`.
The optimized measurement uses `index-D0hWNvYw.js`.
The remaining modules load through the lazy boundaries described above.

## Regression checks

`src/data/subscriptions.test.ts` covers stable selections and subscriber isolation.
`src/data/debouncedSave.test.ts` covers edit bursts and lifecycle flushes.
The client tests cover message identity and unrelated sessions during activity and new messages.
The encryption tests cover key import reuse, distinct nonces, and rejection of another key.

`tests/renderIsolation.e2e.test.ts` checks old Markdown DOM, draft persistence, and lazy file tools.
It uses Page Objects and mock REST/WebSocket boundaries in Chromium and WebKit.
The full browser suite also checks phone widths, short keyboard viewports, landscape, focus, offline reloads, and PWA upgrades.
See `VERIFICATION.md` for the final test counts.

## Follow-up: input latency

The first pass still subscribed `Chat` to each draft edit.
It also reset the visible textarea height and read `scrollHeight` in a layout effect after each edit.
That sequence forced extra layouts even when the text stayed on one line.

`DraftComposer` now owns the draft subscription, keyboard handling, and send button.
Draft edits do not render the chat header, model controls, or message list.
Draft state still updates immediately, so navigation and pending send confirmations retain the latest text.

The textarea uses native `field-sizing: content` where the browser supports it.
Older browsers measure a hidden textarea with layout containment in an animation frame.
The fallback writes the visible height only when it changes.
It does not collapse the visible textarea to measure its content.
See the [CSS sizing reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/field-sizing)
and [React input isolation guidance](https://react.dev/reference/react-dom/components/input#optimizing-re-rendering-on-every-keystroke).

Composition events and Safari's key code 229 guard the Enter key.
An Enter that confirms a Chinese candidate must not send a message.
The tests use synthetic composition events; they do not automate a physical phone's candidate keyboard.

`tests/composerInput.e2e.test.ts` covers stable height during typing, long draft growth and shrinkage,
native sizing and the legacy fallback, composition during live replies, and newer drafts during a pending send.
Phone checks include 320/360/390/430px widths, 390×430, and 844×390.
The send and stop targets are 44px on phones.

The follow-up benchmark uses production Chromium at 390×430 with 6× CPU throttling.
It uses the same encrypted fixture, loads all messages, and measures 36 input events after warmup.
The baseline is the first optimization pass (`index-D0hWNvYw.js`).
The follow-up build uses `index-C4aDvbM_.js`.

| Assistant responses | Layouts/input before | Layouts/input after | Script/input before | Script/input after |
| --- | ---: | ---: | ---: | ---: |
| 100 | 3.03 | 1.06 | 2.57 ms | 2.17 ms |
| 500 | 3.03 | 1.06 | 3.81 ms | 3.06 ms |

At 500 responses, input-to-frame median changed from 16.3 ms to 14.6 ms.
The sample maximum changed from 25.1 ms to 34.8 ms; neither run recorded an input long task.
This result confirms less layout work. It does not prove that all latency spikes are gone.
CPU throttling does not reproduce a physical phone's keyboard, GPU, or thermal state.

An open tab retains its current JavaScript after a service-worker update.
Reload the page to use the new implementation. No storage reset is required.

## React profiling and controlled comparisons, 2026-10-21

The earlier checks missed an important case: the composer changes height when text wraps.
`Chat` put its height and keyboard inset in inherited CSS variables on the root of the conversation.
Each height change could invalidate styles for every descendant in a loaded history.
This cost can be large even when React preserves every Markdown node.

A new browser regression observes the root's style attribute while long drafts grow and shrink.
It fails against the previous deployed build and passes when spacing updates target only the relevant elements.
The input test also retains its narrow, short, landscape, native-sizing, and fallback-sizing checks.

### Controls and method

The investigation compared these conditions with an encrypted Happy fixture:

- Empty, 100-response, and 1,000-response conversations, using both React and a native textarea.
- 250 sessions, 10,000 completed request records, and a 100,000-character draft.
- Continuous replies, including cache writes, while typing.
- Hidden or removed history, a separate composer layer, fixed input height, disabled visual effects, and layout/paint containment.
- A production React profiling build, component render counters, selector counters, and Chrome CPU/timeline traces.

The large-draft control still exposes native textarea work in both React and native controls.
The change does not impose a draft length limit or virtualize text inside the textarea.

Final timing comparisons use regular production output without the profiler or CPU sampler.
One browser alternates the old and new builds, with 1,000 loaded responses and 6× CPU throttling.
Each sample types 48 characters at 20 ms intervals.
Static chats use three alternating rounds per build; live chats use two.
Live samples keep the agent in its working state while encrypted replies arrive.
The comparison includes 480 input events per build across 1440×900 and 390×430 viewports.
Timing starts at `beforeinput`, so the measurement includes the browser's native edit work.
It ends at the next animation frame. It is not a field INP or a physical-phone measurement.

| Viewport and activity | Median before | Median after | P95 before | P95 after | Maximum before | Maximum after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop, static | 28.1 ms | 8.1 ms | 41.3 ms | 21.8 ms | 46.8 ms | 24.9 ms |
| Desktop, live replies | 30.1 ms | 10.3 ms | 65.5 ms | 19.7 ms | 70.0 ms | 24.8 ms |
| Phone-size viewport, static | 26.3 ms | 6.2 ms | 41.1 ms | 18.4 ms | 331.6 ms | 24.2 ms |
| Phone-size viewport, live replies | 31.8 ms | 8.9 ms | 73.3 ms | 17.8 ms | 378.1 ms | 28.1 ms |

These final measurements use the frozen, merged production artifact that also passed the full browser suite.
The old samples contain 69 long tasks; the new samples contain one 53 ms task during phone-size live replies.
The fix substantially reduces blocking; it does not promise zero long tasks under every workload.

A second comparison changes only the placement of composer spacing, with all other optimizations present in both builds.
In three alternating phone-size samples, the old inherited variables produced maxima of 387.2, 338.6, and 341.9 ms.
Direct padding and positioning produced maxima of 16.3, 21.1, and 23.0 ms.
This isolates the line-wrap problem from the other changes.
Absolute timings vary with host load and frame scheduling; use the paired comparisons and distributions.

### React findings and changes

The diagnostic build uses the official [React profiling alias](https://react.dev/reference/dev-tools/react-performance-tracks).
It adds temporary counters and a root `Profiler`; those changes do not enter the deployed build.
The original 48-input, 1,000-response sample produced 96 commits and 96,576 selector reads.
Only the provider and composer rendered during input; old Markdown did not render.
The expensive notification fan-out was outside most component render durations.

`createUIState` now keeps synchronous draft state and notifies only the matching session's subscriber.
Workspace snapshots stay stable during draft edits. Persistence reads the latest state without a provider render.
The matching sample after this separation produced 48 commits and 96 selector reads.
`MessageList` also owns one preference subscription instead of subscribing each message and Markdown fragment.
Live history uses `useDeferredValue` so that input can interrupt a large list update.
Agent-request checks run only when their state changes.

| Diagnostic workload | Selector reads before | Selector reads after | Provider renders before | Provider renders after |
| --- | ---: | ---: | ---: | ---: |
| 48 inputs, static long chat | 96,576 | 96 | 48 | 0 |
| 48 inputs plus 40 live replies | 190,496 | 1,044 | 92 | 44 |

The final static sample has 48 commits, compared with 96 before.
Live list updates can yield, coalesce, and restart; render attempts are not a measure of input delay.
Profiling adds overhead, so its timings do not enter the production comparison table.

### Browser findings and changes

The timeline showed substantial `PrePaint` and layer work in the long history.
Message and tool blocks now use layout/paint containment without estimated heights or content visibility.
Composer height changes update the history's padding directly; keyboard positioning updates only the composer.
Composer height and keyboard changes no longer update inherited variables in the Markdown tree.
See the [CSS containment specification](https://www.w3.org/TR/css-contain-2/).

A live-chat trace also found a cache timer that blocked for 117 ms in the diagnostic build.
Base64 conversion was a prominent JavaScript cost.
The codec now uses native [`toBase64`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64)
and [`fromBase64`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/fromBase64) when available.
Older browsers retain a compatible fallback; decoding no longer calls JavaScript once per byte.
Codec tests compare padded, URL-safe, Unicode, and 512 KiB records against an independent implementation.
The encrypted cache format and encryption nonce rules stay the same.

Raw fixtures, configurations, results, `.cpuprofile` files, and timeline traces for this run are in
`/private/tmp/rayno-react-profile-20261020/`.
`paired-merged-results.json` contains the final production comparison;
`paired-wrap-results.json` records the preceding comparison before the merged protocol updates.
`paired-root-only-results.json` contains the isolated spacing comparison.
`react-profile.json` and `react-final.json` contain diagnostic render and selector counts.
The corresponding `.trace.json` and `.cpuprofile` files can be loaded in Chrome DevTools.
The final functional verification is recorded in `VERIFICATION.md`.

## Mermaid previews and edge gradients, 2026-10-21

Message edges use two static CSS gradients with pointer events disabled. The gradients sit below the floating header and composer.
No scroll listener, animation loop, blur filter, or inherited draft-dependent variable drives this effect.

Mermaid fences use `beautiful-mermaid` 1.1.3 in a shared Web Worker. Its 1,524 kB bundle loads only when a diagram approaches the viewport.
The service worker excludes this optional bundle from shell precaching and caches it after use for offline previews.
The JavaScript entry remains 283,749 bytes before gzip. The lightweight preview component adds about 3 kB to the lazy message module.
Diagram results use a 24-entry cache, and a short delay coalesces streamed source updates.
SVG output appears as an image, with readable source and a Copy action; ordinary code blocks keep their previous renderer.

ELK's environment checks require a document marker and a writable `self` alias inside a module worker.
These compatibility properties exist only in the worker. The layout engine does not run DOM operations or modify the page globals.
The first two diagnostic builds exposed these environment assumptions; their failed and interrupted runs remain in `/private/tmp/rayno-mermaid-fades-20261021/`.

The final focused regression run passes 61 checks across desktop/mobile Chromium and WebKit; three existing duplicate PWA checks are skipped.
Typing and ordinary replies retain the same diagram image without attribute mutations.
The installed Chromium PWA renders saved diagrams after a fully offline reload.
