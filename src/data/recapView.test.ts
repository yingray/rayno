import { describe, expect, it } from 'vitest';
import { isRecapOnly, recapView } from './recapView';
import { demoRecapReply } from './recapDemo';
import { parseMessageRecap, RECAP_REQUEST } from './messageRecap';
import { hasOpenRecapRequest, unansweredMessageIds } from './replyTurns';
import type { Message } from './types';

const user = (id: string, content: string, recapRequest = false): Message =>
  ({ id, role: 'user', content, ...(recapRequest ? { recapRequest } : {}) });
const agent = (id: string, content: string, tools?: string[]): Message =>
  ({ id, role: 'assistant', content, ...(tools ? { tools } : {}) });
const recap = (body: string) => `<rayno-recap>\n${body}\n</rayno-recap>`;

describe('Recap view', () => {
  it('should show the own recap of a reply and mark the points that have a target', () => {
    // Arrange
    const messages = [
      user('u1', 'Fix the merge'),
      agent('t1', '', ['Run pnpm test']),
      agent('a1', 'The merge kept the old reading.\n\n' + recap('<point quote="kept the old reading">Old reading</point>, <point quote="Run pnpm test">tests</point>, <point quote="missing">gone</point>.')),
    ];
    // Act
    const view = recapView(messages);
    // Assert
    expect(view.hidden.size).toBe(0);
    expect(view.pending).toBeNull();
    expect(view.recaps.get('a1')).toMatchObject({ manual: false, targets: [true, true, false], recap: { text: 'Old reading, tests, gone.' } });
  });

  it('should hide a manual request and its recap-only answer and attach the recap to the reply before it', () => {
    // Arrange
    const messages = [
      user('u1', 'Explain the bug'),
      agent('a1', 'The cache **clears too early**.\n\n' + recap('Old recap.')),
      user('r1', 'Recap', true),
      agent('a2', '\n' + recap('Manual: the cache <point quote="clears too early">clears early</point>.') + '\n'),
    ];
    // Act
    const view = recapView(messages);
    // Assert
    expect([...view.hidden]).toEqual(['r1', 'a2']);
    expect(view.pending).toBeNull();
    expect(view.recaps.get('a1')).toMatchObject({ manual: true, targets: [true], recap: { text: 'Manual: the cache clears early.' } });
    expect(view.recaps.has('a2')).toBe(false);
  });

  it('should report a pending request until an answer arrives and ignore tool-only activity', () => {
    // Arrange
    const messages = [user('u1', 'Hello'), agent('a1', 'Hi there.'), user('r1', 'Recap', true), agent('t1', '', ['Read'])];
    // Act
    const pending = recapView(messages);
    const first = recapView([user('r0', 'Recap', true)]);
    // Assert
    expect(pending.pending).toEqual({ requestId: 'r1', targetId: 'a1' });
    expect([...pending.hidden]).toEqual(['r1']);
    expect(first.pending).toEqual({ requestId: 'r0', targetId: null });
  });

  it('should resolve a request with a normal answer and keep that answer visible', () => {
    // Arrange
    const messages = [
      agent('a1', 'First reply.'),
      user('r1', 'Recap', true),
      agent('a2', 'I cannot recap that.\n\n' + recap('A recap with text around it.')),
      user('r2', 'Recap', true),
      agent('a3', recap('A later manual recap.')),
    ];
    // Act
    const view = recapView(messages);
    // Assert
    expect([...view.hidden]).toEqual(['r1', 'r2', 'a3']);
    expect(view.recaps.get('a2')).toMatchObject({ manual: true, recap: { text: 'A later manual recap.' } });
    expect(view.recaps.has('a1')).toBe(false);
    expect(view.pending).toBeNull();
  });

  it('should keep a recap-only reply visible when no request comes before it', () => {
    // Arrange
    const messages = [user('u1', 'Go'), agent('a1', recap('Done.')), user('r1', 'Recap', true), agent('a2', recap('No target.'))];
    // Act
    const view = recapView([messages[0], messages[1]]);
    const orphan = recapView([messages[2], messages[3]]);
    // Assert
    expect(isRecapOnly(messages[1])).toBe(true);
    expect(isRecapOnly(agent('x', 'Text\n\n' + recap('Done.')))).toBe(false);
    expect(view.hidden.size).toBe(0);
    expect(view.recaps.get('a1')).toMatchObject({ manual: false });
    expect([...orphan.hidden]).toEqual(['r1']);
    expect(orphan.recaps.get('a2')).toMatchObject({ manual: false });
  });
});

