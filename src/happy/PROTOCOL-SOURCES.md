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
| `normalize.ts` `contextUsage`, `../features/ContextMeter.tsx` | `sync/reducer/reducer.ts` (`processUsageData`, reset events), `sync/typesRaw.ts` (`usageDataSchema`), `components/AgentInput.tsx` (`getContextStatus`, `formatTokenCount`, `AgentInputUsageRow`) |
| `modelOptions.ts` | `components/modelModeOptions.ts`, `sync/rig.ts`, `sync/storageTypes.ts` |
| `permissionOptions.ts` | `components/modelModeOptions.ts`, `utils/permissionModeLabels.ts`, `sync/agentDefaults.ts`, `sync/storageTypes.ts` |
| `agentGoal.ts`, `../features/TaskDock.tsx` | `components/agentGoalStatus.ts`, `components/AgentGoalBar.tsx`, `-session/agentGoalActionHandler.ts`, `sync/ops.ts` (`sessionGoalAction`), `sync/storageTypes.ts` (`AgentGoalStatusSchema`) |
| `../data/todos.ts`, `../features/TodoList.tsx` | `components/tools/views/TodoView.tsx`, `components/tools/knownTools.tsx` (`TodoWrite`), `sync/storageTypes.ts` (`TodoItemSchema`), `sync/reducer/reducer.ts` (`latestTodos`) |
| `handoff.ts` | `rayno/handoffPrompt.ts`, `rayno/useHandoffAction.ts`, `utils/worktreePaths.ts` from overlay commit `ab8283b9f73b578d008cab7d4ffe48c4b372af4f` |
| `suggestions.ts`, `../features/ComposerSuggestions.tsx` | `components/autocomplete/findActiveWord.ts`, `components/autocomplete/applySuggestion.ts`, `components/autocomplete/suggestions.ts`, `components/autocomplete/useActiveSuggestions.ts`, `sync/suggestionCommands.ts`, `sync/suggestionFile.ts`, `sync/rig.ts` |

Server contracts also reference `happy-server/sources/app/api/routes/sessionRoutes.ts` and `v3SessionRoutes.ts`.
Copies update only through an explicit compatibility review.

Complete leading task-notification wrappers do not create visible messages or attention changes.
Trailing user text and inline or incomplete examples remain visible. Stop accepts authenticated empty
RPC replies from older CLIs; other reads still require JSON. Encrypted RPC errors reach the caller.

Message records follow `sync/typesRaw.ts` for these CLI shapes. A Claude prompt typed in the terminal shows as a user message.
Claude meta prompts, compact summaries, and legacy sidechain output records do not show in the main thread and do not change attention.
Rayno does not attach those legacy records to the parent tool call. Session envelopes with a `subagent` field go under their
parent tool call (see the subagent paragraph below). Agent `service` text shows as agent text. ACP `file-edit` is a tool call, and ACP
`terminal-output` is a tool result that shows only when it matches a call. As in `sync/typesRaw.ts`, a Claude tool result
uses the stored `toolUseResult` when it is set, as text or a structured value. The tool_result text stays as `resultText`.
A session tool call keeps its tool name as `tool` because its row shows the title. As in `sync/typesRaw.ts`, a
`tool-call-end` without a result ends the call with a `null` result, and the row says that no result text came.

Structured results, the tool_result `permissions` field, and Claude AskUserQuestion answers exist only in legacy Claude
`output` records from older CLIs. The current CLI sends every Claude record as a session envelope (`api/apiSession.ts`
`sendClaudeSessionMessage`, `claude/utils/sessionProtocolMapper.ts`). Its `tool-call-end` has only `call`
(`happy-wire/src/sessionProtocol.ts`), so it has no result, `toolUseResult`, or `permissions`. In legacy records, local
mode carries `toolUseResult` from the Claude Code JSONL and no `permissions`. Remote mode carries `permissions`
(`claude/claudeRemoteLauncher.ts`) and no `toolUseResult`, because `claude/utils/sdkToLogConverter.ts` copies only
`message`, `parent_tool_use_id`, and `isMeta`. For a current Claude session, the reply comes only from
`agentState.completedRequests`. That entry keeps the original `arguments` and not the answers
(`claude/utils/permissionHandler.ts`), so answered Claude questions show only the Answered badge. Happy Web also shows
no answers for a completed AskUserQuestion (`components/tools/views/AskUserQuestionView.tsx`).

