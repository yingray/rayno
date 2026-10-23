# Happy Web gap tracker

This file tracks every item from Happy session `cmvj0ftw002mdu1n91i2uha7f`, plus later findings and requests.
It records product decisions as well as defects. An intentional difference is not a defect.

## Sources and status rules

- Original audit: 2026-10-22, Rayno `6f4b61a`, Happy protocol `24d340d`, local Happy `2dcac1ad` and the author's Web overlay.
- Audit transcript: Codex session `01a161c1-e65a-7d62-928e-0e1405e8ae78`, final response at `2026-10-22T04:09:18.996Z`.
- Follow-up implementation: Happy session `cmvji3xr706miu1n9p4w079h3`, Claude transcript `866ddd85-e278-48fc-aafd-a202118a1316`.
- Verified baseline: Rayno `32a06f9`. Independent checks passed 443 unit tests and 960 browser cases, with 52 project-specific skips.
- Current implementation: verified changes from `feat/web-parity`. The implementation and gap tracker ship together in this commit.

**Done** means that the baseline or current local implementation contains the change and the cited tests cover it.
Delivery to a preview or production is recorded separately.
**Open** means that a confirmed defect remains. **Deferred** means that a feature remains outside the current selected work.
**Intentional** records an explicit product requirement. **Corrected** records an audit claim that later evidence changed.
Browser tests use encrypted server and daemon fixtures. They do not prove a deployment against every CLI version or a physical phone.
The audit covered selected source paths and protocol cases. It was not a claim that every Happy screen received exhaustive testing.

Keep the IDs stable. Update status, evidence, and the reason whenever an item changes.
Do not remove a row because a later audit changes its interpretation.

## Original audit inventory

