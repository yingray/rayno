import { LanguageContext, useText } from "../i18n";
import { Children, Fragment, isValidElement, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { Button, copyText, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import { formatToolValue, groupChatActivity, toolCount, type ChatBlock, type ToolActivityBlock } from '../data/chatBlocks';
import { partsForMessage } from '../data/messageOptions';
import { commandInvocation, skillInvocation } from '../data/invocations';
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
import { ResponseRail } from './RecapRail';
import { responseAnchors } from '../data/responseAnchors';
import { findRecapTarget, jumpToRecapTarget } from './recapTargets';
import {
  hasUserGesture, playRecapSpeech, recapSpeechState, selectRecapPoint, speechSupported, toggleRecapSpeech,
} from './recapSpeech';
import { MermaidDiagram } from './MermaidDiagram';
import { AttachmentImage } from './AttachmentImage';
import { LocalImage } from './LocalImage';
import { isLocalImageLink, isLocalImageSource } from '../happy/localImages';
import { CodeBlock } from './CodeBlock';
import { TodoList } from './TodoList';
import { InlineToolQuestion, questionCallIds } from '../happy/Requests';
import { timeStage } from '../happy/perf';
import { reuseEqual } from '../data/reuseEqual';
import { isTodoWrite, todoProgress, todoRowList, type Todo } from '../data/todos';
import { createTranscriptMemory, parseTranscriptAnchor, recapTargetBlock, recapTurnGroups, type TranscriptAnchor, type TranscriptMemory } from '../data/transcript';
import { TranscriptViewport, type TranscriptController } from './TranscriptViewport';

// Thinking is secondary. It stays closed until the user opens it.
function Thinking({ text, memory, stateKey }: { text: string; memory?: TranscriptMemory; stateKey?: string }) {
  const t = useText();
  return <details className={styles.thinking} open={memory && stateKey ? !!memory.details.get(stateKey) : undefined}
    onToggle={event => { if (memory && stateKey) memory.details.set(stateKey, event.currentTarget.open); }}>
    <summary><Icon name="chevronForwardOutline" size={13} />{t("Thinking")}</summary>
    <p>{text}</p>
  </details>;
}

function SubagentWork({ items }: { items: Message[] }) {
  const t = useText();
  return <><h4>{t("Subagent")}</h4>
    <ol className={styles.subagentWork} aria-label={t("Subagent work")}>
      {items.map((child) => <li key={child.id}>
        {child.thinking ? <p className={styles.subagentThinking}>{child.thinking}</p> : null}
        {child.tools?.length ? <span><Icon name="codeSlash" size={13} />{child.tools.join(', ')}</span> : null}
        {child.content.trim() ? <pre>{child.content}</pre> : null}
        {child.attachments?.map((file, index) => <span key={index}><Icon name="documentTextOutline" size={13} />{file.name}</span>)}
      </li>)}
    </ol>
  </>;
}

// A closed tool row mounts its content on the first open. `reveal` mounts it while the row stays closed,
// so a recap jump can find text in it.
function ToolRowDetails({ summary, reveal, children, memory, stateKey }: {
  summary: ReactNode; reveal: boolean; children: () => ReactNode; memory: TranscriptMemory; stateKey: string;
}) {
  const open = !!memory.details.get(stateKey);
  const [mounted, setMounted] = useState(reveal || open);
  if (reveal && !mounted) setMounted(true);
  // The click comes before the default toggle, so the content is there when the row opens.
  return <details className={styles.toolDetails} data-tool-call={stateKey} open={open} onToggle={(event) => {
    memory.details.set(stateKey, event.currentTarget.open);
    if (event.currentTarget.open) setMounted(true);
  }}>
    <summary onClick={() => setMounted(true)}>{summary}</summary>
    {mounted && children()}
  </details>;
}

const ToolActivity = memo(function ToolActivity({ block, compactTools, outcomes, questions, reveal = false, sessionId, memory }: {
  block: ToolActivityBlock; compactTools: boolean; outcomes?: (ToolOutcome | undefined)[];
  questions?: string[]; reveal?: boolean; sessionId: string; memory: TranscriptMemory;
}) {
  const t = useText();
  const rowsId = useId();
  const [expanded, setExpanded] = useState(
    memory.groups.get(block.id) ?? (!compactTools && window.innerWidth >= 768),
  );
  // A collapsed group mounts its rows on the first expand, then keeps them.
  const [rowsMounted, setRowsMounted] = useState(expanded || reveal);
  if ((expanded || reveal) && !rowsMounted) setRowsMounted(true);
  const count = toolCount(block);
  // Answered questions stay visible in a collapsed group.
  const answered = outcomes?.flatMap((outcome, index) => outcome?.answers?.length || outcome?.dismissed ? [{ index, outcome }] : []) || [];
  return (
    <section className={styles.toolGroup} aria-label={t("Tool activity")} data-tool-activity data-tool-block={block.id}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={rowsId}
        onClick={() => setExpanded((value) => { memory.groups.set(block.id, !value); return !value; })}
      >
        <Icon name={expanded ? "chevronDown" : "chevronForwardOutline"} size={13} />
        {block.duration ? `Worked for ${block.duration}` : t("Tool activity")}
        <span>
          · {count} {count === 1 ? t("tool") : t("tools")}
        </span>
      </button>
      {block.details?.some(call => skillInvocation(call)) && <div className={styles.skillInvocations}>
        {block.details.map((call, index) => {
          const skill = skillInvocation(call);
          return skill && <span className={styles.invocation} data-invocation="skill" key={call?.id || index}>
            <Icon name="sparklesOutline" size={14} /><strong>Skill</strong><code>{skill}</code>
          </span>;
        })}
      </div>}
      {answered.length > 0 && <div className={styles.toolAnswered} role="group" aria-label={t("Answered questions")}>
        {answered.map(({ index, outcome }) => outcome.answers?.length
          ? <ToolAnswers key={index} items={outcome.answers} />
          : <div key={index} className={styles.toolNote}>{t("The question was dismissed.")}</div>)}
      </div>}
      {questions && block.details?.map(call => call && questions.includes(call.id)
        && <InlineToolQuestion key={call.id} sessionId={sessionId} call={call} />)}
      <ul className={styles.toolRows} id={rowsId} hidden={!expanded}>
        {rowsMounted && block.tools.map((tool, index) => {
          const thinking = block.thinking?.[index], call = block.details?.[index];
          const decision = outcomes?.[index]?.permission, todos = call && todoRowList(call);
          const skill = skillInvocation(call), label = skill ? `Skill · ${skill}` : tool;
          // The answered questions group already shows the answers of this call.
          const sections = !call ? [] : toolSections(call).filter((section) => section.kind !== 'answers' || !outcomes?.[index]?.answers?.length);
          return <li key={index}>
            <Icon name={thinking !== undefined ? "sparklesOutline" : call?.children?.length ? "gitNetworkOutline" : call && isTodoWrite(call) ? "listOutline" : "codeSlash"} size={14} />
            {thinking !== undefined ? <details className={`${styles.toolDetails} ${styles.thinkingRow}`}
              open={!!memory.details.get(`${block.id}:thinking:${index}`)}
              onToggle={event => memory.details.set(`${block.id}:thinking:${index}`, event.currentTarget.open)}>
              <summary>{tool}</summary><p>{thinking}</p>
            </details> : todos ? <TodoTool todos={todos} decision={decision} /> : call && (call.input !== undefined || call.result !== undefined || call.children?.length) ? <ToolRowDetails
              memory={memory} stateKey={call.id} reveal={reveal} summary={<><span>{label}</span>{decision && <ToolDecision value={decision} />}</>}>{() => <>
              {decision && <div className={styles.toolNote} data-tone={decision.tone === 'denied' ? "error" : undefined}>{decision.detail}</div>}
              {(call.input !== undefined || call.result !== undefined) && <><h4>{t("Arguments")}</h4><pre>{formatToolValue(call.input)}</pre></>}
              {!!call.children?.length && <SubagentWork items={call.children} />}
              <ToolSections sections={sections} />
            </>}</ToolRowDetails> : <span className={styles.toolLabel}><span>{tool}</span>{decision && <ToolDecision value={decision} />}</span>}
          </li>;
        })}
      </ul>
    </section>
  );
}, (previous, next) => previous.sessionId === next.sessionId && previous.compactTools === next.compactTools
  && previous.reveal === next.reveal && previous.block.id === next.block.id && previous.block.duration === next.block.duration
  && previous.block.details === next.block.details
  && previous.block.tools.length === next.block.tools.length
  && previous.block.tools.every((tool, index) => tool === next.block.tools[index])
  && previous.block.thinking?.length === next.block.thinking?.length
  && (previous.block.thinking || []).every((text, index) => text === next.block.thinking![index])
  && previous.questions?.join() === next.questions?.join()
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
  const t = useText();
  const progress = todoProgress(todos);
  return <div className={styles.todoTool}>
    <span className={styles.toolLabel}><span>{t("Todo list ·")}{' '}{progress.done}{' '}{t("of")}{' '}{progress.total}{' '}{t("done")}</span>{decision && <ToolDecision value={decision} />}</span>
    <TodoList label={t("Todo items")} todos={todos} />
  </div>;
}

const RenderedMarkdown = memo(function RenderedMarkdown({ content, codeFilename, notify, sessionId, messageId }: {
  content: string; codeFilename: string; notify: (message: string) => void;
  sessionId: string; messageId: string;
}) {
  const t = useText();
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      urlTransform={(url, key) => (key === 'src' && isLocalImageSource(url)) || (key === 'href' && isLocalImageLink(url))
        ? url : defaultUrlTransform(url)}
      components={{
        a: ({ node: _node, ...props }) => props.href && isLocalImageLink(props.href)
          ? <LocalImage sessionId={sessionId} messageId={messageId} source={props.href} alt={typeof props.children === 'string' ? props.children : undefined} />
          : <a {...props} target="_blank" rel="noreferrer noopener" />,
        img: ({ node: _node, ...props }) => typeof props.src === 'string' && isLocalImageSource(props.src)
          ? <LocalImage sessionId={sessionId} messageId={messageId} source={props.src} alt={props.alt} />
          : props.src ? <img {...props} loading="lazy" /> : <span>{t('Image unavailable')}</span>,
        table: ({ children }) => (
          <div
            className={styles.tableScroll}
            data-markdown-table
            role="region"
            aria-label={t("Markdown table")}
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

function ResponseHeader({ sentAt }: { sentAt?: number }) {
  const t = useText();
  const language = useContext(LanguageContext);
  const date = sentAt === undefined ? null : new Date(sentAt);
  const valid = date && Number.isFinite(date.getTime());
  return <div className={styles.responseHeader} data-response-header>
    <span role="separator" />
    {valid ? <time dateTime={date.toISOString()} title={date.toLocaleString(language, { timeZoneName: 'short' })}>
      {date.toLocaleString(language === 'en' ? 'en-GB' : language, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      })}
    </time> : <span>{t('Time unavailable')}</span>}
  </div>;
}

const MessageBlock = memo(function MessageBlock({ sessionId, message, response, optionsDisabled, onOption, bubble, notify, recap, recapWriting, onJump, memory }: {
  sessionId: string;
  memory: TranscriptMemory;
  message: Message;
  response: boolean;
  optionsDisabled: boolean;
  onOption: (messageId: string, text: string) => void;
  bubble: BubbleColor;
  notify: (message: string) => void;
  recap?: MessageRecap;
  recapWriting: boolean;
  onJump: (messageId: string, index: number) => void;
}) {
  const t = useText();
  const pendingShown = usePendingShown(message.delivery);
  const command = message.role === 'user' ? commandInvocation(message.content) : null;
  const parts = partsForMessage(message);
  const codeFilename = message.content.match(/\/\* ([\w./-]+) \*\//)?.[1] || 'Code';
  // The recap card closes the reply. Options stay last.
  const card = message.role !== 'user' && (recap || recapWriting)
    ? <RecapCard key="recap" messageId={message.id} value={recap} writing={recapWriting} onJump={onJump} notify={notify} />
    : null;
  const optionsAt = card ? parts.findIndex((part) => part.kind === 'options') : -1;
  const canCopy = message.role === 'assistant' && parts.some((part) =>
    part.kind === 'options' || part.kind === 'markdown' && !!part.content.trim());
  function copyResponse() {
    const text = parts.flatMap((part) => part.kind === 'markdown' && part.content.trim() ? [part.content.trim()]
      : part.kind === 'options' ? [part.items.map((item) => `- ${item}`).join('\n')] : []).join('\n\n');
    void copyText(text, notify);
  }
  return (
    <article
      className={message.role === 'user' ? styles.userMessage : styles.agentMessage}
      data-bubble={bubble}
      data-message-id={message.id}
      data-role={message.role}
    >
      {response && <ResponseHeader sentAt={message.sentAt} />}
      {message.role === 'user' ? (<>
        <div className={command ? styles.commandMessage : styles.bubble} data-pending={pendingShown || undefined}>
          {command ? <><span className={styles.invocation} data-invocation="command">
            <Icon name="codeSlash" size={14} /><strong>Command</strong><code>{command.name}</code>
          </span>{command.args && <div>{command.args}</div>}{command.remainder && <div>{command.remainder}</div>}</> : message.content}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
        </div>
        {pendingShown && message.delivery?.status === 'pending' && <p className={styles.sendState}>
          {message.delivery.queued ? t("Sends after this turn") : t("Sending…")}
        </p>}
        {message.delivery?.status === 'rejected' && <p className={styles.sendState} data-rejected>{t("Not sent:")}{' '}{message.delivery.reason}
        </p>}
      </>) : (
        <div className={styles.markdown}>
          {message.thinking && <Thinking text={message.thinking} memory={memory} stateKey={`thinking:${message.id}`} />}
          {message.unplaced ? <><p className={styles.toolNote}>{t("Earlier context is unavailable. Load earlier messages to place this work.")}</p>
            <RenderedMarkdown sessionId={sessionId} messageId={message.id} content={message.content} codeFilename={codeFilename} notify={notify} /></> : parts.map((part, index) => [index === optionsAt && card, part.kind === 'recap' ? null : part.kind === 'options' ? (
            <div className={styles.replyOptions} role="group" aria-label={t("Reply options")} data-reply-options key={index}>
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
            <RenderedMarkdown key={index} sessionId={sessionId} messageId={message.id} content={part.content} codeFilename={codeFilename} notify={notify} />
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
      {canCopy && <div className={styles.responseActions}>
        <button type="button" className={styles.copyResponse} aria-label={t("Copy response")} title={t("Copy response")} onClick={copyResponse}>
          <Icon name="copyOutline" size={15} />
        </button>
      </div>}
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
  onOption, onRecap, onUnpin, pinned, viewport, onVirtualMode, onManaged, onPinned,
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
  pinned: RefObject<boolean>;
  viewport: RefObject<TranscriptController | null>;
  onVirtualMode: (enabled: boolean) => void;
  onManaged: (enabled: boolean) => void;
  onPinned: (pinned: boolean) => void;
}) {
  const { bubble, compactTools, faster, font, notify, autoplay, agentState, metadata, ui, live, language, historyReady } = useDemo((store) => ({
    bubble: store.state.preferences.bubble, compactTools: store.state.preferences.compactTools,
    faster: store.state.preferences.fasterTranscript, font: store.state.preferences.fontSize, language: store.state.preferences.language,
    ui: store.ui, live: store.live,
    historyReady: !store.live || !!store.snapshot?.histories[sessionId]?.loaded,
    notify: store.notify, autoplay: store.state.preferences.recapAutoplay,
    agentState: store.snapshot?.sessionData[sessionId]?.agentState, metadata: store.snapshot?.sessionData[sessionId]?.metadata,
  }));
  const memory = useMemo(() => {
    let value = ui.transcripts.get(sessionId);
    if (!value) {
      value = createTranscriptMemory();
      try { if (!live) value.anchor = parseTranscriptAnchor(localStorage.getItem(`rayno.demo.transcript.${sessionId}`)); }
      catch { /* Reading position stays in memory when storage is unavailable. */ }
      ui.transcripts.set(sessionId, value);
    }
    return value;
  }, [ui, live, sessionId]);
  const full = !faster;
  const [positionReady, setPositionReady] = useState(!live || !!memory.loaded);
  useEffect(() => {
    if (!live || memory.loaded) { setPositionReady(true); return; }
    let active = true;
    void live.readTranscriptPosition(sessionId).then(raw => {
      if (!active) return;
      if (!memory.anchor) memory.anchor = parseTranscriptAnchor(raw);
      memory.loaded = true;
      setPositionReady(true);
    });
    return () => { active = false; };
  }, [live, memory, sessionId]);
  const persist = useEventCallback((anchor: TranscriptAnchor) => {
    try {
      if (live) live.saveTranscriptPosition(sessionId, JSON.stringify(anchor));
      else localStorage.setItem(`rayno.demo.transcript.${sessionId}`, JSON.stringify(anchor));
    } catch { /* Keep the position for this account visit. */ }
  });
  const view = useMemo(() => recapView(messages), [messages]);
  const recaps = useStableRecaps(view.recaps);
  const visible = useMemo(() => view.hidden.size ? messages.filter((message) => !view.hidden.has(message.id)) : messages,
    [messages, view]);
  // Grouping builds new blocks and `details` lists. Keep the unchanged ones, so ToolActivity can skip its render.
  const previousBlocks = useRef<ReturnType<typeof groupChatActivity>>(undefined);
  const blocks = useMemo(() => timeStage('group-chat-activity', () => {
    const next = reuseEqual(previousBlocks.current, groupChatActivity(visible));
    previousBlocks.current = next;
    return next;
  }), [visible]);
  const available = blocks.length >= 300;
  const virtual = available && faster;
  // Every chat uses a message anchor. The row count only controls virtualization.
  useLayoutEffect(() => { onManaged(true); return () => onManaged(false); }, [onManaged]);
  const outcomes = useMemo(() => {
    const permissions = completedPermissions(agentState), forms = completedForms(agentState);
    const modeLabel = (mode: string) => permissionLabel(metadata || {}, mode);
    return new Map(blocks.flatMap((block) => block.kind === 'tools' && block.details
      ? [[block.id, block.details.map((call) => toolOutcome(call, permissions, forms, modeLabel))] as const] : []));
  }, [blocks, agentState, metadata]);
  // Only a call with an open question mounts an InlineToolQuestion, so the store subscribers do not grow with the tools.
  const questions = useMemo(() => {
    const ids = questionCallIds(agentState);
    return new Map(ids.size ? blocks.flatMap((block) => {
      const calls = block.kind === 'tools' ? block.details?.flatMap((call) => call && ids.has(call.id) ? [call.id] : []) : undefined;
      return calls?.length ? [[block.id, calls] as const] : [];
    }) : []);
  }, [blocks, agentState]);
  const anchors = useMemo(() => responseAnchors(visible), [visible]);
  const responseIds = useMemo(() => new Set(anchors.map(anchor => anchor.id)), [anchors]);
  const unanswered = useMemo(() => unansweredMessageIds(messages), [messages]);
  const writing = !!view.pending && recapBusy;
  const writingTarget = writing ? view.pending!.targetId : undefined;
  const { lastReply, latest } = useMemo(() => {
    let lastReply: string | null = null, latest: string | null = null;
    let afterUser = true;
    for (let index = visible.length - 1; index >= 0; index--) {
      const message = visible[index];
      if (message.role === 'user') { afterUser &&= isRejected(message); continue; }
      if (afterUser && !lastReply && !message.unplaced && (message.content.trim() || message.attachments?.length)) lastReply = message.id;
      const value = recaps.get(message.id);
      if (value && !latest) latest = message.id;
      if (latest && (lastReply || !afterUser)) break;
    }
    return { lastReply, latest };
  }, [visible, recaps]);

  // Tool groups whose closed rows are mounted for a recap jump. A jump that finds no target in the DOM
  // reveals the tool groups of its turn, then looks again after that render.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const jump = useEventCallback(async (messageId: string, index: number) => {
    selectRecapPoint(messageId, index);
    const point = recaps.get(messageId)?.recap.segments.find(isPoint(index));
    if (!point) return;
    const groups = recapTurnGroups(blocks, messageId);
    const existing = scroll?.current && findRecapTarget(scroll.current, messageId, point.quote, groups);
    if (!virtual && existing && scroll?.current) {
      onUnpin?.(); jumpToRecapTarget(scroll.current, existing, available ? 'auto' : undefined, () => viewport.current?.capture()); return;
    }
    const id = recapTargetBlock(blocks, messageId, point.quote);
    if (virtual && !id) return;
    setRevealed(previous => new Set([...previous, ...groups]));
    onUnpin?.();
    if (id && viewport.current) await viewport.current.mount(id);
    else await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const element = scroll?.current;
    const target = element ? findRecapTarget(element, messageId, point.quote, groups) : null;
    if (element && target) jumpToRecapTarget(element, target, available ? 'auto' : undefined, () => viewport.current?.capture());
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
  const renderBlock = (block: ChatBlock) => block.kind === 'tools'
      ? <ToolActivity key={block.id} block={block} sessionId={sessionId} compactTools={compactTools} outcomes={outcomes.get(block.id)} memory={memory}
        questions={questions.get(block.id)} reveal={revealed.has(block.id)} />
      : block.kind === 'thinking'
        ? <article key={block.id} className={styles.agentMessage} data-role="thinking"><Thinking text={block.text} memory={memory} stateKey={block.id} /></article>
        : block.kind === 'event'
        ? <p key={block.id} className={styles.agentEvent} data-role="event">{block.text}</p>
        : <Fragment key={block.id}>
          <MessageBlock sessionId={sessionId} memory={memory} message={block.message} response={responseIds.has(block.message.id)}
            bubble={bubble} notify={notify}
            recap={recaps.get(block.message.id)} recapWriting={writingTarget === block.message.id} onJump={jump}
            optionsDisabled={disabled || pending || !unanswered.has(block.message.id) || !!answered?.has(block.message.id)} onOption={onOption} />
          {showButton && block.message.id === lastReply
            && <RecapButton disabled={disabled || pending} onClick={() => void onRecap!()} />}
        </Fragment>;
  return <>
    <TranscriptViewport blocks={blocks} enabled={virtual} full={full} scroll={scroll} pinned={pinned}
      controller={viewport} memory={memory} ready={positionReady && historyReady} layoutKey={`${font}:${compactTools}:${language}`}
      render={renderBlock} onMode={onVirtualMode} onPinned={onPinned} persist={persist} />
    {placeholder && (
      <article className={styles.agentMessage}>
        <div className={styles.markdown}>
          <RecapCard messageId="" writing onJump={jump} notify={notify} />
        </div>
      </article>
    )}
    {scroll && railHost && <ResponseRail host={railHost} scroll={scroll} replies={anchors} onJump={() => onUnpin?.()} viewport={viewport} virtual={virtual} />}
  </>;
});