`../data/toolResults.ts` renders structured results in the style of `components/tools/knownTools.tsx`,
`components/tools/views/*`, and `utils/toolResult.ts`: Bash stdout/stderr and exit status, Edit/MultiEdit/Write
`structuredPatch` diffs (or the edit arguments before a result), Read file ranges, Grep/Glob files and matches,
Task/Agent reports, TodoWrite `newTodos`, AskUserQuestion `answers`, WebFetch, and WebSearch. Images and
`originalFile` do not render. Unknown values show the tool_result text, else JSON. Diffs show at most 400 lines.

`toolDecisions.ts` follows `sync/reducer/reducer.ts` and `components/tools/PermissionFooter.tsx`. A tool call shows the
past permission reply from `agentState.completedRequests`, joined by `toolUseId` or the request ID. A legacy tool_result
`permissions` field (`happy-cli/src/claude/claudeRemoteLauncher.ts`) merges over it, and the agent-state `reason` and
`decision` stay, as in the v1 reducer. Both `allowedTools` and `allowTools` are read.
A session approval is a Codex `approved_for_session` decision or an allowed tool that names the tool or `Bash(command)`.
AskUserQuestion answers come from the legacy result `answers` map, keyed by question text. Answered
`completedCommunications` forms join by `toolUseId` (`sync/agentCommunications.ts`). Answers show in a group above the
tool rows, so the row does not repeat them.

Unlike v1 (`sync/reducer/reducer.ts`), a completed request without a loaded tool call does not add a placeholder row.
The effect: a denied or aborted Codex command does not show in the transcript. The Codex mapper does not map
`exec_approval_request` (`codex/utils/sessionProtocolMapper.ts`), so a command has a tool call only after approval.

Agent events follow `components/MessageView.tsx` `AgentEventBlock`, `sync/typesRaw.ts` `agentEventSchema`, and
`sync/reducer/reducer.ts`. The CLI writes them with `api/apiSession.ts` `sendSessionEvent` as a legacy
`{ role: 'agent', content: { type: 'event', data } }` record. A `switch` shows `Switched to local mode` or
`Switched to remote mode`. A `message` shows its text, for example `Aborted by user`, `Context was reset`, or a Codex
error. A `limit-reached` event shows `Usage limit reached until` and the local time of `endsAt` (Unix seconds).
Like `sync/reducer/messageToEvent.ts`, a Claude text `Claude AI usage limit reached|<seconds>` becomes that limit row.
`ready`, `Turn started`, and send receipts show no row. The v1 schema drops other event types, such as
`permission-mode-changed`, so Rayno shows no row for them. An event row is a centered, secondary line with no content.
It does not count as a reply for attention, unread state, options, recaps, or the recap button.
Rayno does not port the two tool conversions of `messageToEvent.ts`. `mcp__happy__change_title` and `EnterPlanMode`
stay tool rows, because the plan-mode reading uses the `EnterPlanMode` call, and v1 drops the other content of that message.

Like `normalizeSessionEnvelope` in `sync/typesRaw.ts`, Rayno drops an agent session envelope without a `turn`, except a usage-only
`service` event and a `user-message-accepted` or `user-message-rejected` receipt. None of these three makes a chat row in Rayno.

