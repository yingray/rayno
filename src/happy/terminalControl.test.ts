import { describe, expect, it } from 'vitest';
import { controlHandoff, normalizeSession, terminalControls } from './normalize';

// Agent states as happy-cli writes them: utils/createSessionMetadata.ts starts at { controlledByUser: false },
// and claude/runClaude.ts sets controlledByUser to (mode === 'local') on start and on every mode change.
const localState = { controlledByUser: true, requests: {} };
const remoteState = { controlledByUser: false, requests: {} };
const claude = { path: '/real/project', flavor: 'claude', startedBy: 'terminal' };
const session = (active: boolean, metadata: object, agentState: object) =>
  normalizeSession({ wire: { id: 'session', active, createdAt: 1, updatedAt: 1 }, metadata, agentState, key: null }, []);

describe('Terminal control', () => {
  it('should mark a connected Claude CLI in local mode as controlled by its terminal', () => {
    // Act / Assert
    expect(terminalControls(claude, localState)).toBe(true);
    expect(session(true, claude, localState).terminalControl).toBe(true);
    expect(session(true, claude, remoteState).terminalControl).toBe(false);
    expect(session(true, claude, {}).terminalControl).toBe(false);
  });
  it('should not mark a disconnected CLI or a Rig session', () => {
    // Act / Assert
    expect(session(false, claude, localState).terminalControl).toBe(false);
    expect(terminalControls({ ...claude, flavor: 'rig', client: { id: 'rig' } }, localState)).toBe(false);
    expect(session(true, { path: '/real/project', client: { id: 'rig' } }, localState).terminalControl).toBe(false);
  });
  it('should detect a handoff in each direction like Happy Web controlHandoff.ts', () => {
    // Act / Assert
    expect(controlHandoff(false, true)).toBe('terminal');
    expect(controlHandoff(undefined, true)).toBe('terminal');
    expect(controlHandoff(true, false)).toBe('app');
    expect(controlHandoff(true, true)).toBeNull();
    expect(controlHandoff(false, false)).toBeNull();
    expect(controlHandoff(undefined, false)).toBeNull();
    expect(controlHandoff(true, undefined)).toBeNull();
  });
});
