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
The tail build also replaces `blocks.map` with `blocks.slice(-60).map` in `MessageList`.
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