| ID | Item | Status | Outcome, remaining work, or reason | Evidence |
| --- | --- | --- | --- | --- |
| G00 | `<options>` system prompt | Done | The audit HEAD already contained the fix. Preserve the strict response format. | [systemPrompt.ts](../src/happy/systemPrompt.ts), [replyOptions](../tests/replyOptions.e2e.test.ts) |
| G01 | Successful empty permission RPC replies | Done | Allow, deny, questions, and other documented void operations accept authenticated empty replies. Reads still require a result. | [client tests](../src/happy/client.test.ts), [agentRequests](../tests/agentRequests.e2e.test.ts) |
| G02 | Session permission `allowTools` field | Done | Send the CLI field `allowTools`; retain metadata compatibility with `allowedTools`. | [client.ts](../src/happy/client.ts), [priorityFeatures](../tests/priorityFeatures.e2e.test.ts) |
| G03 | Archive/delete process termination and worktree cleanup | Done | Attempt agent termination and supported cleanup. Keep bot and side-chat exclusions. Report failures. | [sessionLifecycle](../tests/sessionLifecycle.e2e.test.ts), [client tests](../src/happy/client.test.ts) |
| G04 | Isolation of corrupt encrypted records | Done | Skip failed records independently; retain readable sessions and retry information. Preserve cache age after failed reads. | [client tests](../src/happy/client.test.ts), [offlineWorkspace](../tests/offlineWorkspace.e2e.test.ts) |
| G05 | New-session CLI version gate | Done | Carry the machine's CLI version into permission choices and outbound validation. | [newSessionPermissions](../tests/newSessionPermissions.e2e.test.ts), [permissionOptions tests](../src/happy/permissionOptions.test.ts) |
| G06 | Claude prompts typed in the terminal | Done | Read legacy `output.data.type: user` string content. | [normalize tests](../src/happy/normalize.test.ts), [transcriptWork](../tests/transcriptWork.e2e.test.ts) |
| G07 | Subagent relationship, attention, and reply options | Done | Baseline handles session envelopes. Current branch adds paging bounds, missing stop inference, legacy nesting, and safe unresolved records. See P06. | [subagentPaging tests](../src/happy/subagentPaging.test.ts), [webParity](../tests/webParity.e2e.test.ts) |
| G08 | Internal meta and compact-summary filtering | Done | Internal records do not become user-visible replies or attention changes. | [normalize tests](../src/happy/normalize.test.ts), [sessionAttention tests](../src/happy/sessionAttention.test.ts) |
| G09a | Service text and general agent events | Done | Show supported service text, switch/message/limit events. Events do not count as formal replies. | [agentEvents](../tests/agentEvents.e2e.test.ts), [normalize tests](../src/happy/normalize.test.ts) |
| G09b | Non-error Claude result output | Corrected | Current CLI session `tool-call-end` omits result content. Neither client can recover data that the CLI did not send. Render legacy results when present. | [protocol notes](../src/happy/PROTOCOL-SOURCES.md), [toolResults](../tests/toolResults.e2e.test.ts) |
| G10 | ACP file edits and terminal output | Done | Normalize supported `file-edit` and matched `terminal-output` records. | [normalize tests](../src/happy/normalize.test.ts), [transcriptWork](../tests/transcriptWork.e2e.test.ts) |
| G11 | Claude structured `toolUseResult` | Done | Preserve structured legacy results and fallback text. Extra presentation is P05. | [toolResults.ts](../src/data/toolResults.ts), [toolResults tests](../src/data/toolResults.test.ts) |
| G12 | Plan entry, exit, and prior permission selection | Done | Track valid Enter/ExitPlanMode transitions, reject denied transitions, and restore the prior mode. Search older pages for sent choices. The audit's claim that stale metadata necessarily changes CLI mode was too broad. | [planPermissions](../tests/planPermissions.e2e.test.ts), [modelPreferences tests](../src/happy/modelPreferences.test.ts) |
| G13 | Agent accepted/rejected receipts | Done | Apply receipts only to agents that advertise support; preserve existing Happy Agent sessions. | [sendReceipts](../tests/sendReceipts.e2e.test.ts), [receipts tests](../src/happy/receipts.test.ts) |
| G14 | Confirmation to create a missing folder | Done | New session, Fork, Duplicate, and side chat support explicit confirmation. Retry does not silently approve creation. | [newSessionFolder](../tests/newSessionFolder.e2e.test.ts), [sessionOperations](../tests/sessionOperations.e2e.test.ts), [sideChats](../tests/sideChats.e2e.test.ts) |
| G15 | Last local send as an activity fallback | Done | Recently sent sessions sort by real activity with older CLIs. | [normalize tests](../src/happy/normalize.test.ts), [sessionAttention](../tests/sessionAttention.e2e.test.ts) |
| G16 | Parent entry for side chats | Done | A parent exposes existing side chats and creation. A navigation edge remains L02. | [sideChats](../tests/sideChats.e2e.test.ts) |
| G17 | Thinking and reasoning content | Done | Read supported Claude/Codex reasoning and keep it separate from formal reply content. | [transcriptWork](../tests/transcriptWork.e2e.test.ts), [normalize tests](../src/happy/normalize.test.ts) |
| G18 | Session context and five-hour quota | Done | Show context when reported and both supported quota windows. Correction: the old quota reader fetched five-hour data; normalization discarded it. | [contextUsage](../tests/contextUsage.e2e.test.ts), [sessionUsage](../tests/sessionUsage.e2e.test.ts) |
| G19 | Goal and todo progress | Done | Show goal state/actions and current todos from real data. | [goalProgress](../tests/goalProgress.e2e.test.ts), [agentGoal tests](../src/happy/agentGoal.test.ts) |
| G20 | Completed approvals and question history | Done | Baseline joins decisions and available answers to loaded calls. Current branch adds denied/canceled requests without a call. Missing answers in current Claude state cannot be reconstructed. | [toolHistory.ts](../src/happy/toolHistory.ts), [toolDecisions tests](../src/happy/toolDecisions.test.ts) |
| G21 | Terminal local/remote state and control | Done | Show state and take control when supported. Happy Web itself does not offer remote-to-local UI. CLI and recovery defects remain L03/L04. | [terminalControl](../tests/terminalControl.e2e.test.ts), [terminalControl tests](../src/happy/terminalControl.test.ts) |
| G22 | Cancel unsupported question kinds | Done | Keep a readable unsupported state and support dismissal through the documented communication API. | [agentRequests](../tests/agentRequests.e2e.test.ts), [communications tests](../src/happy/communications.test.ts) |
| G23 | Background completion and browser tab counts | Done | Handle `session-event` for completion attention without creating a fake reply. Request recovery remains L05. | [tabAttention](../tests/tabAttention.e2e.test.ts), [sessionAttention tests](../src/happy/sessionAttention.test.ts) |
| G24 | Command and file suggestions | Done | Use supported daemon suggestions with keyboard and touch selection. | [composerSuggestions](../tests/composerSuggestions.e2e.test.ts), [suggestions tests](../src/happy/suggestions.test.ts) |
| G25 | Realtime voice | Deferred | Happy Web has a full voice flow. Current selection covers six other features. Recap speech is a separate capability. | [README limitations](../README.md#connected-features) |
| G26 | Push notifications | Corrected | Not a Happy Web parity gap: Happy's Web implementation does not provide the native push flow. Rayno does not implement push. | Happy `notifications/registerForPushNotificationsAsync.ts`, [README](../README.md) |
| G27 | Arbitrary PDF/ZIP/general file uploads | Corrected | Both inspected Web clients support image uploads rather than arbitrary attachments. This remains a possible new feature, not a verified Web gap. | [attachments.ts](../src/happy/attachments.ts), Happy `components/AgentInput.tsx` |
| G28 | Account and CLI/device authorization management | Deferred | Browser sign-in exists. Linking, listing, and revoking other authorized devices is outside the six selected features. Machine management P02 does not cover authorization management. | [auth.ts](../src/happy/auth.ts), [Settings.tsx](../src/features/Settings.tsx) |
| G29 | Friends and live social inbox | Deferred | Rayno has no connected social flow. Its demo inbox does not prove parity. Outside the selected features. | [Inbox.tsx](../src/features/Inbox.tsx) |
| G30 | Native/cloud Projects | Deferred | Rayno groups recent local folders. It has no equivalent server-backed project management. Outside the selected features. | [NewSessionPickers.tsx](../src/features/NewSessionPickers.tsx) |
| G31 | Artifacts | Deferred | No connected artifact browser or editor. Outside the selected features. | [README](../README.md) |
| G32 | Hide Happy Agent creation and switching | Intentional | Explicit user requirement. Existing sessions stay readable. | [AGENTS.md](../AGENTS.md), [concreteModelPreferences](../tests/concreteModelPreferences.e2e.test.ts) |
| G33 | Independent Rayno preferences and read state | Intentional | Explicit user requirement. Keep Happy preferences untouched; encrypt and scope offline content by account/server. | [AGENTS.md](../AGENTS.md), [offlineCache.ts](../src/happy/offlineCache.ts), [store.tsx](../src/data/store.tsx) |
| G34 | Codex `max`/`ultra` support assumptions | Done | Prefer actual daemon catalogs and explicit supported choices. Static fallbacks use a concrete support table. This closes the inference defect; an actual account can still reject a model. | [modelOptions.ts](../src/happy/modelOptions.ts), [modelOptions tests](../src/happy/modelOptions.test.ts), [modelSelection](../tests/modelSelection.e2e.test.ts) |
| G35 | Mocks hide protocol incompatibility | Done | Regression fixtures exercise real void responses, exact RPC field names, encrypted records, and CLI message shapes. They do not replace live deployment checks. | [HappyServer.ts](../tests/fixtures/HappyServer.ts), [client tests](../src/happy/client.test.ts) |

## Later findings

| ID | Item | Status | Outcome or reason that it remains | Evidence |
| --- | --- | --- | --- | --- |
| L01 | Subagent bounds on older/cached pages; missing stop; hidden legacy work | Done | Covered by P06. Preserve readable work and suppress main-thread actions when placement is unknown. | [subagentPaging tests](../src/happy/subagentPaging.test.ts), [client tests](../src/happy/client.test.ts) |
| L02 | Back navigation during side-chat folder confirmation retains the previous draft | Open | Reproduced after the baseline audit. Requires dialog/draft ownership cleanup. Not part of the six selected features. | `SideChats.tsx`, diagnostic probe from continuation session |
| L03 | CLI switch direction and concurrent switch race | Open | CLI-side behavior can ignore direction and race. Requires a coordinated CLI fix; this task must not change the Happy source checkout. | Happy CLI switch handler; continuation diagnostic probe |
| L04 | Terminal unavailable notice remains stale after going offline | Open | Reproduced UI state defect. Requires availability-state cleanup; outside the selected six features. | [TerminalControl.tsx](../src/features/TerminalControl.tsx), continuation diagnostic probe |
| L05 | Missed permission update cannot recover from `session-event` alone | Open | Completion events do not carry agent state. A state refresh is required after a missed update. Not covered by existing completion tests. | [client.ts](../src/happy/client.ts), continuation diagnostic probe |
| L06 | Nested dialog mount can choose the wrong focus target | Open | The continuation audit identified an accessibility edge. This change does not revalidate it; add a focused interaction check before a fix. | [ui.tsx](../src/components/ui.tsx) |
| L07 | Goal action error remains after the goal panel closes | Open | Local error-state cleanup remains outside the selected work. | [TaskDock.tsx](../src/features/TaskDock.tsx) |
| L08 | Combobox screen-reader semantics are incomplete | Open | Composer suggestions need a separate accessibility pass. Current tests do not prove a physical screen-reader flow. | [ComposerSuggestions.tsx](../src/features/ComposerSuggestions.tsx), [Chat.tsx](../src/features/Chat.tsx) |

Remaining work is explicit:

- **L02:** Open a side-chat draft, reach the missing-folder confirmation, then use browser Back. Clear the old provider copy when navigation abandons the draft.
- **L03:** Request a switch while another switch is pending. Check the CLI direction parameter and serialize the transition in the CLI. Coordinate this outside Rayno.
- **L04:** Reach the terminal-unavailable state, then take the browser offline. Recompute the notice when connection and machine availability change.
- **L05:** Miss an `update-session` permission request and receive only a `session-event`. Refresh agent state; message history alone cannot recover the request.
- **L06:** Reproduce simultaneous or nested dialog mounts. Verify initial focus, Tab containment, Escape, and focus restoration before changing the shared dialog.
- **L07:** Fail a goal action, close its panel, then reopen it. Clear an error when its panel or goal context changes.
- **L08:** Check the suggestion input and list with a screen reader. Verify expanded state, active option announcements, selection, and dismissal.

L02 and L04–L08 remain outside the user's current six-feature selection. L03 also requires a separate CLI change.
Their presence is why passing the current test suite does not mean that all known issues are closed.

## Selected implementation and UI requests

| ID | Item | Status | Scope and limits | Evidence |
| --- | --- | --- | --- | --- |
| P01 | Historical token/cost reports | Done | Real `/v1/usage/query` data; today/7/30 days, session filters, token/cost chart and tables, empty/error/retry states. No invented costs or offline report cache. | [usageReport tests](../src/happy/usageReport.test.ts), [UsageReport.tsx](../src/features/UsageReport.tsx), [webParity](../tests/webParity.e2e.test.ts) |
| P02 | Computer management | Done | Encrypted rename with version retry, confirmed daemon stop, confirmed account removal. Removal preserves session history. No real computer mutation during tests. | [MachineManagement.tsx](../src/features/MachineManagement.tsx), [client tests](../src/happy/client.test.ts), [webParity](../tests/webParity.e2e.test.ts) |
| P03 | Advanced settings | Done | English/Traditional Chinese interface, always-visible reported context, exact custom Codex model ID. Preferences remain Rayno-only. Server text and user content retain their original language. | [AdvancedSettings.tsx](../src/features/AdvancedSettings.tsx), [webParity](../tests/webParity.e2e.test.ts) |
| P04 | Questions inside tool activity | Done | Match pending forms and Claude questions by tool/request ID. Keep unmatched requests reachable through the fallback panel. | [Requests.tsx](../src/happy/Requests.tsx), [webParity](../tests/webParity.e2e.test.ts) |
| P05 | Additional tool result views | Done | Original file source, verified raster images, full diffs through incremental expansion, and denied/canceled command history. Current CLI omitted results remain unavailable. | [toolResults.ts](../src/data/toolResults.ts), [ToolDetails.tsx](../src/features/ToolDetails.tsx) |
| P06 | Subagent paging and missing records | Done | Share trusted bounds across pages/cache, infer close from parent completion, retain legacy child work, and show unresolved work without reply options. Old attention records rebuild derived counters while preserving read positions. | [normalize.ts](../src/happy/normalize.ts), [subagentPaging tests](../src/happy/subagentPaging.test.ts), [webParity](../tests/webParity.e2e.test.ts) |
| P07 | Remove duplicate header info icon | Done | The session title capsule opens info. The separate info icon is removed. | [Chat.tsx](../src/features/Chat.tsx), [webParity](../tests/webParity.e2e.test.ts) |
| P08 | Match header menu background | Done | Menu and title capsule share the same surface and border. | [chat.module.css](../src/features/chat.module.css), [ParityPage.ts](../tests/pages/ParityPage.ts) |
| P09 | Rail anchors at formal response starts | Done | One desktop anchor per formal agent response. No recap is required. Dense rails scroll without overlapping touch targets. Recap phrase links keep their existing targets. | [responseAnchors tests](../src/data/responseAnchors.test.ts), [replyRecap](../tests/replyRecap.e2e.test.ts), [webParity](../tests/webParity.e2e.test.ts) |
| P10 | Private local image paths | Done | Explicitly load a Markdown image or image link from the owning session CLI through encrypted RPC, validate it, and save an encrypted session attachment. Preserve the source binding in encrypted metadata and support offline cached reads. No public upload or agent turn. Workspace files only; PNG/JPEG/GIF/WebP up to 4 MB. | [path tests](../src/happy/localImages.test.ts), [client tests](../src/happy/client.test.ts), [browser tests](../tests/localImages.e2e.test.ts), [verification](../VERIFICATION.md#private-local-image-imports-2026-10-23) |
| P11 | Resize Side Chat and Session Info | Done | Drag or use the keyboard on the divider at desktop widths. Side Chat is 360–720px; Session Info is 320–560px. Both retain at least 520px of usable main conversation width and adapt to navigation/viewport changes. Each panel stores its own Rayno account-scoped width. Narrow screens retain the existing drawer/page flows. | [width tests](../src/app/panelWidths.test.ts), [browser tests](../tests/resizablePanels.e2e.test.ts), [verification](../VERIFICATION.md#resizable-session-panels-2026-10-23) |
| P12 | Navigation update action and unread badge | Done | Desktop rail and mobile tabs show Updates only when a newer release is known; current or unconfirmed versions occupy no navigation space. Check on entry, return, reconnect, and every five visible online minutes. New releases open a dismissible prompt without moving focus or reloading; explicit update preserves drafts and account data. Sessions shows an unnumbered unread dot, excluding archived and side chats. | [implementation](../src/app/NavigationUpdate.tsx), [browser tests](../tests/navigationStatus.e2e.test.ts), [verification](../VERIFICATION.md#navigation-updates-and-unread-dots-2026-10-23) |
| P13 | Divide agent responses and show date/time | Done | Each formal response begins with a 1px divider and the original server timestamp, formatted in the interface language and local time zone. Tools, thinking, and recap-only rows do not create extra headers. Missing legacy timestamps show as unavailable. Demo replies carry simulated creation times. | [rendering](../src/features/MessageList.tsx), [normalization](../src/happy/normalize.ts), [browser tests](../tests/responseHeaders.e2e.test.ts), [verification](../VERIFICATION.md#response-dividers-and-timestamps-2026-10-23) |
| P14 | Remove completed new-session forms from history | Done | Successful creation replaces the current form entry with the created chat. Browser Back returns to the previous page; Forward returns to the chat. Unfinished forms and folder-approval cancellation retain their drafts. Applies to live and demo creation. | [navigation](../src/features/NewSession.tsx), [history tests](../tests/newSessionHistory.e2e.test.ts), [folder tests](../tests/newSessionFolder.e2e.test.ts), [verification](../VERIFICATION.md#new-session-history-2026-10-23) |

## Delivery evidence

The baseline `32a06f9` reached the local previews before this continuation.
The checks below cover the implementation and local previews. Cloudflare production verification is separate.

Current counts: **42 Done, 7 Open, 5 Deferred, 3 Corrected, 2 Intentional**. Total: 59, including the later P10–P14 requests.

P10 verification is recorded in [VERIFICATION.md](../VERIFICATION.md#private-local-image-imports-2026-10-23).
The following counts describe the earlier parity delivery, before P10.

- Type check and production build: passed.
- Unit tests: 459 passed across 41 files.
- Complete browser run: 997 passed, 54 skipped, 9 outdated assertions failed.
- Final affected-path run after corrections: 231 passed, 5 skipped, 0 failed. It covers every earlier failure.
- Aggregate case coverage across both runs: 1,010 passed, 54 conditional skips, 0 remaining failures across 1,064 unique cases.
- Local evidence: `test-results/parity-2026-10-23/`, including logs, screenshots, source hashes, and the aggregate summary. These generated artifacts stay outside Git.

The skipped cases have project-specific conditions, such as a desktop rail on phones or service-worker flows that require a Chromium desktop context.
Browser evidence uses encrypted fixtures; no real daemon stop, account removal, or model turn ran.
Cloudflare access returned HTTP 403 during the baseline check, so production delivery was not verified.


Local preview delivery was verified on both loopback and Tailscale:

- [Preview on port 5178](https://rays-macbook-pro.tailf62d7d.ts.net:5178)
- [Preview on port 5179](https://rays-macbook-pro.tailf62d7d.ts.net:5179)

At verification time, both previews served `index-Dk4nA_U4.js`, built at `2026-10-22T18:41:58.549Z`.
The HTTP check compares the shell, version file, and JavaScript bytes with the tested build.
Existing Tailscale routes and preview processes remain unchanged. Old static assets remain available for open tabs.
The preview check used a working-tree build before this commit, so that build displays the base commit `32a06f9`.
Use Settings > About > Update now if an installed client retains the previous shell.
HTTP evidence is in `test-results/parity-2026-10-23/preview-check.json`.
