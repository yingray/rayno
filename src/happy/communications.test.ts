import { describe, expect, it } from 'vitest';
import { normalizeSession, pendingCommunications } from './normalize';
import type { Json } from './normalize';

describe('agent communications', () => {
  it('should return answerable forms and unsupported kinds in creation order, as Happy Web does', () => {
    // Arrange
    const state = {
      communications: {
        later: { kind: 'form', createdAt: 30, toolUseId: 'call-2', form: { questions: [
          { id: 'name', header: 'Name', question: 'What name?', allowCustom: true },
          { id: 'silent', header: 'Silent', question: 'Nothing to answer', options: [], allowCustom: false },
        ] } },
        notice: { kind: 'file-pick', createdAt: 10, title: 'Choose a file' },
        empty: { kind: 'form', createdAt: 5, form: { questions: [{ id: 'x', header: 'X', question: 'X?', allowCustom: false }] } },
        done: { kind: 'form', createdAt: 1, form: { questions: [{ id: 'y', header: 'Y', question: 'Y?' }] } },
      },
      completedCommunications: { done: { kind: 'form', status: 'answered', completedAt: 2 } },
    };
    // Act
    const pending = pendingCommunications(state);
    // Assert
    expect(pending).toEqual([
      { id: 'notice', createdAt: 10, kind: 'unsupported', rawKind: 'file-pick', title: 'Choose a file' },
      { id: 'later', createdAt: 30, kind: 'form', questions: [{ id: 'name', header: 'Name', question: 'What name?', allowCustom: true, options: [] }] },
    ]);
  });
  it('should not mark a session blocked by a form with nothing to answer', () => {
    // Arrange
    const source = (agentState: Json) => ({ wire: { id: 's', active: true, createdAt: 1, updatedAt: 1 }, key: null, metadata: {}, agentState });
    const empty = { communications: { q: { kind: 'form', form: { questions: [] } } } };
    const unknown = { communications: { q: { kind: 'diff-review' } } };
    // Act
    const [idle, blocked] = [empty, unknown].map((state) => normalizeSession(source(state), []));
    // Assert
    expect([idle.status, idle.needsReply]).toEqual(['idle', false]);
    expect([blocked.status, blocked.needsReply]).toEqual(['blocked', true]);
  });
});