Subagent work follows `sync/reducer/reducerTracer.ts` and the sidechain phase of `sync/reducer/reducer.ts`: an envelope with a
`subagent` id goes under the tool call whose `args.sessionSubagent` has that id, and the subagent text is dropped when it
repeats the parent prompt and is the first row of the work (`isDuplicateSidechainPrompt`). Subagent thinking and file
attachments stay in the work list; v1 shows sidechain thinking as italic text. The CLI mapper (`claude/utils/sessionProtocolMapper.ts`, `mapClaudeLogMessageToSessionEnvelopes`)
passes the subagent id on through `parentUuid` (`claude/utils/sdkToLogConverter.ts` chains every row), so the parent tool result
and all later main rows of the turn carry it too. v1 nests those main rows as well and hides the main answer. Rayno uses the
`start` and `stop` events instead (`markSubagents`, `subagentOf` in `normalize.ts`): a tagged row belongs to the subagent only
between its start and its stop. After the stop it is a main row. A subagent `service` event (Codex collab state) always belongs
to the subagent. When no bound is on the loaded rows, the row stays in the main thread, so a main answer never disappears.
The Codex mapper (`codex/utils/sessionProtocolMapper.ts`, `collabArgs`) puts the same `sessionSubagent` in every collab call
(`spawnAgent`, `sendInput`, `wait`, `closeAgent`). Like `toolCallToMessageId` in the tracer, each subagent row goes under the
latest of those calls before it, or under the first call when it comes before all of them, so every row shows only once.
A `Task` call has no tool-call event, and the parent can be on an unloaded page; that work shows as its own collapsed tool row,
named by the `start` title. Subagent rows never change attention or reply options. The client keeps the bounds of every row it
reads for each session. The mapper tags the main rows after a `stop` with the subagent id until the turn ends, and the stop
can be on an older page than those rows. So a background scan keeps every page it reads and classifies the rows only after
it has the bounds of all of them. The bounds are saved with the encrypted, account-scoped offline workspace (`subagents` in
`offlineCache.ts`) and restored before the first scan, so a scan after a reload that sees only rows from inside a running
subagent still places them. With the bounds, the client saves `read`: the seq range that its scans read without a gap. A
`start` without a known `stop` counts only for rows that the client can connect to it without a gap (the read range and the
loaded pages). Otherwise its stop can be in rows that the client did not read, so the tagged rows stay main rows: a scan that
stops above the start, or a cache whose range ends before the saved attention boundary, never hides a main answer. A row
whose bound is not known (no cache, or a damaged entry) also stays a main row. The transcript still places rows only from
the bounds on the loaded pages.

Thinking follows the `thinking` content of `sync/typesRaw.ts`: Claude `thinking` chunks, session `text` events with
`thinking: true`, and ACP `thinking` records (stream chunks that join without a break). Rayno also treats Codex and ACP
`reasoning` records as thinking; v1 shows them as text. v1 hides thinking (`components/MessageView.tsx`); Rayno shows it in
a closed `Thinking` disclosure. Thinking without reply text joins the tool activity row group. Like the `hidden` known tools in
`components/tools/knownTools.tsx`, Rayno hides `CodexReasoning`, `GeminiReasoning`, and `think` calls. The Codex mapper
(`mapCodexProcessorMessageToSessionEnvelopes`) sends their text as session thinking text. Older Codex and ACP records
(`utils/BaseReasoningProcessor.ts`) keep it only in the call result, so Rayno shows that `output.content` as thinking. Thinking never counts for
attention, reply options, or recaps.

Archive classification follows the overlay's `sync/storage.ts`: a lifecycle marker or an inactive
non-Rig CLI session belongs in the archive. An inactive Rig session remains live work unless marked.
The Active/Archived selector in Rayno's list options menu changes list visibility only. CLI resume uses the explicit Resume session action and the original machine RPC.

