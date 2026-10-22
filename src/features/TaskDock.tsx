import { memo, useEffect, useId, useState } from 'react';
import { Button, Dialog, Icon } from '../components/ui';
import { messageError } from '../happy/errors';
import { goalActionParams, goalProgressLabel, type AgentGoal, type GoalAction } from '../happy/agentGoal';
import { todoProgress, type Todo } from '../data/todos';
import { TodoList } from './TodoList';
import styles from './taskDock.module.css';

const actionLabels = { edit: 'Edit goal', clear: 'Clear goal' } as const;
const actionIcons = { edit: 'pencilOutline', clear: 'trashOutline' } as const;

// Happy Web components/AgentGoalBar.tsx above the composer, with the latest todo progress beside it.
export const TaskDock = memo(function TaskDock({ goal, todos, disabled, onGoalAction }: {
  goal: AgentGoal | null;
  todos: readonly Todo[];
  // No connection to the agent. The goal stays readable, and its actions wait.
  disabled: boolean;
  onGoalAction: (params: { action: GoalAction; objective?: string }) => Promise<void>;
}) {
  const [dialog, setDialog] = useState<'goal' | 'edit' | 'todos' | null>(null);
  const [busy, setBusy] = useState<GoalAction | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const fieldId = useId();
  const progress = todoProgress(todos);
  const showTodos = progress.total > 0 && progress.done < progress.total;
  const goalProgress = goal ? goalProgressLabel(goal.progress) : '';
  useEffect(() => {
    if (!goal && (dialog === 'goal' || dialog === 'edit')) setDialog(null);
    if (!showTodos && dialog === 'todos') setDialog(null);
  }, [goal, showTodos, dialog]);
  useEffect(() => { if (!goal) setError(''); }, [goal]);
  if (!goal && !showTodos) return null;

  async function run(action: GoalAction, next?: string) {
    if (!goal || busy || disabled) return;
    const params = goalActionParams(action, goal.text, next);
    if (!params) { setDialog(null); return; }
    setBusy(action);
    setError('');
    try {
      await onGoalAction(params);
      setDialog(null);
    } catch (error) {
      setError(messageError(error));
    } finally {
      setBusy(null);
    }
  }
  function choose(action: GoalAction) {
    if (action === 'edit') { setDraft(goal!.text); setError(''); setDialog('edit'); }
    else void run(action);
  }
  const actionButtons = (inline: boolean) => goal?.actions.map(action => (
    <Button key={action} className={inline ? styles.action : styles.dialogAction} icon={actionIcons[action]}
      aria-label={inline ? actionLabels[action] : undefined} title={actionLabels[action]}
      disabled={disabled || !!busy} onClick={() => choose(action)}>
      {inline ? undefined : actionLabels[action]}
    </Button>
  ));
  const todoLabel = `${progress.done} of ${progress.total} tasks done`;
  const status = busy && <p className={styles.status} role="status">Wait for the agent to confirm the goal change…</p>;
  const alert = error && <p className={styles.error} role="alert">{error}</p>;

  return (
    <>
      <div className={styles.dock} role="group" aria-label="Session progress">
        {goal && (
          <button type="button" className={styles.goal} aria-label={`Current goal${goalProgress ? `, ${goalProgress}` : ''}: ${goal.text}`} title={goal.text}
            onClick={() => setDialog('goal')}>
            <Icon name="locateOutline" size={16} />
            <span className={styles.goalText}>
              <small>Current goal{goalProgress ? ` · ${goalProgress}` : ''}</small>
              <strong>{goal.text}</strong>
            </span>
          </button>
        )}
        {showTodos && (
          <button type="button" className={styles.todos} data-wide={!goal} aria-label={`Todo list: ${todoLabel}`}
            onClick={() => setDialog('todos')}>
            <Icon name="listOutline" size={15} />
            <b>{progress.done}/{progress.total}</b>
            {!goal && <span>{progress.current ? progress.current.content : 'Tasks'}</span>}
          </button>
        )}
        {actionButtons(true)}
      </div>
      {!dialog && status}
      {!dialog && alert}
      {dialog === 'goal' && goal && (
        <Dialog className={styles.dialog} title="Current goal" onClose={() => setDialog(null)}>
          <p className={styles.fullGoal}>{goal.text}</p>
          {goalProgress && <p className={styles.meta}>{goalProgress}</p>}
          {goal.progress?.steps && (
            <TodoList label="Goal steps" todos={goal.progress.steps.map(step => ({ content: step.text, status: step.status }))} />
          )}
          {disabled && goal.actions.length > 0 && <p className={styles.meta}>Connect to the agent to change this goal.</p>}
          {status}
          {alert}
          {goal.actions.length > 0 && <footer>{actionButtons(false)}</footer>}
        </Dialog>
      )}
      {dialog === 'edit' && goal && (
        <Dialog className={styles.dialog} title="Edit goal" onClose={() => { if (!busy) setDialog(null); }}>
          <form className={styles.editForm} onSubmit={(event) => { event.preventDefault(); void run('edit', draft); }}>
            <label htmlFor={fieldId}>Goal</label>
            <textarea id={fieldId} data-escape-local rows={4} value={draft} disabled={!!busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) { event.stopPropagation(); setDialog(null); }
              }} />
            <p className={styles.meta}>The agent receives the new goal. It replaces the current goal.</p>
            {status}
            {alert}
            <footer>
              <Button disabled={!!busy} onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="accent" disabled={!!busy || disabled || !draft.trim()}>
                {busy === 'edit' ? 'Saving…' : 'Save'}
              </Button>
            </footer>
          </form>
        </Dialog>
      )}
      {dialog === 'todos' && (
        <Dialog className={styles.dialog} title="Todo list" onClose={() => setDialog(null)}>
          <p className={styles.meta}>{todoLabel}</p>
          <TodoList label="Todo items" todos={todos} />
        </Dialog>
      )}
    </>
  );
});
