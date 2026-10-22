import { Children, Fragment, isValidElement, memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import Markdown from 'react-markdown';
import { Button, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import { formatToolValue, groupChatActivity, type ToolActivityBlock } from '../data/chatBlocks';
import { partsForMessage } from '../data/messageOptions';
import { unansweredMessageIds } from '../data/replyTurns';
import { recapView, type MessageRecap } from '../data/recapView';
import type { RecapSegment } from '../data/messageRecap';
import { remarkPlugins } from '../data/recapQuote';
import type { BubbleColor, Message } from '../data/types';
import { useEventCallback } from '../components/useEventCallback';
import styles from './chat.module.css';
import { RecapButton, RecapCard } from './RecapCard';
import { RecapRail } from './RecapRail';
import { findRecapTarget, jumpToRecapTarget } from './recapTargets';
import {
  hasUserGesture, playRecapSpeech, recapSpeechState, selectRecapPoint, speechSupported, toggleRecapSpeech,
} from './recapSpeech';
import { MermaidDiagram } from './MermaidDiagram';
import { AttachmentImage } from './AttachmentImage';
import { CodeBlock } from './CodeBlock';
import { TodoList } from './TodoList';
import { isTodoWrite, todoProgress, toolTodos } from '../data/todos';
import type { ToolCall } from '../data/types';

const ToolActivity = memo(function ToolActivity({ block, compactTools }: { block: ToolActivityBlock; compactTools: boolean }) {
  const rowsId = useId();
  const [expanded, setExpanded] = useState(
    !compactTools && window.innerWidth >= 768,
  );
  return (
    <section className={styles.toolGroup} aria-label="Tool activity">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={rowsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon name={expanded ? 'chevronDown' : 'chevronForwardOutline'} size={13} />
        {block.duration ? `Worked for ${block.duration}` : 'Tool activity'}
        <span>
          · {block.tools.length} {block.tools.length === 1 ? 'tool' : 'tools'}
        </span>
      </button>
      <ul className={styles.toolRows} id={rowsId} hidden={!expanded}>
        {block.tools.map((tool, index) => (
          <li key={index}>
            <Icon name={block.details?.[index] && isTodoWrite(block.details[index]!) ? 'listOutline' : 'codeSlash'} size={14} />
            {block.details?.[index] && isTodoWrite(block.details[index]!) ? <TodoTool call={block.details[index]!} /> : block.details?.[index] && (block.details[index]!.input !== undefined || block.details[index]!.result !== undefined) ? <details className={styles.toolDetails}>
              <summary>{tool}</summary>
              <h4>Arguments</h4><pre>{formatToolValue(block.details[index]!.input)}</pre>
              <ToolDiff input={block.details[index]!.input} />
              <h4>{block.details[index]!.isError ? 'Error' : 'Result'}</h4>
              <pre>{block.details[index]!.result === undefined ? 'No result reported yet.' : formatToolValue(block.details[index]!.result)}</pre>
            </details> : <span>{tool}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}, (previous, next) => previous.compactTools === next.compactTools
  && previous.block.id === next.block.id && previous.block.duration === next.block.duration
  && previous.block.details === next.block.details
  && previous.block.tools.length === next.block.tools.length
  && previous.block.tools.every((tool, index) => tool === next.block.tools[index]));

// Happy Web TodoView: the TodoWrite call shows its list in place of the raw arguments.
function TodoTool({ call }: { call: ToolCall }) {
  const todos = toolTodos(call);
  const progress = todoProgress(todos);
  return <div className={styles.todoTool}>
    <span>Todo list{todos.length ? ` · ${progress.done} of ${progress.total} done` : ''}{call.isError ? ' · Error' : ''}</span>
    {todos.length > 0 && <TodoList label="Todo items" todos={todos} />}
  </div>;
}

function ToolDiff({ input }: { input: unknown }) {
  if (!input || typeof input !== 'object') return null;
  const edit = input as Record<string, unknown>;
  if (typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  return <><h4>Changes</h4><pre aria-label="Tool diff">
    <span className={styles.diffRemoved}>{edit.old_string.split('\n').map(line => `- ${line}`).join('\n')}</span>{'\n'}
    <span className={styles.diffAdded}>{edit.new_string.split('\n').map(line => `+ ${line}`).join('\n')}</span>
  </pre></>;
}

const RenderedMarkdown = memo(function RenderedMarkdown({ content, codeFilename, notify }: {
  content: string; codeFilename: string; notify: (message: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      components={{
        a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        table: ({ children }) => (
          <div
            className={styles.tableScroll}
            role="region"
            aria-label="Markdown table"
            tabIndex={0}
          >
            <table>{children}</table>
          </div>
        ),
        th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
        pre: ({ children }) => {
          const code = Children.toArray(children)[0];
          if (isValidElement<{ className?: string; children?: ReactNode }>(code)
            && /\blanguage-mermaid\b/i.test(code.props.className || '')) {
            return <MermaidDiagram source={String(code.props.children || '').replace(/\n$/, '')} notify={notify} />;
          }
          if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return <pre>{children}</pre>;
          const language = /\blanguage-([\w+-]+)/i.exec(code.props.className || '')?.[1].toLowerCase() || '';
          return <CodeBlock source={String(code.props.children || '')} language={language} filename={codeFilename} notify={notify} />;
        },
      }}
    >
      {content}
    </Markdown>
  );
});

const MessageBlock = memo(function MessageBlock({ sessionId, message, optionsDisabled, onOption, bubble, notify, recap, recapWriting, onJump }: {
  sessionId: string;
  message: Message;
  optionsDisabled: boolean;
  onOption: (messageId: string, text: string) => void;
  bubble: BubbleColor;
  notify: (message: string) => void;
  recap?: MessageRecap;
  recapWriting: boolean;
  onJump: (messageId: string, index: number) => void;
}) {
  const parts = partsForMessage(message);
  const codeFilename = message.content.match(/\/\* ([\w./-]+) \*\//)?.[1] || 'Code';
  // The recap card closes the reply. Options stay last.
  const card = message.role !== 'user' && (recap || recapWriting)
    ? <RecapCard key="recap" messageId={message.id} value={recap} writing={recapWriting} onJump={onJump} notify={notify} />
    : null;
  const optionsAt = card ? parts.findIndex((part) => part.kind === 'options') : -1;
  return (
    <article
      className={message.role === 'user' ? styles.userMessage : styles.agentMessage}
      data-bubble={bubble}
      data-message-id={message.id}
      data-role={message.role}
    >
      {message.role === 'user' ? (
        <div className={styles.bubble}>
          {message.content}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
        </div>
      ) : (
        <div className={styles.markdown}>
          {parts.map((part, index) => [index === optionsAt && card, part.kind === 'recap' ? null : part.kind === 'options' ? (
            <div className={styles.replyOptions} role="group" aria-label="Reply options" key={index}>
              {part.items.map((item, optionIndex) => (
                <Button
                  key={optionIndex}
                  disabled={optionsDisabled}
                  onClick={() => onOption(message.id, item)}
                  icon="arrowUp"
                >
                  {item}
                </Button>
              ))}
            </div>
          ) : (
            <RenderedMarkdown key={index} content={part.content} codeFilename={codeFilename} notify={notify} />
          )])}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
          {optionsAt === -1 && card}
        </div>
      )}
    </article>
  );
});

const sameTargets = (a: boolean[], b: boolean[]) => a.length === b.length && a.every((value, index) => value === b[index]);
// Keep the previous recap object when nothing changed, so memoized messages do not render again.
function useStableRecaps(next: Map<string, MessageRecap>) {
  const previous = useRef(new Map<string, MessageRecap>());
  return useMemo(() => {
    const stable = new Map<string, MessageRecap>();
    for (const [id, value] of next) {
      const old = previous.current.get(id);
      stable.set(id, old && old.manual === value.manual && old.sourceId === value.sourceId && sameTargets(old.targets, value.targets)
        && old.recap.text === value.recap.text
        && JSON.stringify(old.recap.segments) === JSON.stringify(value.recap.segments) ? old : value);
    }
    previous.current = stable;
    return stable;
  }, [next]);
}

const recapKey = (id: string, value: MessageRecap) => `${id}\n${value.recap.text}`;
const isPoint = (index: number) => (segment: RecapSegment): segment is Extract<RecapSegment, { kind: 'point' }> =>
  segment.kind === 'point' && segment.index === index;

export const MessageList = memo(function MessageList({
  sessionId = '', messages, disabled, pending, running = false, recapBusy = false, scroll, railHost = null,
  onOption, onRecap, onUnpin,
}: {
  sessionId?: string; messages: Message[]; disabled: boolean; pending: boolean;
  // The agent works now. The recap button waits for the end of the reply.
  running?: boolean;
  // A manual recap request is on its way or the agent answers it now.
  recapBusy?: boolean;
  scroll?: RefObject<HTMLDivElement | null>;
  railHost?: HTMLElement | null;
  onOption: (messageId: string, text: string) => void;
  onRecap?: () => unknown;
  onUnpin?: () => void;
}) {
  const { bubble, compactTools, notify, autoplay } = useDemo((store) => ({
    bubble: store.state.preferences.bubble, compactTools: store.state.preferences.compactTools,
    notify: store.notify, autoplay: store.state.preferences.recapAutoplay,
  }));
  const view = useMemo(() => recapView(messages), [messages]);
  const recaps = useStableRecaps(view.recaps);
  const visible = useMemo(() => view.hidden.size ? messages.filter((message) => !view.hidden.has(message.id)) : messages,
    [messages, view]);
  const blocks = useMemo(() => groupChatActivity(visible), [visible]);
  const unanswered = useMemo(() => unansweredMessageIds(messages), [messages]);
  const writing = !!view.pending && recapBusy;
  const writingTarget = writing ? view.pending!.targetId : undefined;
  const { lastReply, latest, railTarget } = useMemo(() => {
    let lastReply: string | null = null, latest: string | null = null, railTarget: string | null = null;
    let afterUser = true;
    for (let index = visible.length - 1; index >= 0; index--) {
      const message = visible[index];
      if (message.role === 'user') { afterUser = false; continue; }
      if (afterUser && !lastReply && (message.content.trim() || message.attachments?.length)) lastReply = message.id;
      const value = recaps.get(message.id);
      if (value && !latest) latest = message.id;
      if (value?.targets.some(Boolean) && !railTarget) railTarget = message.id;
      if (latest && railTarget && (lastReply || !afterUser)) break;
    }
    return { lastReply, latest, railTarget };
  }, [visible, recaps]);

  const jump = useEventCallback((messageId: string, index: number) => {
    selectRecapPoint(messageId, index);
    const element = scroll?.current;
    const point = recaps.get(messageId)?.recap.segments.find(isPoint(index));
    const target = element && point ? findRecapTarget(element, messageId, point.quote) : null;
    if (!element || !target) return;
    onUnpin?.();
    jumpToRecapTarget(element, target);
  });

  // Option+R reads the latest recap in this session, or pauses it.
  const readLatest = useEventCallback((event: KeyboardEvent) => {
    if (!event.altKey || event.code !== 'KeyR' || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const value = latest ? recaps.get(latest) : undefined;
    if (!latest || !value || !speechSupported()) return;
    event.preventDefault();
    if (!event.repeat) toggleRecapSpeech(latest, value.recap);
  });
  useEffect(() => {
    window.addEventListener('keydown', readLatest);
    return () => window.removeEventListener('keydown', readLatest);
  }, [readLatest]);

  // Autoplay reads only a recap that arrives while this chat is open, after the agent worked.
  // tail is the last message ID at the previous check. A recap in an older history page comes before it.
  const seen = useRef<{ sessionId: string; keys: Set<string>; worked: boolean; tail: string | null } | null>(null);
  useEffect(() => {
    const keys = [...recaps].map(([id, value]) => recapKey(id, value));
    const tail = messages.at(-1)?.id ?? null;
    if (seen.current?.sessionId !== sessionId) {
      seen.current = { sessionId, keys: new Set(keys), worked: running || recapBusy, tail };
      return;
    }
    const current = seen.current;
    const value = latest ? recaps.get(latest) : undefined;
    // The tail message itself counts, because its text can change to add a recap.
    const tailIndex = current.tail === null ? 0 : messages.findIndex((message) => message.id === current.tail);
    const appended = !!value && tailIndex !== -1
      && messages.findIndex((message) => message.id === value.sourceId) >= tailIndex;
    current.tail = tail;
    const fresh = !!latest && !!value && appended && !current.keys.has(recapKey(latest, value));
    keys.forEach((key) => current.keys.add(key));
    const worked = current.worked;
    current.worked = running || recapBusy || (worked && !fresh);
    if (!fresh || !worked || !autoplay || !hasUserGesture() || !speechSupported()) return;
    if (recapSpeechState().status === 'idle') playRecapSpeech(latest!, value!.recap);
  }, [sessionId, messages, recaps, latest, running, recapBusy, autoplay]);

  const placeholder = writingTarget === null || (writingTarget && !visible.some((message) => message.id === writingTarget));
  const showButton = !!onRecap && !!lastReply && !recaps.has(lastReply) && !writing && !running;
  return <>
    {blocks.map((block) => block.kind === 'tools'
      ? <ToolActivity key={block.id} block={block} compactTools={compactTools} />
      : <Fragment key={block.id}>
          <MessageBlock sessionId={sessionId} message={block.message}
            bubble={bubble} notify={notify}
            recap={recaps.get(block.message.id)} recapWriting={writingTarget === block.message.id} onJump={jump}
            optionsDisabled={disabled || pending || !unanswered.has(block.message.id)} onOption={onOption} />
          {showButton && block.message.id === lastReply
            && <RecapButton disabled={disabled || pending} onClick={() => void onRecap!()} />}
        </Fragment>)}
    {placeholder && (
      <article className={styles.agentMessage}>
        <div className={styles.markdown}>
          <RecapCard messageId="" writing onJump={jump} notify={notify} />
        </div>
      </article>
    )}
    {railTarget && scroll && railHost && (
      <RecapRail host={railHost} scroll={scroll} messageId={railTarget} value={recaps.get(railTarget)!} onJump={jump} />
    )}
  </>;
});