Archive and delete follow `hooks/useSessionQuickActions.ts` and `app/(app)/session/[id]/info.tsx`. Archive sends the
`killSession` RPC first. The CLI handler (`happy-cli/src/claude/registerKillSessionHandler.ts`) writes the archived
lifecycle itself. A failed kill or an offline computer falls back to `POST /v1/sessions/:id/archive`. Rayno writes the
archive marker only for Rig sessions. Delete sends a best-effort `killSession` to a connected session first.
A bot archives only through `killSession`; a failed kill keeps the bot and shows the error, as in Happy Web.
A bot is a Rig session, so after the kill it stays in the list as inactive. Rayno writes no bot metadata.
Like `sync/ops.ts` `sessionDelete`, Rayno refuses to delete a bot and hides its delete actions.
Happy Web has no bot restore, so Rayno refuses to restore an archived bot.

Before an archive or a delete, `hooks/useWorktreeCleanup.ts` and `utils/worktree.ts` decide on a worktree prompt.
The session path must contain `/.dev/worktree/`, no other connected session may use it, and the machine `bash` RPC
`git status --porcelain` must succeed with empty output. A failed check skips the prompt. Delete worktree sends
`git worktree remove <path> --force` from the main checkout, then the archive or delete continues; Keep files only
continues. Rayno quotes the path and skips the check for an offline computer. Closing the Rayno prompt cancels the action.
A side chat (`metadata.isSideChat`) never gets the prompt, because it runs in its parent's folder. Happy Web closes a side chat
from its panel without the check (`-session/SessionView.tsx` `archiveSideChatSession`). Its Session info archive and delete have
no side chat exception, so after the parent ended they can offer the parent's worktree. Rayno skips the check on every close and
delete path of a side chat.

Like `sync/sync.ts`, Rayno skips a session, computer, or message that does not decrypt. The other records still load
and the cursors still advance. A skipped message keeps its id and seq with empty content. The error still shows when
no record decrypts on the first workspace read or on the first history page. It also shows when every session fails
on the first read, even when a computer decrypts. Records from the offline cache do not count as a server read: until
one read succeeds, a read that decrypts nothing (or no session) keeps the cached copy, its saved time, and the error.
Until that read, Rayno also does not write the cache, so a later presence event cannot save the stale copy again.

The session list sorts on `utils/sessionActivity.ts`: `metadata.lastMeaningfulMessageAt`, then this device's last
send time, then `createdAt`. Like `markSessionMessageSent` in `sync/storage.ts`, Rayno stamps the time after a
confirmed send, keeps it in its own account-scoped storage, and removes it when the session is deleted.

The `communication` RPC (`sync/ops.ts` `sessionAnswerQuestion` and `sessionCancelCommunication`) has no handler in the
Happy CLI or `happy-agent` sources in this snapshot. Happy Web `sessionEncryption.ts` `decryptRaw` reads an empty reply
as `null` and completes the answer, so an agent handler can return void. Rayno accepts an authenticated empty plaintext for
`communication` and then clears the form. A missing handler still replies `{ error: 'Method not found' }`
(`happy-cli/src/api/rpc/RpcHandlerManager.ts`), and a damaged reply still fails, so both keep the form open.

Model/effort writes also reference `packages/happy-cli/src/api/types.ts`,
`packages/happy-cli/src/claude/runClaude.ts`, and `packages/happy-cli/src/codex/runCodex.ts`.
Rayno keeps composer choices in its own account-scoped storage and sends them with the next message.

Session attention is an independent Rayno implementation over session `seq`, encrypted message history,
formal agent-state requests/communications, and parsed reply options. Background scans use the existing
v3 paginated message-read contract. Read cursors live only in Rayno account-scoped browser storage and
merge monotonically across tabs. They do not read or write v1's frontend store or cloud read receipts.

The browser tab follows `sync/webTabTitle.ts` and `components/web/FaviconPermissionIndicator.tsx`. Rayno counts listed
sessions with the unread or needs-input state above, so the `(N)` prefix clears when the user reads or answers the
session, also after a reload. The badged favicon shows while a connected session waits for the user.
The plaintext `session-event` ephemeral (`sync/apiTypes.ts`; sent by `happy-server/sources/app/api/routes/pushRoutes.ts`
with kind `done`, `permission`, or `question`) starts the same attention read for that session; it does not keep its own counter.
That read covers only the message history, so it recovers a missed reply. A permission request still needs `update-session`,
because `happy-cli/src/claude/utils/permissionHandler.ts` sends the `permission` push before it writes the agent state.

