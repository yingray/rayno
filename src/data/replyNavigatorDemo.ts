import type { Message, Session } from './types';

export const replyNavigatorDemoId = 'reply-navigator-demo';

// Each reply is longer than 500 characters, so each one gets a tick on the reply rail.
const turns: [string, string[]][] = [
  ['The week bar on the Codex row does not update. Check the merge logic for manualUsage.', [
    'The Codex row never moves because `mergeAgentUsage` keeps the session reading whenever both readings exist. The manual refresh is newer, but the merge drops it.',
    'I changed the merge to compare `capturedAt` and keep the newer reading. The week bar now follows the latest refresh, and a stale session reading cannot hide it.',
    'The session hook still writes its reading every minute. That reading now wins only when it is newer than the last manual refresh, which is the order a user expects.',
    'The Codex row also shows the capture time in its tooltip, so you can see which reading the bar uses. The tooltip uses the same format as the Claude row.',
    'Fixed, and added a test for a newer manual reading. 12 tests pass.']],
  ['Does the Claude row have the same problem?', [
    'No. Claude readings come only from the session hook, so there is nothing to merge and the row always shows the latest value.',
    'The same problem can appear if we add a manual refresh for Claude later. Both rows would then have two sources, and the older source could win again.',
    'I left a note on `mergeAgentUsage` that explains the rule: compare the capture time, not the source. A future refresh button for Claude can use the same merge without a change.',
    'I did not change the Claude row in this fix. Its readings and its tests are the same as before, so the change stays small and easy to review. The Claude tests did not need an update.']],
  ['Does the bar flicker at the Monday reset?', [
    'It can, for one refresh. Right after the weekly reset, the session reading still holds the total from last week for up to a minute, and it is newer than the manual one.',
    'I now drop any reading whose window started before the current week. The bar goes straight to 0% at the reset and does not show the old total first.',
    'Added a second test that fakes a Monday 00:00 reset. 13 tests pass.',
    'If you want a softer change, the bar can fade between values instead of a jump. That is a CSS-only change in the Monitor panel, and it does not affect the merge.',
    'The reset check uses the start of the week from the usage window, not the local clock, so a time zone change does not move it.']],
  ['Run all the tests.', [
    'All 128 tests pass. Vitest took 4.2 s, and the typecheck is clean.',
    'The two new tests run in the usage suite: one for a newer manual reading and one for the Monday reset. Both use fake timers, so they do not depend on the real clock.',
    'No snapshot changed. The Monitor panel tests still pass with the new merge, because the panel reads only the merged value and never the raw readings.',
    'The end-to-end tests did not run in this pass. They need a live Monitor server, and this fix does not change any request that the panel sends to it.',
    'If you want, I can run them next against the local server before you merge the pull request.']],
  ['Open a PR.', [
    'I opened a pull request on `ray/monitor-pace` with both fixes and the two new tests.',
    'The title is `fix(monitor): keep the newer usage reading`. The body lists the two causes, the two fixes, and the test results.',
    'The description lists the reset edge case, so the reviewer knows why the window check is there. It also links the note on `mergeAgentUsage` for the future Claude refresh.',
    '### Try the reply navigator',
    'Each long reply has a short tick on the thin line at the right edge. The tick for the reply that you read is longer and uses the bubble color. Point at a tick to see the first words of its reply, then click it to jump there. Scroll up and down to see the current tick follow you.']],
];

export function createReplyNavigatorDemo(now = Date.now()): Session {
  const messages: Message[] = turns.flatMap(([ask, paras], index) => [
    { id: `${replyNavigatorDemoId}-ask-${index + 1}`, role: 'user' as const, content: ask },
    { id: `${replyNavigatorDemoId}-reply-${index + 1}`, role: 'assistant' as const, content: paras.join('\n\n') },
  ]).map((message, index, list) => ({ ...message, sentAt: now - (list.length - 1 - index) * 60000 }));
  return {
    id: replyNavigatorDemoId, title: 'Reply navigator · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/workspace', branch: 'ray/monitor-pace', machineId: 'mbp', agent: 'Claude',
    model: 'claude-opus-5', effort: 'high', status: 'idle', unread: false, archived: false,
    createdAt: now, updatedAt: now, additions: 0, deletions: 0, messages,
  };
}