describe('Recap view edge cases', () => {
  it('should close a request without an answer when the user sends a real message', () => {
    // Arrange
    const messages = [
      user('u1', 'Fix it'),
      agent('a1', 'Fixed.'),
      user('r1', 'Recap', true),
      user('u2', 'Now fix the test'),
      agent('t1', '', ['Bash']),
    ];
    // Act
    const view = recapView(messages);
    // Assert
    expect(view.pending).toBeNull();
    expect(hasOpenRecapRequest(messages)).toBe(false);
    expect(hasOpenRecapRequest(messages.slice(0, 3))).toBe(true);
  });

  it('should find a quote in the arguments and the result of a tool row', () => {
    // Arrange
    const tools: Message = {
      id: 't1', role: 'assistant', content: '', tools: ['Bash', 'Edit'],
      toolCalls: [
        { id: 'c1', name: 'Bash', input: { command: 'pnpm test' }, result: '12 passed' },
        { id: 'c2', name: 'Edit', input: { old_string: 'const a = 1;\nreturn "old";', new_string: 'return b;' } },
      ],
    };
    const messages = [
      user('u1', 'Run the tests'),
      tools,
      agent('a1', 'All green.\n\n' + recap('<point quote="12 passed">Tests pass</point>, <point quote="pnpm test">ran</point>, <point quote="return &quot;old&quot;;">edit</point>.')),
    ];
    // Act
    const view = recapView(messages);
    // Assert
    expect(view.recaps.get('a1')!.targets).toEqual([true, true, true]);
  });

  it('should match quotes against the GFM text and the Markdown marks of the reply', () => {
    // Arrange
    const reply = '| one | two |\n| --- | --- |\n| three | four |\n\nThis ~~old~~ new step. Fixed in [client.ts](src/happy/client.ts) with *mergeAgentUsage* now.';
    const targets = (quotes: string[]) => {
      const points = quotes.map((quote, index) => `<point quote="${quote}">p${index}</point>`).join(' ');
      return recapView([user('u1', 'Go'), agent('a1', reply + '\n\n' + recap(points))]).recaps.get('a1')!.targets;
    };
    // Act
    const gfm = targets(['| one | two |', 'three', 'old new step']);
    const marks = targets(['Fixed in [client.ts](src/happy/client.ts)', 'with *mergeAgentUsage* now', 'with mergeAgentUsage now']);
    // Assert
    expect(gfm).toEqual([false, true, true]);
    expect(marks).toEqual([true, true, true]);
  });
});

describe('Reply options after a hidden recap request', () => {
  it('should keep the options of the previous reply unanswered', () => {
    // Arrange
    const messages = [
      user('u1', 'Pick one'),
      agent('a1', 'Which?\n\n<options><option>A</option></options>'),
      user('r1', 'Recap', true),
      agent('a2', recap('A question about A.')),
    ];
    // Act
    const unanswered = unansweredMessageIds(messages);
    const answered = unansweredMessageIds([...messages, user('u2', 'A')]);
    // Assert
    expect([...unanswered]).toEqual(['a1', 'r1', 'a2']);
    expect(answered.size).toBe(0);
  });
});

describe('Demo recap answer', () => {
  it('should answer with only a recap block whose quotes target the previous reply', () => {
    // Arrange
    const reply = 'I’ve received your request:\n\n> Make a "plan" & ship <it>\n\nThis is a **simulated response** in the Rayno demo. Your message and this conversation stay in this browser.\n\n- You can explore the **Changes** and **Files** tabs.';
    const messages = [user('u1', 'Hello'), agent('a1', reply), user('r1', 'Recap', true)];
    // Act
    const content = demoRecapReply(messages);
    const view = recapView([...messages, agent('a2', content)]);
    // Assert
    expect(parseMessageRecap(content).map((part) => part.kind)).toEqual(['recap']);
    expect([...view.hidden]).toEqual(['r1', 'a2']);
    expect(view.recaps.get('a1')).toMatchObject({ manual: true, targets: [true, true] });
    expect(view.recaps.get('a1')!.recap.text.length).toBeLessThanOrEqual(200);
    expect(demoRecapReply([user('r1', RECAP_REQUEST, true)])).toBe('<rayno-recap>\nThe previous reply has no text to recap.\n</rayno-recap>');
  });
});