Composer suggestions use the v1 `@` and `/` prefixes. `/` lists the v1 default commands, then the session metadata
`slashCommands` and `skills` (from the Claude SDK init message in `happy-cli/src/claude/claudeRemote.ts`), without the v1
ignored names. `@` reads `rg --files --follow` once through the session `ripgrep` RPC
(`happy-cli/src/modules/common/registerCommonHandlers.ts`), adds the parent folders, and keeps the index for five minutes.
A failed read is not kept, so the next `@` tries again. Rig v1 sessions must advertise file search and the RPC.
Rayno ranks matches with its own matcher instead of Fuse.js. The list never takes focus, so the phone keyboard stays open.

The session-list usage capsule uses the same adapted `manualUsage.ts` reader as Monitor, through
the machine's read-only `bash` RPC. Rayno coalesces requests and keeps its own in-memory readings;
it does not save into v1's shared usage KV. The connected provider reads once per minute while
the tab is visible and focused, across all Rayno routes. Blur or a hidden page stops the polling timer.
Focus resumes stale reads. Offline computers do not receive reads, and concurrent refreshes share one request.
Unavailable readings remain unknown or visibly stale.
Context use shows only when the usage carries `context_window`. Happy does not guess the window from a model table.
Rayno has no `alwaysShowContextSize` setting and no usage footer, so the composer shows only Happy's near-limit
warning at 10% and 5% remaining. The Model & effort sheet shows the reading whenever the window is known.
Unlike the Happy reducer, subagent usage does not count, and a later record wins a timestamp tie. A subagent row is a row inside
the subagent `start` and `stop` bounds (`subagentOf`), because the Claude mapper also tags the main answer after a subagent with its id.
Usage details show the `five_hour` and `seven_day` windows, like the usage popup in `components/AgentInput.tsx`.
Like that popup, each window shows when the provider reports it, so a plan with only a `five_hour` window still has a reading.
The compact summary and the Monitor card show the weekly window. Without one, they show the 5-hour window:
the summary marks it `5h`, and the Monitor card says `of 5 hours used`.
Other provider windows stay hidden. The composer warning and the Model & effort reading show context use, not plan windows.
Codex effort choices follow `CODEX_EFFORTS_BY_MODEL` in `components/modelModeOptions.ts`. A model outside
that table gets `low` through `xhigh`. The `thinkingLevels` of a published computer catalog still win.
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
Fork, Duplicate, and a new side chat use the same question. Happy Web `forkAndSpawn` shows that reply as a generic error instead. The
approved retry reuses the copied provider conversation and sends only the second `spawn-happy-session` call.
Cancel drops the copied conversation, so the next Fork, Duplicate, or side chat copies the current conversation again.

`offlineCache.ts` adds independent, account-scoped IndexedDB persistence for session/machine records, subagent bounds, and loaded history pages.
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

Agent communications and send receipts were checked against the local Happy snapshot `2dcac1ad0f5ae46f6fd9d8a2880d806424c93d57` on 2026-10-22:

