# Happy protocol sources

Rayno owns these adapted copies. It does not import the v1 runtime or source tree.
In this file, v1 means the Happy app (https://github.com/slopus/happy), including the author's web overlay for it.
The upstream source uses the MIT license in `HAPPY-LICENSE.txt`.

Upstream commit: `24d340d54ce8eba59167aa0d988d83cc07f069b3` in `slopus/happy`.
Overlay: the author's Rayno patch for the Happy app, as inspected on 2026-10-20. The patch is not published.
Paths under `rayno/` and `monitor/` below come from that overlay.

| Rayno file | Reference paths under `packages/happy-app/sources/` |
| --- | --- |
| `crypto.ts` | `encryption/deriveKey.ts`, `encryption/libsodium.ts`, `encryption/aes.web.ts`, `sync/encryption/encryption.ts`, `auth/secretKeyBackup.ts` |
| `auth.ts` | `auth/authQRStart.ts`, `auth/authQRWait.ts`, `auth/authGetToken.ts`, `app/(app)/restore/index.tsx` |
| `client.ts` | `sync/sync.ts`, `sync/apiSocket.ts`, `sync/ops.ts`, `sync/apiKv.ts` |
| `machineHealth.ts`, `manualUsage.ts` | `monitor/machineHealth.ts`, `monitor/manualUsage.ts`, `monitor/agentUsage.ts` |
| `versionUtils.ts` | `utils/versionUtils.ts` |
| `normalize.ts` | `sync/storageTypes.ts`, `sync/typesRaw.ts`, `../happy-wire/src/messages.ts`, `../happy-wire/src/sessionProtocol.ts` |
| `controlMessages.ts` | `../happy-wire/src/controlMessages.ts` |
| `systemPrompt.ts` | `sync/prompt/systemPrompt.ts`, sent as `appendSystemPrompt` in `sync/sync.ts` |
| `normalize.ts`, `../data/sessionList.ts` | `utils/sessionActivity.ts`, `utils/flatSessionList.ts`, `utils/worktreePaths.ts`, `utils/sessionListTimestamp.ts`, `utils/relativeTime.ts`, `sync/storage.ts` |
| `../components/useMinuteNow.ts` | `hooks/useMinuteNow.ts` |
| `modelOptions.ts` | `components/modelModeOptions.ts`, `sync/rig.ts`, `sync/storageTypes.ts` |
| `permissionOptions.ts` | `components/modelModeOptions.ts`, `utils/permissionModeLabels.ts`, `sync/agentDefaults.ts`, `sync/storageTypes.ts` |
| `handoff.ts` | `rayno/handoffPrompt.ts`, `rayno/useHandoffAction.ts`, `utils/worktreePaths.ts` from overlay commit `ab8283b9f73b578d008cab7d4ffe48c4b372af4f` |

Server contracts also reference `happy-server/sources/app/api/routes/sessionRoutes.ts` and `v3SessionRoutes.ts`.
Copies update only through an explicit compatibility review.

Complete leading task-notification wrappers do not create visible messages or attention changes.
Trailing user text and inline or incomplete examples remain visible. Stop accepts authenticated empty
RPC replies from older CLIs; other reads still require JSON. Encrypted RPC errors reach the caller.

Message records follow `sync/typesRaw.ts` for these CLI shapes. A Claude prompt typed in the terminal shows as a user message.
Claude meta prompts, compact summaries, and legacy sidechain output records do not show in the main thread and do not change attention.
Rayno does not attach those legacy records to the parent tool call. Agent `service` text shows as agent text. ACP `file-edit` is a
tool call, and ACP `terminal-output` is a tool result that shows only when it matches a call. A Claude tool result uses the stored
`toolUseResult` text only when it is a string.

Like `normalizeSessionEnvelope` in `sync/typesRaw.ts`, Rayno drops an agent session envelope without a `turn`, except a usage-only
`service` event and a `user-message-accepted` or `user-message-rejected` receipt. None of these three makes a chat row in Rayno.

Subagent work follows `sync/reducer/reducerTracer.ts` and the sidechain phase of `sync/reducer/reducer.ts`: an envelope with a
`subagent` id goes under the tool call whose `args.sessionSubagent` has that id, and the first subagent text is dropped when it
repeats the parent prompt. The CLI mapper (`claude/utils/sessionProtocolMapper.ts`, `mapClaudeLogMessageToSessionEnvelopes`)
passes the subagent id on through `parentUuid` (`claude/utils/sdkToLogConverter.ts` chains every row), so the parent tool result
and all later main rows of the turn carry it too. v1 nests those main rows as well and hides the main answer. Rayno uses the
`start` and `stop` events instead (`markSubagents`, `subagentOf` in `normalize.ts`): a tagged row belongs to the subagent only
between its start and its stop. After the stop it is a main row. A subagent `service` event (Codex collab state) always belongs
to the subagent. When no bound is on the loaded rows, the row stays in the main thread, so a main answer never disappears.
A `Task` call has no tool-call event, and the parent can be on an unloaded page; that work shows as its own collapsed tool row,
named by the `start` title. Subagent rows never change attention or reply options. The client keeps the bounds of every row it
reads in memory for each session, and a background scan reads the bounds of the full page before it classifies rows.
A scan after a reload that sees only rows from inside a running subagent cannot place them and counts them as main rows.

Thinking follows the `thinking` content of `sync/typesRaw.ts`: Claude `thinking` chunks, session `text` events with
`thinking: true`, and ACP `thinking` records (stream chunks that join without a break). Rayno also treats Codex and ACP
`reasoning` records as thinking; v1 shows them as text. v1 hides thinking (`components/MessageView.tsx`); Rayno shows it in
a closed `Thinking` disclosure. Thinking without reply text joins the tool activity row group. Thinking never counts for
attention, reply options, or recaps.

Archive classification follows the overlay's `sync/storage.ts`: a lifecycle marker or an inactive
non-Rig CLI session belongs in the archive. An inactive Rig session remains live work unless marked.
The Active/Archived selector in Rayno's list options menu changes list visibility only. CLI resume uses the explicit Resume session action and the original machine RPC.

Archive and delete follow `hooks/useSessionQuickActions.ts` and `app/(app)/session/[id]/info.tsx`. Archive sends the
`killSession` RPC first. The CLI handler (`happy-cli/src/claude/registerKillSessionHandler.ts`) writes the archived
lifecycle itself. A failed kill or an offline computer falls back to `POST /v1/sessions/:id/archive`. Rayno writes the
archive marker only for Rig sessions. Delete sends a best-effort `killSession` to a connected session first.
Rayno does not prompt for worktree cleanup.

Like `sync/sync.ts`, Rayno skips a session, computer, or message that does not decrypt. The other records still load
and the cursors still advance. A skipped message keeps its id and seq with empty content. The error still shows when
no record decrypts on the first workspace read or on the first history page.

Model/effort writes also reference `packages/happy-cli/src/api/types.ts`,
`packages/happy-cli/src/claude/runClaude.ts`, and `packages/happy-cli/src/codex/runCodex.ts`.
Rayno keeps composer choices in its own account-scoped storage and sends them with the next message.

Session attention is an independent Rayno implementation over session `seq`, encrypted message history,
formal agent-state requests/communications, and parsed reply options. Background scans use the existing
v3 paginated message-read contract. Read cursors live only in Rayno account-scoped browser storage and
merge monotonically across tabs. They do not read or write v1's frontend store or cloud read receipts.

The session-list usage capsule uses the same adapted `manualUsage.ts` reader as Monitor, through
the machine's read-only `bash` RPC. Rayno coalesces requests and keeps its own in-memory readings;
it does not save into v1's shared usage KV. The connected provider reads once per minute while
the tab is visible and focused, across all Rayno routes. Blur or a hidden page stops the polling timer.
Focus resumes stale reads. Offline computers do not receive reads, and concurrent refreshes share one request.
Unavailable readings remain unknown or visibly stale.
The current session's source computer is preferred in the compact summary; expanded details retain
all computers' readings separately.

Each computer receives one usage RPC per polling cycle. It starts a Claude SDK query with no input
messages and a short-lived Codex app-server request. This reads plan limits without a model turn.
It still has process-start and network costs; it does not query once per session.

Hand Off copies the v1 prompt and default provider switch into Rayno-owned code. It prepares only a local
new-session draft. The user can edit it before Start sends the normal spawn and encrypted first message.
Claude/Codex transcript paths use provider session IDs from decrypted metadata. Unknown transcripts
request context instead. An absolute worktree selection must match the daemon's Git worktree list;
Rayno reuses that exact directory without creating a branch or changing the source session.

The same-checkout draft helper now lives in `../data/workspaces.ts`, inside Rayno.
Recent workspace choices combine normalized session activity with Rayno's own account-scoped,
per-computer browser history. They never read v1's draft or workspace settings.
The new-session model picker uses the existing model/effort catalogs and spawn/message contracts.

`modelPreferences.ts` validates remembered model/effort choices against those catalogs. UI controls omit
agent-default aliases and send explicit model IDs and supported effort values. Preferences stay in Rayno's
own account store, separate by agent and, for legacy Happy Agent sessions, by computer. Existing chats
retain their explicit session choices. Happy Agent is hidden from new-session and agent-switch controls.

Plan mode follows `sync/messagePlanMode.ts`, `sync/sync.ts` (`enteredPlanMode`), and
`components/tools/PermissionFooter.tsx`. The Claude CLI does not report a mode that Claude takes itself.
`handleModeChange` (`claude/utils/permissionHandler.ts`) pushes a message's `meta.permissionMode` into the SDK
only when it differs from the handler mode, so a repeated mode does not end plan mode. `latestAgentMode` reads
the last `EnterPlanMode` tool call as `plan`, unless its request is pending, `denied`, or `canceled`. An
`ExitPlanMode` call counts only after `completedRequests[call].status` is `approved`; it gives the approved
`mode`, else `default`. Rayno has no plan approval buttons for other modes, so an `ExitPlanMode` approval sends
`mode` set to the newest picked or sent mode other than `plan` (`modeBeforePlan`). When no loaded page has a sent
message, it reads older pages (`findSentModes`). Without `mode`, the CLI puts a yolo session in `default`. The agent mode replaces a sent message when its tool-call message has a newer server
time. It replaces a pick when it is newer and the pick did not see its call (`agentCall`). As in
`PermissionFooter.tsx`, edit tools and `ExitPlanMode` have no session approval, so each plan exit asks the user.

New-session permission choices use the same CLI catalogs as chat. Rayno retains the latest explicit choice
for each agent in its account store and uses Auto when no valid choice exists. The machine's
`spawn-happy-session` RPC receives `permissionMode`; the first encrypted message receives the same mode.
The new chat retains that explicit selection in its own composer settings.
The selected computer's `happyCliVersion` gates the fixed new-session catalog, as in `filterPermissionModesForCli`
from `hooks/useStartSessionFromDraft.ts`: a CLI older than `1.2.1-beta.2` does not get Auto. Model and effort catalogs have no version gate there.
When the daemon answers `requestToApproveDirectoryCreation` (`happy-cli/src/daemon/run.ts`), Rayno asks before it creates
the folder. The approved retry sends the same draft with `approvedNewDirectoryCreation: true` and keeps the pending request ID.

`offlineCache.ts` adds independent, account-scoped IndexedDB persistence for session/machine records and loaded history pages.
Each cached payload uses the existing account encryption helper. No bearer token or plaintext message body enters the database.
The service worker caches the application shell only. Cached pages retain their verified history cursor, so reconnect can fill gaps.
Known offline state stops network reads and agent actions. Draft editing remains local; it never queues an automatic send.
Sign-out stops the client, drains pending cache writes, and removes only this account's cache.

Priority feature contracts were checked against the local Happy snapshot `2dcac1ad0f5ae46f6fd9d8a2880d806424c93d57` on 2026-10-21:

- `attachments.ts` and `crypto.ts`: `encryption/blob.ts`, `sync/encryption/encryption.ts`, `sync/apiAttachments.ts`, and `sync/sync.ts`. Blobs use XSalsa20-Poly1305 with a 24-byte nonce and the derived session/master blob subkey. File events precede the text record in one idempotent v3 message batch.
- `Requests.tsx` and `client.ts`: `components/tools/views/AskUserQuestionView.tsx`, `components/tools/PermissionFooter.tsx`, and `sync/ops.ts`. Claude receives `updatedInput.answers` keyed by the original question text. Claude session approvals send exact `allowTools` (`claude/utils/permissionHandler.ts` reads that name; the CLI echoes it as `allowedTools` in `completedRequests`); Codex uses `approved_for_session`.
- `resume.ts` and `client.ts`: `hooks/useSessionQuickActions.ts` and `sync/ops.ts`. Resume requires advertised daemon support, the owning online machine, and a provider recovery ID. The encrypted machine RPC may carry the session data key as fallback; legacy sessions never send the account master secret.
- `normalize.ts`: `sync/typesRaw.ts`. Session, Claude output, and Codex/ACP tool calls retain their IDs and join later results by call ID. Raw strings and edit arguments stay readable without HTML execution.

Chat-header Fork and Duplicate follow `utils/sessionFork.ts`, `components/DuplicateSheet.tsx`, and `sync/ops.ts` in the same Happy snapshot. Claude uses `claude-fork-session`, `claude-list-rewind-points`, and `claude-duplicate-session`; Codex uses the matching thread RPCs. A second `spawn-happy-session` call attaches to the copied provider ID and carries `parentSessionId`. Rayno supplies concrete model/effort/permission values, retains the copy after an explicit spawn failure, and refuses an automatic second copy when the first result is unknown.
