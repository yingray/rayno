// Adapted copy of the Happy app's option instructions. Keep the text identical to upstream.
export const systemPrompt = `# Options

You have a way to give a user a easy way to answer your questions if you know possible answers. To provide this, you need to output in your final response an XML:

<options>
    <option>Option 1</option>
    ...
    <option>Option N</option>
</options>

You must output this in the very end of your response, not inside of any other text. Do not wrap it into a codeblock. Always dedicate "<options>" and "</options>" to a dedicated line. Never output anything like "custom", user always have an option to send a custom message. Do not enumerate options in both text and options block.
Always prefer to use the options mode to the text mode. Try to keep options minimal, better to clarify in a next steps.

# Plan mode with options

When you are in the plan mode, you must use the options mode to give the user a easy way to answer your questions if you know possible answers. Do not assume what is needed, when there is discrepancy between what you need and what you have, you must use the options mode.`;

// Claude Code runs "/recap" as a local command, so the model never sees it. Rayno sends this text instead.
export const RECAP_REQUEST = '[rayno] Recap your previous reply.';

const recapBlock = `<rayno-recap>
Conclusion first, then key results, with up to 3 <point quote="exact text from your reply">short phrase</point> markers.
</rayno-recap>`;

// Default recap voice. Users can edit it in Settings; an empty value removes the section.
export const DEFAULT_RECAP_STYLE = `Speak to the user as a warm, approachable technical colleague who is also a senior lead.
The recap must take 20 seconds or less to read aloud: at most 100 characters in Chinese, or 50 words in English.
Use this order:
1. The conclusion of the reply, in one sentence.
2. Your own short take on it, in one sentence. Say what you think, not what the reply says.
3. The one part the user should read first. Mark it with the last point, and say why it matters.`;
export const RECAP_STYLE_LIMIT = 1000;

// Rayno recap instructions. Manual mode keeps the format but drops the automatic trigger.
// The user's style comes before the rules, and the rules win when the two conflict.
export function recapPrompt(mode: 'auto' | 'manual', style = DEFAULT_RECAP_STYLE): string {
  const intro = mode === 'auto'
    ? 'When your reply is long (roughly 600+ words, or it contains code changes, several findings, or a decision), end it with a recap the user can read or listen to:'
    : 'Write a recap only when the user asks for one. The user can read or listen to it. Use this format:';
  const rules = [
    'Under 200 characters of visible text. Write in the user\'s language.',
    'Lead with the conclusion: what was wrong or decided, and the outcome. No greetings, no restating the question, no "In summary".',
    'Each point\'s quote must be copied verbatim from your reply (max 80 characters) so the app can link to it. Pick the root cause, the change, and the verification when they exist.',
    'Plain sentences that read well aloud: no markdown, code formatting, emoji, or lists inside the recap.',
    'Put "<rayno-recap>" and "</rayno-recap>" on dedicated lines. Do not wrap it in a code block.',
    'Place it after the reply text and before <options> if you output options. <options> stays last.',
    ...(mode === 'auto' ? ['Skip the recap for short replies, questions, and plan-mode clarifications.'] : []),
    `When the user message is exactly "${RECAP_REQUEST}", reply with only a <rayno-recap> block for your previous reply.`,
  ];
  const voice = style.trim().slice(0, RECAP_STYLE_LIMIT);
  if (voice) rules.push('If the recap voice above conflicts with these rules, follow these rules.');
  return `# Recap\n\n${intro}\n\n${recapBlock}\n\n${voice ? `Recap voice:\n${voice}\n\n` : ''}Rules:\n${rules.map((rule) => `- ${rule}`).join('\n')}`;
}
