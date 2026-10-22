import { useCallback, useRef, useState } from 'react';
import { Button, Dialog } from '../components/ui';
import { useDemo } from '../data/store';
import { messageError } from '../happy/errors';
import styles from './sessionPrompts.module.css';

type CleanupPrompt = { id: string; path: string; action: () => Promise<void> | void; resolve: (done: boolean) => void };

/**
 * Happy Web hooks/useWorktreeCleanup.ts: before an archive or a delete, offer to delete a clean worktree.
 * guard resolves true after the action runs, or false when the user closes the prompt.
 * The prompt shows action errors, because it replaces the dialog or menu that started the action.
 */
export function useWorktreeCleanup() {
  const live = useDemo((store) => store.live);
  const [prompt, setPrompt] = useState<CleanupPrompt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const guard = useCallback(async (id: string, action: () => Promise<void> | void) => {
    const path = live ? await live.worktreeCleanup(id) : '';
    if (!path) {
      await action();
      return true;
    }
    return new Promise<boolean>((resolve) => { setError(''); setPrompt({ id, path, action, resolve }); });
  }, [live]);
  async function answer(remove: boolean) {
    if (!prompt || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      // Like Happy Web, a failed removal keeps the files and does not stop the archive or delete.
      if (remove) await live?.removeWorktree(prompt.id, prompt.path).catch(() => undefined);
      await prompt.action();
      setPrompt(null);
      prompt.resolve(true);
    } catch (error) {
      setError(messageError(error));
    } finally {
      pending.current = false; setBusy(false);
    }
  }
  function cancel() {
    if (!prompt || pending.current) return;
    setPrompt(null);
    prompt.resolve(false);
  }
  const dialog = prompt && <Dialog title="Delete this worktree?" className={styles.prompt} onClose={cancel}>
    <p>The worktree has no uncommitted changes. Delete the worktree files too?</p>
    <code className={styles.path}>{prompt.path}</code>
    {error && <p role="alert">{error}</p>}
    <footer>
      <Button disabled={busy} onClick={() => void answer(false)}>Keep files</Button>
      <Button variant="danger" icon="trashOutline" disabled={busy} onClick={() => void answer(true)}>
        {busy ? 'Wait…' : 'Delete worktree'}
      </Button>
    </footer>
  </Dialog>;
  return { guard, prompting: !!prompt, dialog };
}
