import { describe, expect, it } from 'vitest';
import { defaultNewDraft } from '../data/fixtures';
import { buildHandoffDraft, buildHandoffPrompt, defaultHandoffAgent, handoffRequestPrompt, handoffTranscriptPath } from './handoff';

describe('Session handoff', () => {
  it('should preserve a Claude checkout and point the Codex draft at its transcript', () => {
    // Arrange
    const source = { sessionId: 'old-happy', title: 'Fix login', flavor: 'claude', machineId: 'source-computer',
      path: '/Users/dev/code/project', homeDir: '/Users/dev', claudeSessionId: 'claude-123' };
    // Act
    const draft = buildHandoffDraft(source, { ...defaultNewDraft, effort: 'max', prompt: 'old task' })!;
    // Assert
    expect(draft).toMatchObject({ machineId: 'source-computer', path: '~/code/project',
      type: 'Simple', worktree: '', agent: 'Codex', model: '', effort: null, prompt: '' });
    expect(draft.handoff).toMatchObject({ sessionId: 'old-happy', title: 'Fix login' });
    expect(draft.handoff!.prompt).toContain('Happy session `old-happy` (Claude Code, in `~/code/project`).');
    expect(draft.handoff!.prompt).toContain('`~/.claude/projects/*/claude-123.jsonl`');
  });

  it('should keep the exact Codex worktree path and select Claude', () => {
    // Arrange
    const source = { sessionId: 'old-codex', flavor: 'codex', machineId: 'computer',
      path: '/real/project/.dev/worktree/review', codexThreadId: 'thread-123' };
    // Act
    const draft = buildHandoffDraft(source, defaultNewDraft)!;
    // Assert
    expect(draft).toMatchObject({ path: '/real/project', type: 'Worktree',
      worktree: '/real/project/.dev/worktree/review', agent: 'Claude' });
    expect(draft.handoff).toMatchObject({ title: 'old-codex' });
    expect(draft.handoff!.prompt).toContain('~/.codex/sessions/*/*/*/rollout-*-thread-123.jsonl');
    expect(draft.handoff!.prompt).toContain('in `/real/project/.dev/worktree/review`');
  });

  it('should ask for context when a transcript is unknown and keep the current agent choice', () => {
    // Arrange
    const source = { sessionId: 'other', flavor: 'gemini', machineId: 'computer', path: '/Users/dev-other/repo', homeDir: '/Users/dev' };
    // Act
    const draft = buildHandoffDraft(source, { ...defaultNewDraft, agent: 'Happy Agent' })!;
    // Assert
    expect(draft.agent).toBe('Happy Agent');
    expect(draft.path).toBe('/Users/dev-other/repo');
    expect(draft.handoff!.prompt).toContain('(Gemini,');
    expect(draft.handoff!.prompt).toContain('Ask me for the context that you need.');
    expect(draft.handoff!.prompt).not.toContain('Read the transcript');
    expect(handoffTranscriptPath(source)).toBeNull();
    expect(defaultHandoffAgent('gemini')).toBeNull();
    expect(buildHandoffPrompt({ sessionId: 'unknown' })).toContain('(another agent)');
  });

  it('should require the source computer and folder before preparing a handoff', () => {
    // Arrange / Act / Assert
    expect(buildHandoffDraft({ sessionId: 'missing', machineId: 'computer', path: ' ' }, defaultNewDraft)).toBeNull();
    expect(buildHandoffDraft({ sessionId: 'missing', path: '/real/project' }, defaultNewDraft)).toBeNull();
  });

  it('should send the hidden context before the task that the user typed', () => {
    // Arrange
    const handoff = { sessionId: 'old', title: 'Fix login', prompt: 'Continue the work.' };
    // Act / Assert
    expect(handoffRequestPrompt('Run the tests.', handoff)).toBe('Continue the work.\n\nRun the tests.');
    expect(handoffRequestPrompt('  ', handoff)).toBe('Continue the work.');
    expect(handoffRequestPrompt('Run the tests.', null)).toBe('Run the tests.');
  });
});