- `normalize.ts` `pendingCommunications` and `Requests.tsx`: `sync/agentCommunications.ts`, `sync/storageTypes.ts` (`AgentCommunicationSchema`), `components/AgentQuestionBanner.tsx`, and `components/AgentQuestionModal.tsx`. Only `kind: 'form'` is answerable. A form without an answerable question is dropped. Any other kind shows its `title` and a Dismiss action. Answers follow `buildAnswers`: blank drafts are not sent, and a single choice keeps one option.
- `client.ts` `answerQuestions`: `sessionAnswerQuestion` and `sessionCancelCommunication` in `sync/ops.ts`. The `communication` session RPC carries `{ id, kind, status }` and `answers` only when the status is `answered`. The reply echoes the raw `kind` of the request.
- `normalize.ts` `messageReceipt`, `sendsMessageReceipts`, `deliveryMeta`, and `visibleMessages`: `sync/typesRaw.ts` (`user-message-accepted`, `user-message-rejected`), `sync/rig.ts` `rigSendsMessageReceipts`, `sync/messageMeta.ts` `resolveMessageDeliveryMeta`, and `sync/reducer/reducer.ts` `settleUserMessage`. Only a Happy Agent session with `rigMetadataVersion >= 1` and `capabilities.messageReceipts === true` holds a message that has `meta.expectsAcceptance`. The first receipt puts the message at the receipt's place in the stream. A rejected message keeps its reason and does not start a turn (`utils/agentTurns.ts`).
- `sessionAttention.ts` `userTurn` and `../data/replyTurns.ts` `unansweredMessageIds`: the same receipt rules, so the "Needs your reply" dot and the chat reply options agree. In a session with receipts, a held or rejected message does not answer options. Its accepted receipt answers them at the receipt's seq. As in `utils/agentTurns.ts`, a held message does not start a turn, so its options stay open. Rayno adds one guard: the options that the user chose stay disabled in that chat until a rejection.
- `../data/recapView.ts`, `../data/replyTurns.ts` `hasOpenRecapRequest`, `../features/MessageList.tsx`, `modelPreferences.ts`, and `client.ts` `findSentModes`: a rejected message is not a user turn, as with `sendError` in `utils/agentTurns.ts`. It does not close a recap request, it does not hide the Recap action of the reply before it, and its settings are not the last sent modes. A rejected recap request stays visible with its reason. Tool rows still group around the rejected bubble, because the bubble shows at the receipt's place.
- `../features/MessageList.tsx`: `UserMessageFrame` in `components/MessageView.tsx`. A `queuedWhileBusy` send shows "Sends after this turn" at once. Other held sends show "Sending…" after a 1-second grace period. A refusal shows "Not sent: <reason>". Happy Web has no retry action for a refused message.

Side chats follow `sync/ops.ts` (`spawnSideChat`, `forkAndSpawn`), `sync/storage.ts` (`useSideChatSessions` and the list filters),
`components/SideChatPanel.tsx`, and `-session/SessionView.tsx` in the same Happy snapshot. On the CLI side, `daemon/run.ts` turns the
`spawn-happy-session` field `isSideChat` into `HAPPY_SIDE_CHAT`, and `claude/runClaude.ts` and `codex/runCodex.ts` write `metadata.isSideChat`
and `metadata.parentSessionId`. They do not replay the parent history into the side chat UI. `../data/sideChats.ts` selects the side chats of
a parent by these two fields, oldest first. A regular fork has `parentSessionId` without `isSideChat` and stays in the session list.
Rayno starts a side chat with the same fork RPC and spawn as Fork (kind `side`) and adds `isSideChat: true` and the parent's concrete
model/effort/permission. Like `useSideChatSessions`, only `lifecycleState: 'archived'` closes a side chat (`Session.sideChatClosed`).
A side chat that lost its CLI connection (`active: false` from `presence/timeout.ts` or a session end) stays open with an "Ended" status
and the normal resume path. Close uses the normal archive flow (`killSession`, else the server archive) and then writes the archived
lifecycle marker. Happy Web hides a closed side chat only in memory (`closedSideChatIds`) because the server archive sets only
`active: false`; the marker keeps it closed after a reload and on other clients. A resume removes the marker. Closed side chats stay
readable from the parent. The full view, the Session info close, and the menu close return to the parent's list, and the full-view title
uses the same "Side chat N" number as the list (`SideChatModal`). The side chat entry is hidden for an agent that cannot fork when the
parent has no side chats. Happy Web shows side chats only in the desktop sidebar. Rayno shows them in a panel at 1280px and wider, in a
drawer on tablets, and on a page from the session menu on phones. A Happy CLI that ignores `isSideChat` starts a regular fork; Rayno
opens it and says so. Scope choice: Rayno does not port the `newSideChat` chord (`keyboard/shortcuts.ts`, ⌥⌘S or Ctrl+Alt+S). Happy Web
listens for it only while the empty sidebar picker or its add menu is open (`FilesSidebar.tsx`), and Rayno has no such picker.

