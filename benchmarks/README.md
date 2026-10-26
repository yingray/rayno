# Scaling probes

These probes evaluate the chat DOM, workspace controls (O02), and PWA transfers (A01).
They use isolated builds under `.performance/`. They do not change the production app or `dist/`.
They do not run in the default browser suite.

Use one browser worker. Run timing probes in sequence on an idle host.
Install the project's Playwright browsers before the first run.

```sh
node benchmarks/build.mjs
pnpm exec playwright test -c benchmarks/playwright.config.ts
RAYNO_BENCH_VARIANT=tail node benchmarks/build.mjs
RAYNO_BENCH_VARIANT=tail pnpm exec playwright test -c benchmarks/playwright.config.ts
node benchmarks/pwa-transfer.mjs
node benchmarks/summarize.mjs
pnpm exec tsc --noEmit -p benchmarks/tsconfig.json
```

The default chat has 600 turns and five tool calls per turn. The default workspace has 1,000 active sessions in 101 projects.
Use `RAYNO_BENCH_TURNS=200` or `RAYNO_BENCH_SESSIONS=100` for smaller samples.
The workspace probe uses the production file parser and matcher at 1,000, 10,000, and 50,000 files.
It adds folders through the production parser. The largest index has 100,101 entries.

The full build adds counters and a history promise for the probe.
The tail build also replaces `blocks.map(renderBlock)` with `blocks.slice(-60).map(renderBlock)` in `MessageList`.
The full message pipeline and block preparation still run in both builds.
The tail is a lower-bound experiment for bounded rendering. It is not a complete virtualizer.
It has no spacers, height cache, offscreen navigation, search, or selection support.
Do not deploy it. Missing older rail pins and loaded text are known limitations.

Chat samples wait inside the page. They do not poll whole-page text with Playwright.
The reply timer starts before the fixture encrypts and sends the event.
It stops at the second animation frame after the matching DOM mutation.
This brackets a rendering opportunity. It does not measure the physical display or full input-to-display latency.
Seven replies produce a range and median. No host-dependent timing assertion runs in CI.
History loading waits for each client promise, including its cache flush, before the next click.
The paired prototype probe then uses the latest-message control before it sends replies.
Phone interaction checks cover 320, 360, 390, and 430px, a 390x360 keyboard viewport, and 844x390 landscape.
They exercise touch, tool expansion, detail expansion, scroll-to-latest, drafts, and send.
Touch sizes are recorded separately from interaction checks. A passing probe does not certify every target as 44px.

The PWA probe builds two clean versions. The second adds one unused CSS variable to `global.css`.
Build timestamps also change, as they do on a normal build.
An HTTP server counts response body bytes, including service-worker requests and duplicate requests.
Text and binary responses use gzip when the browser advertises it. Hashed assets use immutable caching.
Other files use ETag validation. Headers, TLS, account APIs, and real deployment compression are outside this count.
The probe checks cold install, warm navigation, unchanged update, changed update, and an offline sign-in shell.
It keeps all requests and Cache Storage entries in `.performance/pwa-transfer.json`.
It does not claim to test account history or attachments offline.

Keep existing Tailscale routes. For this workspace, the probes used separate routes on ports 5196 and 5197:

```sh
tailscale serve --bg --https=5196 http://127.0.0.1:5196
tailscale serve --bg --https=5197 http://127.0.0.1:5197
RAYNO_BENCH_TAILSCALE_URL=https://YOUR-TAILSCALE-HOST:5197 node benchmarks/pwa-transfer.mjs
```

The optional URL makes the PWA probe verify the Tailscale route before measurement.
Its health request is excluded from the sample.
Remove only these temporary routes when the probes end.
The browser tests use loopback for the controlled sample and require no personal account.

Raw samples go to `.performance/samples/`. The summary goes to `.performance/report.json`.
The checked record for this evaluation is `results/2026-10-24.json`.
The first-use demo cache follow-up is `results/2026-10-24-pwa-slim.json`.
It keeps the before/after totals and the new HTTP request and Cache Storage records.

The `virtual` variant enables the production opt-in prototype by default in an isolated build.
It uses the same pipeline, reply timer, and history loader as `full`.
Use a free port when an existing preview owns 5196:

```sh
RAYNO_BENCH_VARIANT=virtual node benchmarks/build.mjs
RAYNO_BENCH_PORT=5198 RAYNO_BENCH_VARIANT=virtual pnpm exec playwright test -c benchmarks/playwright.config.ts benchmarks/scaling.e2e.test.ts -g 'chat rendering' --project=desktop-webkit
```

Functional checks for the real prototype are in `tests/virtualTranscript.e2e.test.ts`.
They enable the preference through Settings and also run against a normal production build.

The paired real-virtualizer record is `results/2026-10-24-virtual-prototype.json`.
It includes one seven-reply run per case and retains every reply sample.

## Paired React Compiler probe

Build the two isolated renderers, then run their comparisons in sequence with one worker:

```sh
RAYNO_COMPILER_BENCHMARK=profiled pnpm build
RAYNO_COMPILER_PHASE=profiled pnpm exec playwright test -c benchmarks/compiler/playwright.config.ts
RAYNO_COMPILER_BENCHMARK=production pnpm build
RAYNO_COMPILER_PHASE=production pnpm exec playwright test -c benchmarks/compiler/playwright.config.ts
node --test benchmarks/compiler/stats.test.mjs
node benchmarks/compiler/summarize.mjs
pnpm exec tsc --noEmit -p benchmarks/compiler/tsconfig.json
```

The probe uses port 5197 by default. Keep existing Tailscale services; add a route only if the port has none.
Both compiler variants are present in the same payload. A query gate selects one at module initialization.
Each variant gets a fresh browser context. Eight adjacent pairs alternate off/on and on/off to balance order.
Each page uses the same 200-turn fixture, three warm-up interactions, and seven measured interactions for each scenario.
The scenarios are a live reply, an option toggle, and one character in the draft.
Warm-up rows are excluded. The summary resamples complete adjacent pairs, not individual repeated interactions.

The profiling build aliases the renderer to `react-dom/profiling` and records render CPU for each commit through a root Profiler.
The normal production renderer records DOM and frame boundaries separately, without Profiler overhead.
A native WebSocket listener starts a reply sample after the fixture encryption and transport.
Input and click samples start at document capture. A controlled textarea's defaultValue update marks its React DOM commit.
Two animation frames after DOM observation bracket a rendering opportunity. This is not INP or a physical display timestamp.

The instrumentation, gate, and profiling renderer exist only in these isolated builds under `.performance/`.
They do not enter the normal app build. Do not deploy the benchmark builds or sign in with a real account.
