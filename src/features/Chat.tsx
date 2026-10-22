import { lazy, memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, copyText, Dialog, Empty, Icon, Spinner } from '../components/ui';
import { WorkspaceTag } from '../components/WorkspaceTag';
import { useDemo } from '../data/store';
import { modelOptions, effortOptions, effortLabel, canSelectModel } from '../happy/modelOptions';
import { currentPermission, pendingCommunications, pendingPermissions, type Json } from '../happy/normalize';
import { permissionOptions, permissionLabel, canSelectPermission } from '../happy/permissionOptions';
import { messageError } from '../happy/errors';
import { titleOf } from '../data/reducer';
import { latestAgentMode, latestSentModes, modelChoiceKey, rankSessionModes, resolveModelChoice, type SentModes, type SessionModes } from '../happy/modelPreferences';
import { OfflineStatus } from '../components/OfflineStatus';
import type { Attachment, MessageSettings, Session } from '../data/types';
import { countOpenSideChats, showSideChatEntry, SIDE_CHAT_TITLE, sideChatTitle } from '../data/sideChats';
import styles from './chat.module.css';
import { LazyBoundary } from '../components/LazyBoundary';
import { useEventCallback } from '../components/useEventCallback';
import { DraftComposer } from './DraftComposer';
import { ContextMeter, ContextWarning } from './ContextMeter';
import { selectedImages } from '../happy/attachments';
import { ResumeSession } from './ResumeSession';
import { ChatSessionMenu } from './ChatSessionMenu';
import { needsSessionResume } from '../happy/resume';
import { ChatHistoryStatus } from './ChatHistoryStatus';
import { questionDemoId } from '../data/questionDemo';
import { hasAgentReply, hasOpenRecapRequest, isRejected, unansweredMessageIds } from '../data/replyTurns';
import { stopRecapSpeech } from './recapSpeech';
import { TaskDock } from './TaskDock';
import { visibleGoal, type GoalAction } from '../happy/agentGoal';
import { latestTodos } from '../data/todos';

const MessageList = lazy(() => import('./MessageList').then((module) => ({ default: module.MessageList })));
const Requests = lazy(() => import('../happy/Requests').then((module) => ({ default: module.Requests })));
const DemoQuestions = lazy(() => import('./DemoQuestions').then((module) => ({ default: module.DemoQuestions })));
const WorkspaceFiles = lazy(() => import('../happy/WorkspaceFiles').then((module) => ({ default: module.WorkspaceFiles })));

const scrollPositions = new Map<string, number>();
const sampleCode = `export function Panel({ children }: PanelProps) {\n  return (\n    <section className={styles.panel}>\n      {children}\n    </section>\n  );\n}`;
const sampleFiles: Record<string, string> = {
  'src/app/App.tsx': `import { Panel } from '../components/Panel';\n\nexport function App() {\n  return <Panel>Welcome to your workspace.</Panel>;\n}`,
  'src/app/app.module.css': `.shell {\n  height: 100dvh;\n  display: flex;\n  gap: 10px;\n  padding: 10px;\n}`,
  'src/styles/tokens.css': `:root {\n  --panel-radius: 24px;\n  --panel-gap: 10px;\n  --accent: #8b5cf6;\n}`,
  'src/components/Panel.tsx': sampleCode,
  'README.md':
    '# Floating Panels\n\nA quiet space for your agents.\n\nThese files are read-only examples in the local demo.',
};
const files = Object.keys(sampleFiles);

function hasAgentRequests(state: Json = {}) {
  return pendingPermissions(state).length > 0 || pendingCommunications(state).length > 0;
}