Goal and todo progress were checked against the same local Happy snapshot on 2026-10-22. The goal shows above the
composer only while the session is online and `agentGoalStatus.sourceSessionId` matches the metadata `claudeSessionId`
or `codexThreadId`. Actions follow the reported `capabilities`. Rayno offers edit and clear only: the CLI handlers
(`happy-cli/src/claude/runClaude.ts`, `happy-cli/src/codex/runCodex.ts`, parsed by `claudeGoalStatus.ts` and
`codexGoalStatus.ts`) reject `stop`, and Happy Web ignores it. The `goal-action` RPC sends `{ action }` or
`{ action: 'edit', objective }`; an empty or unchanged edit sends nothing. The Claude CLI answers after the new goal
status arrives, or with an error when Claude is busy; Rayno shows that error. A TodoWrite row shows its list from the
call input, replaced by a valid `newTodos` in the structured Claude `toolUseResult`. One parser in `../data/todos.ts`
(`todoList`) follows `TodoView.tsx` and the `knownTools.tsx` schemas for the row, the generic tool view in `../data/toolResults.ts`,
and the chip: one malformed item fails the whole list, and a result with an invalid `oldTodos` or `newTodos` does not replace
the input list. A row without a valid list,
or with an error, shows the raw arguments and result, as `knownTools.tsx` falls back to the generic tool view. The progress chip uses the newest
TodoWrite call that ended without an error and has a valid list. Unlike Happy Web `latestTodos`, it also reads session-protocol calls, whose
`tool-call-end` has no result. The CLI `Context was reset` event clears the chip. Archived sessions do not show it.
Subagent TodoWrite calls do not change the chip, as Happy Web skips sidechain messages. `visibleMessages` puts the calls
between a subagent's `start` and `stop` under the parent tool call (`subagentOf`), so the chip does not see them. The chip
also checks each call row with `subagentOf` against the bounds that the client knows from other pages and the offline cache,
so a call from a running subagent whose `start` is on an unloaded page does not replace the list. The CLI
mapper keeps the id on later main records through `parentUuid`, so a call after `stop` still counts as a main call. The chip
uses the same read-range rule as attention: an open `start` that the client cannot connect to the loaded pages does not count,
so a main call after an unread `stop` still changes the list. The
TodoWrite row shows its list in the row; the generic structured result view (`../data/toolResults.ts`) is the fallback.

Terminal control follows `components/ChatFooter.tsx`, `components/ChatList.tsx`, `app/(app)/session/[id]/info.tsx`,
`sync/controlHandoff.ts`, `sync/rig.ts` (`usesControlledSessionUi`), and `sessionSwitch` in `sync/ops.ts`. The Claude CLI
(`claude/runClaude.ts`) writes `agentState.controlledByUser` as `mode === 'local'` at start and on each mode change, and sends
a `switch` session event. Rayno shows terminal control only for a connected non-Rig session. The composer stays usable:
`claude/claudeLocalLauncher.ts` moves to remote mode when a message reaches its queue. Take control sends the void `switch`
RPC with `{ to: 'remote' }`. The CLI handlers ignore `to` and toggle the mode (`claudeRemoteLauncher.ts` moves back to
local), so Rayno sends it only while the newest agent state reports terminal control, and at most once per agent-state
version for 15 seconds. Rayno does not offer the move back to the terminal; Happy Web has no such control, and a
daemon-started CLI has no terminal. A control handoff reads newer history for an open chat, as `sync/sync.ts` does.
