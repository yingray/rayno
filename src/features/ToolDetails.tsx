import { TODO_MARK, type ToolSection } from '../data/toolResults';
import type { Answer, PermissionSummary } from '../happy/toolDecisions';
import styles from './chat.module.css';

export type ToolOutcome = { permission?: PermissionSummary; answers?: Answer[]; dismissed?: boolean };

const TODO_STATUS: Record<string, string> = { completed: 'Done', in_progress: 'In progress', pending: 'To do' };
const DIFF_CLASS = { add: styles.diffAdded, remove: styles.diffRemoved, hunk: styles.diffHunk, context: undefined };

export function ToolAnswers({ items }: { items: Answer[] }) {
  return <dl className={styles.toolAnswers}>
    {items.map((item, index) => <div key={index}><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}
  </dl>;
}

export function ToolDecision({ value }: { value: PermissionSummary }) {
  return <span className={styles.toolDecision} data-tone={value.tone}>{value.label}</span>;
}

// Notes and lists use div elements, so recap jumps target the whole tool row.
export function ToolSections({ sections }: { sections: ToolSection[] }) {
  return <>{sections.map((section, index) => {
    if (section.kind === 'note') return <div key={index} className={styles.toolNote} data-tone={section.error ? 'error' : undefined}>{section.text}</div>;
    if (section.kind === 'text') return <div key={index}>
      <h4>{section.label}</h4><pre data-tone={section.error ? 'error' : undefined}>{section.text}</pre>
    </div>;
    if (section.kind === 'diff') return <div key={index}>
      <h4>{section.label}</h4>
      <pre aria-label="Tool diff">{section.lines.map((line, lineIndex) =>
        <span key={lineIndex} className={DIFF_CLASS[line.kind]}>{line.text}{'\n'}</span>)}
      {section.more > 0 && <span className={styles.diffHunk}>{`${section.more.toLocaleString('en-US')} more lines are not shown.`}</span>}</pre>
    </div>;
    if (section.kind === 'todos') return <div key={index}>
      <h4>Todo list</h4>
      <div role="list" aria-label="Todo list" className={styles.toolTodos}>
        {section.items.map((todo, todoIndex) => <div role="listitem" key={todoIndex} data-status={todo.status}
          aria-label={`${todo.content}, ${TODO_STATUS[todo.status] || todo.status}`}>
          <span aria-hidden="true">{TODO_MARK[todo.status] || '☐'}</span>{todo.content}
        </div>)}
      </div>
    </div>;
    return <div key={index}><h4>Answers</h4><ToolAnswers items={section.items} /></div>;
  })}</>;
}
