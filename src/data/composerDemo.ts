import type { Session } from './types';

export const composerDemoId = 'paste-search-demo';
export function createComposerDemo(now = Date.now()): Session[] {
  const session: Session = {
    id: composerDemoId, title: 'PNG paste and session search · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/paste-search', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 0, deletions: 0,
    messages: [{ id: 'paste-search-intro', role: 'assistant', sentAt: now, content:
      '### Try PNG paste and session search\n\nThe message field shares both edges with the conversation. Reply text also lines up with the text inside the draft, including its inner padding. [Change Chat width in Appearance settings](/settings/appearance?demo=1), then return here to compare Full, Moderate, and Standard. On desktop, the reply rail reserves the same space for the conversation and message field.\n\nCopy a PNG or screenshot, focus the message field, then paste with Cmd+V (Ctrl+V on Windows). A thumbnail appears above the text. Open it to preview, remove it with ×, or send the image with or without a message. Use **Try a sample PNG** above the message field if you do not have an image to copy. You can attach the sample again after each send.\n\n[Try paste in a new session](/new?demo=1). The task field accepts the same pasted images.\n\nOpen **Sessions**. Select **Flat** or **Projects**. Projects shows colored labels for group headings, with a session count beside each label. Session items hide their workspace labels in Projects. Each title moves to the first line beside its timestamp, so no empty label row remains. Switch back to Flat to show workspace labels on each item again. Tap the archive icon beside search to show archived sessions; its highlight means the archive is open. Tap it again to return to active sessions. Both choices stay saved independently: open a session, visit Settings, collapse and reopen Sessions, or reload this page to check them. The archive contains “PNG paste · Archived example”. Select the search icon: a search field replaces the Sessions title. Search for “PNG paste”, clear the text to search again, then use × or Escape to close search. Cmd+K also opens search.\n\nImages stay in this browser. Sends and agent replies are simulated; no files reach a live CLI.' }],
  };
  return [session, { ...session, id: 'paste-search-archived-demo', title: 'PNG paste · Archived example',
    project: 'Examples', archived: true, messages: [{ id: 'paste-archived-intro', role: 'assistant', sentAt: now,
      content: 'Use the list and folder icons for Flat and Projects. The highlighted archive icon in the header means archived sessions are visible. Tap it again to return to active sessions and paste or send another image.' }] }];
}

export async function samplePng(): Promise<File> {
  const response = await fetch(new URL('../../docs/images/demo-chat.png', import.meta.url).href);
  if (!response.ok) throw new Error('The sample image could not be loaded. Try again.');
  return new File([await response.blob()], 'sample.png', { type: 'image/png' });
}
