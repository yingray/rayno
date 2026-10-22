import { Children, Fragment, isValidElement, memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import Markdown from 'react-markdown';
import { Button, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import { formatToolValue, groupChatActivity, toolCount, type ToolActivityBlock } from '../data/chatBlocks';
import { partsForMessage } from '../data/messageOptions';
import { isRejected, unansweredMessageIds } from '../data/replyTurns';
import { recapView, type MessageRecap } from '../data/recapView';
import type { RecapSegment } from '../data/messageRecap';
import { remarkPlugins } from '../data/recapQuote';
import type { BubbleColor, Message, ToolCall, ToolPermission } from '../data/types';
import { toolAnswers, toolSections } from '../data/toolResults';
import { completedForms, completedPermissions, mergedPermission, permissionSummary, toolName, type AnsweredForm, type PermissionSummary } from '../happy/toolDecisions';
import { permissionLabel } from '../happy/permissionOptions';
import { ToolAnswers, ToolDecision, ToolSections, type ToolOutcome } from './ToolDetails';
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
import { isTodoWrite, todoProgress, todoRowList, type Todo } from '../data/todos';

// Thinking is secondary. It stays closed until the user opens it.
function Thinking({ text }: { text: string }) {
  return <details className={styles.thinking}>
    <summary><Icon name="chevronForwardOutline" size={13} />Thinking</summary>
    <p>{text}</p>
  </details>;
}

function SubagentWork({ items }: { items: Message[] }) {
  return <><h4>Subagent</h4>
    <ol className={styles.subagentWork} aria-label="Subagent work">
      {items.map((child) => <li key={child.id}>
        {child.thinking ? <p className={styles.subagentThinking}>{child.thinking}</p> : null}
        {child.tools?.length ? <span><Icon name="codeSlash" size={13} />{child.tools.join(', ')}</span> : null}
        {child.content.trim() ? <pre>{child.content}</pre> : null}
        {child.attachments?.map((file, index) => <span key={index}><Icon name="documentTextOutline" size={13} />{file.name}</span>)}
      </li>)}
    </ol>
  </>;
}

const ToolActivity = memo(function ToolActivity({ block, compactTools, outcomes }: {
  block: ToolActivityBlock; compactTools: boolean; outcomes?: (ToolOutcome | undefined)[];
}) {
  const rowsId = useId();
  const [expanded, setExpanded] = useState(
    !compactTools && window.innerWidth >= 768,
  );
  const count = toolCount(block);
  // Answered questions stay visible in a collapsed group.
  const answered = outcomes?.flatMap((outcome, index) => outcome?.answers?.length || outcome?.dismissed ? [{ index, outcome }] : []) || [];
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
          · {count} {count === 1 ? 'tool' : 'tools'}
        </span>
      </button>
      {answered.length > 0 && <div className={styles.toolAnswered} role="group" aria-label="Answered questions">
        {answered.map(({ index, outcome }) => outcome.answers?.length
          ? <ToolAnswers key={index} items={outcome.answers} />
          : <div key={index} className={styles.toolNote}>The question was dismissed.</div>)}
      </div>}
      <ul className={styles.toolRows} id={rowsId} hidden={!expanded}>
        {block.tools.map((tool, index) => {
          const thinking = block.thinking?.[index], call = block.details?.[index];
          const decision = outcomes?.[index]?.permission, todos = call && todoRowList(call);
          // The answered questions group already shows the answers of this call.
          const sections = !call ? [] : toolSections(call).filter((section) => section.kind !== 'answers' || !outcomes?.[index]?.answers?.length);
          return <li key={index}>
            <Icon name={thinking !== undefined ? 'sparklesOutline' : call?.children?.length ? 'gitNetworkOutline' : call && isTodoWrite(call) ? 'listOutline' : 'codeSlash'} size={14} />
            {thinking !== undefined ? <details className={`${styles.toolDetails} ${styles.thinkingRow}`}>
              <summary>{tool}</summary><p>{thinking}</p>
            </details> : todos ? <TodoTool todos={todos} decision={decision} /> : call && (call.input !== undefined || call.result !== undefined || call.children?.length) ? <details className={styles.toolDetails}>
              <summary><span>{tool}</span>{decision && <ToolDecision value={decision} />}</summary>
              {decision && <div className={styles.toolNote} data-tone={decision.tone === 'denied' ? 'error' : undefined}>{decision.detail}</div>}
              {(call.input !== undefined || call.result !== undefined) && <><h4>Arguments</h4><pre>{formatToolValue(call.input)}</pre></>}
              {!!call.children?.length && <SubagentWork items={call.children} />}
              <ToolSections sections={sections} />
            </details> : <span className={styles.toolLabel}><span>{tool}</span>{decision && <ToolDecision value={decision} />}</span>}
          </li>;
        })}
      </ul>
    </section>
  );
}, (previous, next) => previous.compactTools === next.compactTools
  && previous.block.id === next.block.id && previous.block.duration === next.block.duration
  && previous.block.details === next.block.details
  && previous.block.tools.length === next.block.tools.length
  && previous.block.tools.every((tool, index) => tool === next.block.tools[index])
  && previous.block.thinking?.length === next.block.thinking?.length
  && (previous.block.thinking || []).every((text, index) => text === next.block.thinking![index])
  && JSON.stringify(previous.outcomes) === JSON.stringify(next.outcomes));

// The past permission reply and question answers of one tool call.
function toolOutcome(call: ToolCall | undefined, permissions: Map<string, ToolPermission>, forms: Map<string, AnsweredForm>,
  modeLabel: (mode: string) => string): ToolOutcome | undefined {
  if (!call) return undefined;
  const permission = mergedPermission(call.permission, permissions.get(call.id));
  const form = forms.get(call.id);
  const answers = form?.status === 'answered' ? form.items : toolAnswers(call);
  const outcome: ToolOutcome = {
    ...(permission ? { permission: permissionSummary(call, permission, modeLabel) } : {}),
    ...(answers.length ? { answers } : {}),
    ...(!answers.length && (form?.status === 'cancelled' || (toolName(call) === 'AskUserQuestion' && permission && permission.status !== 'approved'))
      ? { dismissed: true } : {}),
  };
  return Object.keys(outcome).length ? outcome : undefined;
}

// Happy Web TodoView: a TodoWrite call with a list shows it in place of the raw arguments.
function TodoTool({ todos, decision }: { todos: Todo[]; decision?: PermissionSummary }) {
  const progress = todoProgress(todos);
  return <div className={styles.todoTool}>
    <span className={styles.toolLabel}><span>Todo list · {progress.done} of {progress.total} done</span>{decision && <ToolDecision value={decision} />}</span>
    <TodoList label="Todo items" todos={todos} />
  </div>;
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

// Happy Web MessageView.tsx: a queued send shows its state at once. Other sends wait a short grace period.
const PENDING_GRACE_MS = 1000;
function usePendingShown(delivery: Message['delivery']) {
  const delayed = delivery?.status === 'pending' && !delivery.queued ? delivery.since : null;
  const [elapsed, setElapsed] = useState(() => delayed !== null && Date.now() - delayed >= PENDING_GRACE_MS);
  useEffect(() => {
    if (delayed === null) { setElapsed(false); return; }
    const remaining = PENDING_GRACE_MS - (Date.now() - delayed);
    setElapsed(remaining <= 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setElapsed(true), remaining);
    return () => window.clearTimeout(timer);
  }, [delayed]);
  return delivery?.status === 'pending' && (delivery.queued || elapsed);
}

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
  const pendingShown = usePendingShown(message.delivery);
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
      {message.role === 'user' ? (<>
        <div className={styles.bubble} data-pending={pendingShown || undefined}>
          {message.content}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
        </div>
        {pendingShown && message.delivery?.status === 'pending' && <p className={styles.sendState}>
          {message.delivery.queued ? 'Sends after this turn' : 'Sending…'}
        </p>}
        {message.delivery?.status === 'rejected' && <p className={styles.sendState} data-rejected>
          Not sent: {message.delivery.reason}
        </p>}
      </>) : (
        <div className={styles.markdown}>
          {message.thinking && <Thinking text={message.thinking} />}
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
  sessionId = '', messages, disabled, pending, answered, running = false, recapBusy = false, scroll, railHost = null,
  onOption, onRecap, onUnpin,
}: {
  sessionId?: string; messages: Message[]; disabled: boolean; pending: boolean;
  // Options that the user chose in this chat. A held answer does not answer them yet.
  answered?: ReadonlySet<string>;
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
  const { bubble, compactTools, notify, autoplay, agentState, metadata } = useDemo((store) => ({
    bubble: store.state.preferences.bubble, compactTools: store.state.preferences.compactTools,
    notify: store.notify, autoplay: store.state.preferences.recapAutoplay,
    agentState: store.snapshot?.sessionData[sessionId]?.agentState, metadata: store.snapshot?.sessionData[sessionId]?.metadata,
  }));
  const view = useMemo(() => recapView(messages), [messages]);
  const recaps = useStableRecaps(view.recaps);
  const visible = useMemo(() => view.hidden.size ? messages.filter((message) => !view.hidden.has(message.id)) : messages,
    [messages, view]);
  const blocks = useMemo(() => groupChatActivity(visible), [visible]);
  const outcomes = useMemo(() => {
    const permissions = completedPermissions(agentState), forms = completedForms(agentState);
    const modeLabel = (mode: string) => permissionLabel(metadata || {}, mode);
    return new Map(blocks.flatMap((block) => block.kind === 'tools' && block.details
      ? [[block.id, block.details.map((call) => toolOutcome(call, permissions, forms, modeLabel))] as const] : []));
  }, [blocks, agentState, metadata]);
  const unanswered = useMemo(() => unansweredMessageIds(messages), [messages]);
  const writing = !!view.pending && recapBusy;
  const writingTarget = writing ? view.pending!.targetId : undefined;
  const { lastReply, latest, railTarget } = useMemo(() => {
    let lastReply: string | null = null, latest: string | null = null, railTarget: string | null = null;
    let afterUser = true;
    for (let index = visible.length - 1; index >= 0; index--) {
      const message = visible[index];
      if (message.role === 'user') { afterUser &&= isRejected(message); continue; }
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
      ? <ToolActivity key={block.id} block={block} compactTools={compactTools} outcomes={outcomes.get(block.id)} />
      : block.kind === 'thinking'
        ? <article key={block.id} className={styles.agentMessage} data-role="thinking"><Thinking text={block.text} /></article>
        : block.kind === 'event'
        ? <p key={block.id} className={styles.agentEvent} data-role="event">{block.text}</p>
        : <Fragment key={block.id}>
          <MessageBlock sessionId={sessionId} message={block.message}
            bubble={bubble} notify={notify}
            recap={recaps.get(block.message.id)} recapWriting={writingTarget === block.message.id} onJump={jump}
            optionsDisabled={disabled || pending || !unanswered.has(block.message.id) || !!answered?.has(block.message.id)} onOption={onOption} />
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