export const Chat = memo(function Chat({
  session,
  onInfo,
  onList,
  embedded = false,
  onSettings,
}: {
  session: Session;
  onInfo: () => void;
  onList: () => void;
  /** A side chat inside its parent's panel. The panel owns the header. */
  embedded?: boolean;
  onSettings?: (sessionId: string, settings: MessageSettings) => void;
}) {
  const { preferences, savedChoice, liveMetadata, agentState, dispatch, adapter, notify, mode, live, history, connection, offline, sideChats, parentKnown, sideEntry, sideTitle } = useDemo((store) => ({
    // A side chat whose parent is gone returns to the session list.
    parentKnown: !!session.parentSessionId && store.state.sessions.some((item) => item.id === session.parentSessionId),
    sideChats: session.isSideChat || embedded ? 0 : countOpenSideChats(store.state.sessions, session.id),
    sideEntry: !embedded && showSideChatEntry(store.state.sessions, session, store.live),
    sideTitle: embedded || !session.isSideChat ? undefined : sideChatTitle(store.state.sessions, session.id),
    preferences: store.state.preferences,
    savedChoice: store.state.modelChoices?.[modelChoiceKey(session.agent, session.machineId)],
    liveMetadata: store.snapshot?.sessionData[session.id]?.metadata,
    agentState: store.snapshot?.sessionData[session.id]?.agentState,
    dispatch: store.dispatch, adapter: store.adapter, notify: store.notify,
    mode: store.mode, live: store.live, history: store.snapshot?.histories[session.id],
    connection: store.snapshot?.connection, offline: store.snapshot?.offline,
  }));
  const hasRequests = useMemo(() => !!live && hasAgentRequests(agentState), [live, agentState]);
  // Let input interrupt reconciliation of a large live history.
  const renderedMessages = useDeferredValue(session.messages);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const answeredOptions = useRef(new Set<string>());
  // A held Happy Agent answer does not answer its options yet. Keep the chosen options disabled until a rejection.
  const [answeredIds, setAnsweredIds] = useState<ReadonlySet<string>>(() => new Set());
  const metadata: Json = useMemo(() => mode === 'live' ? liveMetadata || {}
    : { flavor: session.agent === 'Happy Agent' ? 'rig' : session.agent.toLowerCase() }, [mode, liveMetadata, session.agent]);
  const location = useLocation();
  const navigate = useNavigate();
  const modesKey = `composerModes.${session.id}`;
  const [savedModes, setSavedModes] = useState<SessionModes | null>(() => {
    try {
      return JSON.parse((live ? live.readLocal(modesKey) : localStorage.getItem(`rayno.demo.${modesKey}`)) || 'null');
    } catch { return null; }
  });
  const inheritedPermission = currentPermission(metadata);
  const loadedModes = useMemo(() => latestSentModes(session.messages), [session.messages]);
  const [olderModes, setOlderModes] = useState<SentModes>();
  const historyLoaded = !!history?.loaded;
  useEffect(() => {
    if (!live || !historyLoaded || loadedModes) return;
    let active = true;
    live.findSentModes(session.id).then((value) => { if (active) setOlderModes(value); })
      .catch(() => { /* Fall back to the reported modes. */ });
    return () => { active = false; };
  }, [live, historyLoaded, !!loadedModes, session.id]);
  const sentModes = loadedModes && (!olderModes || loadedModes.sentAt >= olderModes.sentAt) ? loadedModes : olderModes;
  const agentMode = useMemo(() => latestAgentMode(session.messages, agentState || {}, metadata),
    [session.messages, agentState, metadata]);
  const ranked = useMemo(() => rankSessionModes(savedModes, sentModes, inheritedPermission, agentMode),
    [savedModes, sentModes, inheritedPermission, agentMode]);
  const preferenceKey = modelChoiceKey(session.agent, session.machineId);
  const selection = useMemo(() => resolveModelChoice(metadata, [
    ...ranked.modelCandidates,
    { model: session.model, effort: session.effort || session.model.split(' · ')[1]?.toLowerCase() || null },
    ranked.legacy, savedChoice,
  ]), [metadata, ranked, session.model, session.effort, savedChoice]);
  const { model, effort: selectedEffort } = selection;
  const models = useMemo(() => modelOptions(metadata), [metadata]);
  const efforts = useMemo(() => effortOptions(metadata, model), [metadata, model]);
  const modelLabel = models.find((option) => option.value === model)?.label || model || 'No model available';
  // A reported agent mode outranks a value that an older build saved without a pick.
  const permission = ranked.permission !== undefined ? ranked.permission
    : !inheritedPermission && typeof ranked.legacy?.permission === 'string' ? ranked.legacy.permission
      : mode === 'demo' ? 'default' : null;
  const permissionSelectable = canSelectPermission(metadata);
  const selectedPermission = permissionSelectable ? permission : null;
  const effectivePermission = selectedPermission || inheritedPermission;
  const permissionName = permissionLabel(metadata, effectivePermission);
  const permissions = useMemo(() => permissionOptions(metadata, effectivePermission), [metadata, effectivePermission]);
  const [picker, setPicker] = useState<'model' | 'permission' | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [composerHeight, setComposerHeight] = useState(160);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(files[0]);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  // True from a sent recap request until the agent starts on it.
  const [awaitingRecap, setAwaitingRecap] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const conversationId = useId();
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  const sideOpen = location.pathname === `/session/${session.id}/side`;
  const parentId = session.isSideChat && parentKnown ? session.parentSessionId : undefined;
  const view = embedded ? 'chat' : location.pathname.endsWith('/changes')
    ? 'changes'
    : location.pathname.endsWith('/files')
      ? 'files'
      : 'chat';
  const running = session.status === 'running';
  const settingTiming = running
    ? 'Applies to your next message. The current response keeps its settings. To switch now, stop it, then send a new instruction.'
    : 'Applies to your next message.';
  const disabled =
    !model || session.archived ||
    session.status === 'offline' ||
    (mode === 'live' && connection !== 'connected');
  const unansweredMessages = useMemo(() => unansweredMessageIds(session.messages), [session.messages]);
  const rejections = useMemo(() => session.messages.filter(isRejected).length, [session.messages]);
  useEffect(() => {
    if (!rejections || !answeredOptions.current.size) return;
    answeredOptions.current.clear();
    setAnsweredIds(new Set());
  }, [rejections]);
  const openRecap = useMemo(() => hasOpenRecapRequest(session.messages), [session.messages]);
  const canRecap = useMemo(() => hasAgentReply(session.messages), [session.messages]);
  // An open request without a working agent stays open. The user can then ask again.
  const recapBusy = openRecap && (running || pending || awaitingRecap);
  const messageSettings = useMemo(() => mode === 'live'
    ? {
        model,
        effort: efforts.length ? selectedEffort : undefined,
        permissionMode: selectedPermission || undefined,
      }
    : {}, [mode, model, efforts.length, selectedEffort, selectedPermission]);
  useEffect(() => { onSettings?.(session.id, messageSettings); }, [onSettings, session.id, messageSettings]);

  // Save only explicit picks. A value saved on every render would outrank the modes of later messages.
  function pickModes(value: Omit<SessionModes, 'at' | 'agentCall'>) {
    const next = { model, effort: selectedEffort, permission: selectedPermission, ...value, at: Date.now(), agentCall: agentMode?.call };
    setSavedModes(next);
    try {
      const json = JSON.stringify(next);
      if (live) live.writeLocal(modesKey, json);
      else localStorage.setItem(`rayno.demo.${modesKey}`, json);
    } catch { /* Keep the selection for this visit if storage is unavailable. */ }
  }
  function rememberChoice(value: typeof selection) {
    pickModes(value);
    if (value.model) dispatch({ type: 'rememberModel', key: preferenceKey, value });
  }
  function chooseModel(value: string) {
    rememberChoice(resolveModelChoice(metadata, [{ model: value, effort: selectedEffort }]));
  }
  function chooseEffort(value: string) {
    rememberChoice(resolveModelChoice(metadata, [{ model, effort: value }]));
  }

  function updateScrollPosition(element: HTMLDivElement) {
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
    setAwayFromLatest(!pinned.current);
    scrollPositions.set(session.id, element.scrollTop);
    live?.setSessionReading(session.id, pinned.current);
  }

  function scrollToLatest() {
    const element = scroll.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    updateScrollPosition(element);
  }

  useLayoutEffect(() => {
    if (!scroll.current || !scrollContent.current || view !== 'chat') return;
    const element = scroll.current;
    element.scrollTop = scrollPositions.get(session.id) ?? element.scrollHeight;
    updateScrollPosition(element);
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (pinned.current) element.scrollTop = element.scrollHeight;
        updateScrollPosition(element);
      });
    });
    observer.observe(element);
    observer.observe(scrollContent.current);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      live?.setSessionReading(session.id, false);
      scrollPositions.set(session.id, element.scrollTop);
    };
  }, [session.id, view, live]);
  useLayoutEffect(() => {
    if (!scroll.current) return;
    if (pinned.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    updateScrollPosition(scroll.current);
  }, [session.messages.length, composerHeight, keyboardInset, keyboardOpen, running]);
  useEffect(() => {
    if (!composer.current) return;
    let frame: number | undefined;
    const observer = new ResizeObserver((entries) => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      const height = entries[0].contentRect.height;
      frame = requestAnimationFrame(() => { frame = undefined; setComposerHeight(height); });
    });
    observer.observe(composer.current);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [view]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const unscaled = viewport && Math.abs(viewport.scale - 1) < 0.01;
      const inset = unscaled
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      setKeyboardInset(inset > 80 ? inset : 0);
      // iOS can pan the layout viewport instead of reporting a bottom inset.
      const focused = document.activeElement?.matches('input, textarea, select');
      setKeyboardOpen(!!(focused && unscaled &&
        Math.max(inset, document.documentElement.clientHeight - viewport.height) > 80));
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  useEffect(() => {
    if (!awaitingRecap) return;
    if (running || !openRecap) { setAwaitingRecap(false); return; }
    const timer = window.setTimeout(() => setAwaitingRecap(false), 15000);
    return () => clearTimeout(timer);
  }, [awaitingRecap, running, openRecap]);
  // Leave the session, and the voice stops.
  useEffect(() => () => stopRecapSpeech(), [session.id]);
  useEffect(() => {
    if (!preview || !preview.type.startsWith('image/')) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  function addImages(files: File[]) {
    if (pendingRef.current) return;
    try { setAttachments(mode === 'live' ? selectedImages(files, attachments) : [...attachments, ...files].slice(0, 5)); setError(''); }
    catch (error) { setError(messageError(error)); }
  }
  async function send(value: string, dismissKeyboard = false) {
    if (pendingRef.current || disabled || (!value.trim() && !attachments.length)) return;
    pendingRef.current = true;
    if (dismissKeyboard) input.current?.blur();
    setPending(true);
    setError('');
    try {
      pinned.current = true;
      await adapter.sendMessage(
        session.id,
        value,
        attachments.map((file): Attachment => ({ name: file.name, size: file.size, type: file.type, ...(mode === 'live' ? { file } : {}) })),
        messageSettings,
      );
      setAttachments([]);
      if (!dismissKeyboard) input.current?.focus();
    } catch (error) {
      setError(messageError(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function stop() {
    if (stoppingRef.current || disabled || !running) return;
    stoppingRef.current = true;
    setStopping(true);
    setError('');
    try {
      await adapter.stopSession(session.id);
    } catch (error) {
      setError(messageError(error));
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }
  const sendOption = useCallback(async (messageId: string, text: string) => {
    if (
      pendingRef.current || disabled ||
      answeredOptions.current.has(messageId) || !unansweredMessages.has(messageId)
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    pinned.current = true;
    try {
      await adapter.sendMessage(session.id, text, [], { ...messageSettings, preserveDraft: true });
      answeredOptions.current.add(messageId);
      setAnsweredIds(new Set(answeredOptions.current));
    } catch (error) {
      setError(messageError(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [adapter, disabled, session.id, messageSettings, unansweredMessages]);
  const chooseReply = useEventCallback(sendOption);
  const requestRecap = useEventCallback(async () => {
    if (pendingRef.current || disabled || running || !canRecap || recapBusy) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      await adapter.sendRecapRequest(session.id, messageSettings);
      setAwaitingRecap(true);
    } catch (error) {
      setError(messageError(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  });
  const unpin = useCallback(() => { pinned.current = false; }, []);
  const goal = useMemo(() => mode === 'live' ? visibleGoal(agentState, liveMetadata, session.status !== 'offline') : null,
    [mode, agentState, liveMetadata, session.status]);
  const todos = useMemo(() => session.archived ? [] : latestTodos(session.messages), [session.archived, session.messages]);
  const goalAction = useCallback(async (params: { action: GoalAction; objective?: string }) => {
    if (!live) throw new Error('Connect to Happy before you change the goal.');
    await live.goalAction(session.id, params);
  }, [live, session.id]);

  return (
    <section
      className={styles.chat}
      data-view={view}
      data-chat-width={preferences.chatWidth}
      data-connection={mode === 'live' ? connection : undefined}
      data-keyboard-open={keyboardOpen}
      data-embedded={embedded || undefined}
      aria-label={embedded ? 'Side chat conversation' : 'Chat session'}
    >
      {!embedded && <header className={styles.header}>
        <Button
          className={`${styles.back} ${parentId ? styles.parentBack : ''}`}
          icon="arrowBack"
          aria-label={parentId ? 'Back to parent chat' : 'Back to sessions'}
          title={parentId ? 'Back to parent chat' : undefined}
          onClick={() => parentId ? navigate(`/session/${parentId}/side`, { state: { sideChat: session.id } }) : navigate('/sessions')}
        />
        <Button
          className={styles.listButton}
          variant="ghost"
          icon="codeSlash"
          aria-label="Open session list"
          onClick={onList}
        />
        <button className={styles.titleCapsule} onClick={onInfo} aria-label="Open session info">
          <Avatar agent={session.agent} size={36} />
          <span className={styles.titleText}>
            <strong>{sideTitle || titleOf(session)}</strong>
            <span className={styles.subtitle}>
              {session.isSideChat && titleOf(session) !== SIDE_CHAT_TITLE && <span className={styles.sideTag}>Side chat</span>}
              <WorkspaceTag name={session.workspace} small />
              <span className={styles.branch}>
                <Icon name="gitBranchOutline" size={12} />
                {session.branch}
              </span>
              {(mode === 'demo' || session.gitReported) && (
                <span className={styles.diff}>
                  <i>+{session.additions}</i>
                  <b>−{session.deletions}</b>
                </span>
              )}
            </span>
          </span>
        </button>
        <Button
          className={styles.infoButton}
          icon="informationCircleOutline"
          aria-label="Toggle session info"
          onClick={onInfo}
        />
        {sideEntry && (
          <Button
            className={styles.sideChatsButton}
            icon="chatbubblesOutline"
            aria-label={sideChats ? `Side chats, ${sideChats} open` : 'Side chats'}
            aria-expanded={sideOpen}
            title="Side chats"
            onClick={() => navigate(sideOpen ? `/session/${session.id}` : `/session/${session.id}/side`)}
          >{sideChats ? <span className={styles.sideChatsCount}>{sideChats}</span> : null}</Button>
        )}
        <ChatSessionMenu session={session} settings={messageSettings} />
      </header>}
      <OfflineStatus label={embedded ? 'Side chat availability' : 'Conversation availability'} />
      {view === 'chat' ? (
        <>
          <div
            id={conversationId}
            role="region"
            aria-label="Conversation messages"
            className={styles.messageScroll}
            // Focus and scrollIntoView keep a control above the composer that overlays the bottom of the list.
            style={{ scrollPaddingBottom: `${composerHeight + keyboardInset}px` }}
            ref={scroll}
            onScroll={(event) => updateScrollPosition(event.currentTarget)}
            onPointerDownCapture={(event) => {
              if (event.target instanceof Element && event.target.closest('[aria-label="Tool activity"]'))
                pinned.current = false;
            }}
            onKeyDownCapture={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
                && event.target.closest('[aria-label="Tool activity"]')) pinned.current = false;
            }}
          >
            <div className={styles.messages} ref={scrollContent} data-font-size={preferences.fontSize} style={{
              paddingBottom: `calc(${composerHeight + keyboardInset}px + ${keyboardOpen
                ? 'var(--message-gap-with-keyboard, 42px)' : 'var(--message-gap, 42px)'})`,
            }}>
              <div className={styles.conversationDate}>
                <span />
                {mode === 'demo' ? 'Today' : new Date(session.createdAt).toLocaleDateString()}
                <span />
              </div>
              <ChatHistoryStatus history={history} offline={offline}
                retry={() => void live?.loadHistory(session.id, history?.direction).catch(() => {})}
                loadEarlier={() => void live?.loadHistory(session.id, 'older').catch(() => {})} />
              {session.messages.length ? (
                <LazyBoundary><MessageList sessionId={session.id} messages={renderedMessages} disabled={disabled} pending={pending} answered={answeredIds}
                  running={running} recapBusy={recapBusy} scroll={scroll} railHost={railHost}
                  onOption={chooseReply} onRecap={requestRecap} onUnpin={unpin} /></LazyBoundary>
              ) : !history?.loading && (!history?.error || offline) ? (
                <Empty title={offline ? 'No saved messages' : 'The start of something good'}>
                  {offline ? 'Open this chat online to save its messages on this device.' : 'Give your agent a task to work on.'}
                </Empty>
              ) : null}
              {running && (
                <div className={styles.thinking} role="status">
                  <Spinner />
                  {session.agent} is working
                  {mode === 'demo' && <span className={styles.simulated}>Simulated</span>}
                </div>
              )}
              {hasRequests && <LazyBoundary><Requests sessionId={session.id} /></LazyBoundary>}
              {mode === 'demo' && session.id === questionDemoId && <LazyBoundary><DemoQuestions /></LazyBoundary>}
              <div className={styles.conversationEnd}>
                <span className={styles.liveDot} />
                {disabled
                  ? session.archived
                    ? 'Session ended'
                    : mode === 'live'
                      ? offline ? 'Offline · your draft stays on this device'
                        : connection !== 'connected' ? 'Connect to Happy…'
                          : 'Agent offline · resume this session'
                      : 'Computer offline'
                  : running
                    ? 'Working in your workspace'
                    : 'Ready when you are'}
              </div>
            </div>
          </div>
          <div ref={setRailHost} className={styles.recapRail} style={{
            bottom: `calc(${composerHeight + keyboardInset}px + var(--composer-bottom, 18px) + 22px)`,
          }} />
          <div ref={composer} className={styles.composerWrap} style={{
            bottom: `calc(${keyboardInset}px + ${keyboardOpen
              ? 'var(--composer-bottom-with-keyboard, 18px)' : 'var(--composer-bottom, 18px)'})`,
          }}>
            {awayFromLatest && (
              <div className={styles.latestShortcut}>
                <Button
                  className={styles.latestButton}
                  icon="arrowDown"
                  aria-label="Scroll to latest messages"
                  aria-controls={conversationId}
                  onClick={scrollToLatest}
                >
                  Latest messages
                </Button>
              </div>
            )}
            {error && (
              <p className={styles.sendError} role="alert">
                {error}
              </p>
            )}
            {(pending || stopping) && (
              <p className={styles.sendStatus} role="status">
                {stopping
                  ? 'Wait for the agent to stop…'
                  : 'Wait for Happy to confirm this message…'}
              </p>
            )}
            {mode === 'live' && disabled && connection === 'connected' && (
              <ResumeSession session={session} />
            )}
            <div className={styles.taskDock}>
              <TaskDock goal={goal} todos={todos} disabled={mode !== 'live' || connection !== 'connected' || !!offline}
                onGoalAction={goalAction} />
            </div>
            <div className={styles.composer} data-focus-frame
              onInput={stopRecapSpeech}
              onPaste={event => {
                if (mode !== 'live' || disabled || pending) return;
                const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
                if (files.length) { event.preventDefault(); addImages(files); }
              }}
              onDragOver={event => { if (!disabled && !pending && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
              onDrop={event => {
                if (disabled || pending) return;
                event.preventDefault(); addImages(Array.from(event.dataTransfer.files));
              }}>

              {attachments.length > 0 && (
                <div className={styles.attachments}>
                  {attachments.map((file, index) => (
                    <span key={`${file.name}-${index}`}>
                      <button disabled={pending} onClick={() => setPreview(file)}>
                        <Icon name="documentTextOutline" size={13} />
                        {file.name}
                      </button>
                      <button
                        aria-label={`Remove ${file.name}`}
                        disabled={pending}
                        onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <DraftComposer
                sessionId={session.id} input={input} archived={session.archived}
                needsResume={mode === 'live' && needsSessionResume(session)}
                disabled={disabled} offline={!!offline} pending={pending}
                hasAttachments={attachments.length > 0} onSend={send}
              >
                <input
                  type="file"
                  accept={mode === 'live' ? 'image/png,image/jpeg,image/gif,image/webp' : undefined}
                  aria-label="Choose chat images"
                  multiple
                  hidden
                  ref={fileInput}
                  onChange={(event) => {
                    addImages(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
                <Button
                  className={styles.attach}
                  variant="ghost"
                  icon="add"
                  aria-label="Attach files"
                  disabled={disabled || pending || session.agent === 'Happy Agent'}
                  title={mode === 'live' ? 'Attach images (up to 20, smaller than 10 MB each)' : undefined}
                  onClick={() => fileInput.current?.click()}
                />
                <Button
                  className={styles.permission}
                  icon="shieldCheckmarkOutline"
                  aria-label={`Permission mode: ${permissionName}`}
                  title={`Permission mode: ${permissionName}${effectivePermission ? ` (${effectivePermission})` : ''}`}
                  disabled={pending}
                  onClick={() => setPicker('permission')}
                >
                  <span>Mode: {permissionName}</span>
                </Button>
                <button
                  type="button"
                  className={styles.recapPill}
                  aria-label="Recap the last reply"
                  data-testid="recap-pill"
                  title="Ask the agent to recap its last reply"
                  disabled={disabled || pending || running || !canRecap || recapBusy}
                  onClick={() => void requestRecap()}
                >
                  <Icon name="sparkles" size={13} />
                  Recap
                </button>
                <button
                  className={styles.model}
                  aria-label="Model and effort"
                  disabled={pending}
                  onClick={() => setPicker('model')}
                >
                  <span>{modelLabel}{selectedEffort ? ` · ${effortLabel(selectedEffort)}` : ''}</span>
                  <Icon name="chevronDown" size={12} />
                </button>
                {running && (
                  <Button
                    className={styles.stop}
                    icon="stop"
                    aria-label="Stop response"
                    title="Stop response"
                    disabled={disabled || stopping}
                    onClick={() => void stop()}
                  />
                )}
              </DraftComposer>
            </div>
            <ContextWarning context={session.context} />
          </div>
        </>
      ) : mode === 'live' ? (
        <LazyBoundary><WorkspaceFiles key={session.id + view} session={session} view={view} /></LazyBoundary>
      ) : (
        <div className={styles.fileView}>
          <div className={styles.fileTitle}>
            <span>{view === 'changes' ? 'Changes in this workspace' : 'Workspace files'}</span>
            <span className={styles.simulated}>Sample files · read only</span>
          </div>
          <div className={styles.fileLayout}>
            <nav aria-label="Workspace files">
              {files.map((file) => (
                <button
                  key={file}
                  className={file === selectedFile ? styles.activeFile : ''}
                  onClick={() => setSelectedFile(file)}
                >
                  <Icon name="documentTextOutline" size={15} />
                  {file.split('/').pop()}
                </button>
              ))}
            </nav>
            <div className={styles.fileContent}>
              <div className={styles.codeHeader}>
                <span>{selectedFile}</span>
                <button
                  aria-label="Copy file contents"
                  onClick={() => copyText(sampleFiles[selectedFile], notify)}
                >
                  <Icon name="copyOutline" size={14} />
                </button>
              </div>
              <pre>
                {view === 'changes'
                  ? `@@ -12,3 +12,9 @@\n- <View style={styles.container}>\n+ <section className={styles.panel}>\n+   {children}\n+ </section>\n\n${sampleFiles[selectedFile]}`
                  : sampleFiles[selectedFile]}
              </pre>
            </div>
          </div>
          <Button
            className={styles.chatReturn}
            icon="arrowBack"
            onClick={() => navigate(`/session/${session.id}`)}
          >
            Back to chat
          </Button>
        </div>
      )}
      {picker && (
        <Dialog
          title={picker === 'model' ? 'Model & effort' : 'Permission mode'}
          onClose={() => setPicker(null)}
        >
          {picker === 'model' ? (
            <div className={styles.modelSettings}>
              <p>{mode === 'demo' ? 'Local demo. Applies to your next simulated reply.' : settingTiming}</p>
              {!canSelectModel(metadata) && <p>This session locks model selection.</p>}
              <h3>Model</h3>
              <div className={styles.pickerOptions} role="radiogroup" aria-label="Model">
                {models.map((option) => (
                  <button
                    key={option.value}
                    role="radio"
                    aria-checked={option.value === model}
                    disabled={option.disabled || !canSelectModel(metadata) || pending}
                    onClick={() => chooseModel(option.value)}
                  >
                    <span>{option.provider ? `${option.provider} · ` : ''}{option.label}{option.disabled ? ' (unavailable)' : ''}</span>
                    {option.value === model && <Icon name="checkmark" size={16} />}
                  </button>
                ))}
              </div>
              <h3>Effort</h3>
              {efforts.length ? (
                <div className={styles.pickerOptions} role="radiogroup" aria-label="Effort">
                  {efforts.map((value) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={selectedEffort === value}
                      disabled={pending}
                      onClick={() => chooseEffort(value)}
                    >
                      <span>{effortLabel(value)}</span>
                      {selectedEffort === value && <Icon name="checkmark" size={16} />}
                    </button>
                  ))}
                </div>
              ) : <p>This model does not offer effort selection.</p>}
              <ContextMeter context={session.context} />
              <Button onClick={() => setPicker(null)}>Done</Button>
            </div>
          ) : (
            <>
              <p>
                {mode === 'live'
                  ? `${settingTiming} Agent mode: ${permissionLabel(metadata, inheritedPermission)}${inheritedPermission ? ` (${inheritedPermission})` : ''}.`
                  : 'This preference applies to the demo session. No tools run on your computer.'}
              </p>
              {!permissionSelectable && <p>This session locks permission mode selection.</p>}
              <div className={styles.pickerOptions} role="radiogroup" aria-label="Permission mode">
                {mode === 'live' && (
                  <button
                    role="radio"
                    aria-checked={selectedPermission === null}
                    disabled={pending}
                    onClick={() => { pickModes({ permission: null }); setPicker(null); }}
                  >
                    <span>Use agent mode · {permissionLabel(metadata, inheritedPermission)}</span>
                    {selectedPermission === null && <Icon name="checkmark" size={16} />}
                  </button>
                )}
                {permissions.map((option) => (
                  <button
                    key={option.value}
                    role="radio"
                    aria-label={option.label}
                    aria-checked={option.value === selectedPermission}
                    disabled={option.disabled || !permissionSelectable || pending}
                    onClick={() => {
                      pickModes({ permission: option.value });
                      dispatch({ type: 'rememberPermission', key: preferenceKey, value: option.value });
                      setPicker(null);
                    }}
                  >
                    <span className={styles.permissionOption}>
                      <span>{option.label}</span>
                      <small>{option.value}{option.description ? ` · ${option.description}` : ''}</small>
                    </span>
                    {option.value === selectedPermission && (
                      <Icon name="checkmark" size={16} />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </Dialog>
      )}
      {preview && (
        <Dialog className={styles.imageDialog} title={preview.name} onClose={() => setPreview(null)}>
          {previewUrl ? (
            <img className={styles.attachmentPreview} src={previewUrl} alt={preview.name} />
          ) : (
            <p>
              {preview.type || 'File'} · {(preview.size / 1024).toFixed(1)} KB
            </p>
          )}
          <p>{mode === 'live' ? 'This image is encrypted before upload when you send.' : 'This file stays local. Only its name appears in the saved conversation.'}</p>
        </Dialog>
      )}
    </section>
  );
});
