import { memo } from 'react';
import { Icon } from '../components/ui';
import type { Todo } from '../data/todos';
import styles from './taskDock.module.css';

const marks = { completed: 'checkmarkCircle', in_progress: 'radioButtonOnOutline', pending: 'ellipseOutline' } as const;
const states = { completed: 'Done', in_progress: 'In progress', pending: 'Pending' } as const;

// Happy Web components/tools/views/TodoView.tsx: done items are struck through, the current item stands out.
export const TodoList = memo(function TodoList({ todos, label }: { todos: readonly Pick<Todo, 'content' | 'status' | 'id'>[]; label: string }) {
  return (
    <ul className={styles.todoList} aria-label={label}>
      {todos.map((todo, index) => (
        <li key={todo.id || `todo-${index}`} data-status={todo.status}>
          <Icon name={marks[todo.status]} size={15} />
          <span><span className={styles.visuallyHidden}>{states[todo.status]}: </span>{todo.content}</span>
        </li>
      ))}
    </ul>
  );
});
