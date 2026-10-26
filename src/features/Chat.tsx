import { useText } from "../i18n";
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
import { countOpenSideChats, hasUnreadSideChats, showSideChatEntry, SIDE_CHAT_TITLE, sideChatTitle } from '../data/sideChats';
import styles from './chat.module.css';
import { LazyBoundary } from '../components/LazyBoundary';
import { useEventCallback } from '../components/useEventCallback';
import { DraftComposer } from './DraftComposer';
import { ContextMeter, ContextWarning } from './ContextMeter';
import { selectedImages } from '../happy/attachments';
import { ResumeSession } from './ResumeSession';
import { TerminalControl } from './TerminalControl';
import { ChatSessionMenu } from './ChatSessionMenu';
import { needsSessionResume } from '../happy/resume';
import { ChatHistoryStatus } from './ChatHistoryStatus';
import { questionDemoId } from '../data/questionDemo';
import { hasAgentReply, hasOpenRecapRequest, isRejected, unansweredMessageIds } from '../data/replyTurns';
import { stopRecapSpeech } from './recapSpeech';
import { TaskDock } from './TaskDock';
import { visibleGoal, type GoalAction } from '../happy/agentGoal';
import { latestTodos } from '../data/todos';
import { parseRipgrepFiles, searchCommands, searchFiles, sessionCommands, type FileItem } from '../happy/suggestions';
import type { Suggestion } from './ComposerSuggestions';
import type { TranscriptController } from './TranscriptViewport';
import { ActivityWaiting } from './ActivityTicker';
import { SessionGitInfo } from './SessionGitInfo';
import { toolTimelineDemoId } from '../data/toolTimelineDemo';

const MessageList = lazy(() => import('./MessageList').then((module) => ({ default: module.MessageList })));
const Requests = lazy(() => import('../happy/Requests').then((module) => ({ default: module.Requests })));
const DemoQuestions = lazy(() => import('./DemoQuestions').then((module) => ({ default: module.DemoQuestions })));
const DemoToolTimeline = lazy(() => import('./DemoToolTimeline').then((module) => ({ default: module.DemoToolTimeline })));
const WorkspaceFiles = lazy(() => import('../happy/WorkspaceFiles').then((module) => ({ default: module.WorkspaceFiles })));
const GitChanges = lazy(() => import('./GitChanges').then((module) => ({ default: module.GitChanges })));

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
const demoFileIndex = parseRipgrepFiles(files.join('\n'));
const fileSuggestion = (file: FileItem): Suggestion => ({ key: 'file-' + file.fullPath, text: '@' + file.fullPath,
  kind: file.fileType, label: file.fileName, detail: file.filePath || undefined });

function hasAgentRequests(state: Json = {}) {
  return pendingPermissions(state).length > 0 || pendingCommunications(state).length > 0;
}

export const Chat = memo(function Chat({
  session,
  onInfo,
  onList,
  listExpanded = false,
  embedded = false,
  onSettings,
}: {
  session: Session;
  onInfo: () => void;
  onList: () => void;
  listExpanded?: boolean;
  /** A side chat inside its parent's panel. The panel owns the header. */
  embedded?: boolean;
  onSettings?: (sessionId: string, settings: MessageSettings) => void;
}) {
  const t = useText();
  const { ui, preferences, savedChoice, liveMetadata, agentState, dispatch, adapter, notify, mode, live, history, connection, offline, sideChats, sideUnread, parentKnown, sideEntry, sideTitle } = useDemo((store) => ({
    // A side chat whose parent is gone returns to the session list.
    parentKnown: !!session.parentSessionId && store.state.sessions.some((item) => item.id === session.parentSessionId),
    sideChats: session.isSideChat || embedded ? 0 : countOpenSideChats(store.state.sessions, session.id),
    sideUnread: !session.isSideChat && hasUnreadSideChats(store.state.sessions, session.id),
    sideEntry: !embedded && showSideChatEntry(store.state.sessions, session, store.live),
    sideTitle: embedded || !session.isSideChat ? undefined : sideChatTitle(store.state.sessions, session.id),
    ui: store.ui, preferences: store.state.preferences,
    savedChoice: store.state.modelChoices?.[modelChoiceKey(session.agent, session.machineId)],
    liveMetadata: store.snapshot?.sessionData[session.id]?.metadata,
    agentState: store.snapshot?.sessionData[session.id]?.agentState,
    dispatch: store.dispatch, adapter: store.adapter, notify: store.notify,
    mode: store.mode, live: store.live, history: store.snapshot?.histories[session.id],
    connection: store.snapshot?.connection, offline: store.snapshot?.offline,
  }));
  const hasRequests = useMemo(() => !!live && hasAgentRequests(agentState), [live, agentState]);
  const commands = useMemo(() => sessionCommands(mode === 'live' ? liveMetadata || {} : {}), [mode, liveMetadata]);
  // As v1 `components/autocomplete/suggestions.ts`: `/` reads session commands and `@` reads the session file index.
  const suggest = useCallback(async (word: string): Promise<Suggestion[]> => {
    if (word.startsWith('/')) return searchCommands(commands, word.slice(1)).map((item) => ({ key: 'cmd-' + item.command,
      text: '/' + item.command, kind: 'command', label: '/' + item.command, detail: item.description }));
    if (!word.startsWith('@')) return [];
    const index = live ? await live.sessionFiles(session.id) : demoFileIndex;
    return searchFiles(index, word.slice(1)).map(fileSuggestion);
  }, [commands, live, session.id]);
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
  const metadata: Json = useMemo(() => ({ ...(mode === 'live' ? liveMetadata || {}
    : { flavor: session.agent === 'Happy Agent' ? 'rig' : session.agent.toLowerCase() }), customCodexModel: preferences.customCodexModel }), [mode, liveMetadata, session.agent, preferences.customCodexModel]);
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
  const permissionName = t(permissionLabel(metadata, effectivePermission));
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
  const previousScrollTop = useRef(0);
  const viewport = useRef<TranscriptController | null>(null);
  const [virtualMode, setVirtualMode] = useState(false);
  const [managedTranscript, setManagedTranscript] = useState(false);
  const onTranscriptPinned = useCallback((value: boolean) => {
    const element = scroll.current;
    setAwayFromLatest(!value || !!element && element.scrollHeight - element.scrollTop - element.clientHeight >= 90);
  }, []);
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

  function updateScrollPosition(element: HTMLDivElement, scrollEvent = false) {
    const nearEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
    // A queued scroll event can arrive after a taller reply changes the scroll height.
    if (!managedTranscript && !virtualMode && (!scrollEvent || !pinned.current
      || element.scrollTop < previousScrollTop.current - 1 || nearEnd)) pinned.current = nearEnd;
    previousScrollTop.current = element.scrollTop;
    // Follow intent can lag a browser scroll. Keep the shortcut tied to the visible position too.
    setAwayFromLatest(!pinned.current || !nearEnd);
    live?.setSessionReading(session.id, pinned.current);
  }

  function scrollToLatest() {
    if (managedTranscript && viewport.current) { viewport.current.latest(); setAwayFromLatest(false); live?.setSessionReading(session.id, true); return; }
    const element = scroll.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    updateScrollPosition(element);
  }

  useLayoutEffect(() => {
    if (!scroll.current || !scrollContent.current || view !== 'chat' || managedTranscript || virtualMode) return;
    const element = scroll.current;
    if (pinned.current) element.scrollTop = element.scrollHeight;
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
    };
  }, [session.id, view, live, virtualMode, managedTranscript]);
  useLayoutEffect(() => {
    if (!scroll.current || managedTranscript || virtualMode) return;
    if (pinned.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    updateScrollPosition(scroll.current);
  }, [session.messages.length, composerHeight, keyboardInset, keyboardOpen, running, virtualMode, managedTranscript]);
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
      const chosen = ui.getDraftOptions(session.id);
      await adapter.sendMessage(
        session.id,
        value,
        attachments.map((file): Attachment => ({ name: file.name, size: file.size, type: file.type, ...(mode === 'live' ? { file } : {}) })),
        messageSettings,
      );
      chosen.forEach(option => answeredOptions.current.add(option.messageId));
      setAnsweredIds(new Set(answeredOptions.current));
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
  const chooseReply = useEventCallback((messageId: string, key: string, text: string) => {
    if (pendingRef.current || disabled || answeredOptions.current.has(messageId) || !unansweredMessages.has(messageId)) return;
    dispatch({ type: 'draftOption', id: session.id, key, messageId, text });
  });
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
  const unpin = useCallback(() => { pinned.current = false; viewport.current?.unpin(); }, []);
  const goal = useMemo(() => mode === 'live' ? visibleGoal(agentState, liveMetadata, session.status !== 'offline') : null,
    [mode, agentState, liveMetadata, session.status]);
  const todos = useMemo(() => session.archived ? [] : session.todos ?? latestTodos(session.messages),
    [session.archived, session.todos, session.messages]);
  const goalAction = useCallback(async (params: { action: GoalAction; objective?: string }) => {
    if (!live) throw new Error('Connect to Happy before you change the goal.');
    await live.goalAction(session.id, params);
  }, [live, session.id]);

  return (
    <section
      className={styles.chat}
      data-view={view}
      data-chat-width={preferences.chatWidth}
      data-chat-session
      data-connection={mode === 'live' ? connection : undefined}
      data-keyboard-open={keyboardOpen}
      data-embedded={embedded || undefined}
      aria-label={embedded ? t("Side chat conversation") : t("Chat session")}
    >
      {!embedded && <header className={styles.header}>
        <Button
          className={`${styles.back} ${parentId ? styles.parentBack : ''}`}
          icon="arrowBack"
          aria-label={parentId ? t("Back to parent chat") : t("Back to sessions")}
          title={parentId ? t("Back to parent chat") : undefined}
          onClick={() => parentId ? navigate(`/session/${parentId}/side`, { state: { sideChat: session.id } }) : navigate('/sessions')}
        />
        <Button
          className={styles.listButton}
          variant="ghost"
          icon="sidebarOutline"
          aria-label={listExpanded ? t("Collapse session list") : t("Open session list")}
          aria-expanded={listExpanded}
          onClick={onList}
        />
        <button className={styles.titleCapsule} onClick={onInfo} aria-label={t("Open session info")}>
          <Avatar sessionId={session.id} agent={session.agent} size={36} />
          <span className={styles.titleText}>
            <strong>{sideTitle || titleOf(session)}</strong>
            <span className={styles.subtitle}>
              <span className={styles.workspaceMeta} title={session.workspace}>
              {session.isSideChat && titleOf(session) !== SIDE_CHAT_TITLE && <span className={styles.sideTag}>{t("Side chat")}</span>}
              <WorkspaceTag name={session.workspace} small />
              </span>
              <SessionGitInfo session={session} />
            </span>
          </span>
        </button>
        {sideEntry && (
          <Button
            className={styles.sideChatsButton}
            icon="chatbubblesOutline"
            aria-label={sideChats ? `Side chats, ${sideChats} open` : t("Side chats")}
            aria-expanded={sideOpen}
            title={t("Side chats")}
            onClick={() => navigate(sideOpen ? `/session/${session.id}` : `/session/${session.id}/side`)}
          >{sideUnread && <i className={styles.sideUnread} role="img" aria-label={t("New reply")} />}{sideChats ? <span className={styles.sideChatsCount}>{sideChats}</span> : null}</Button>
        )}
        <ChatSessionMenu session={session} settings={messageSettings} />
      </header>}
      <OfflineStatus label={embedded ? t("Side chat availability") : t("Conversation availability")} />
      {view === 'chat' ? (
        <>
          <div
            id={conversationId}
            role="region"
            aria-label={t("Conversation messages")}
            className={styles.messageScroll}
            data-transcript-managed={managedTranscript || undefined}
            // Focus and scrollIntoView keep a control above the composer that overlays the bottom of the list.
            style={{ scrollPaddingBottom: `${composerHeight + keyboardInset}px` }}
            ref={scroll}
            onScroll={(event) => updateScrollPosition(event.currentTarget, true)}
            onFocusCapture={event => {
              if (managedTranscript && event.target instanceof HTMLElement && event.target.classList.contains(styles.historyEarlier)) unpin();
            }}
            onPointerDownCapture={(event) => {
              if (event.target instanceof Element && event.target.closest('[data-tool-activity]'))
                unpin();
            }}
            onKeyDownCapture={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
                && event.target.closest('[data-tool-activity]')) unpin();
            }}
          >
            <div className={styles.messages} ref={scrollContent} data-font-size={preferences.fontSize} style={{
              paddingBottom: `calc(${composerHeight + keyboardInset}px + ${keyboardOpen
                ? 'var(--message-gap-with-keyboard, 42px)' : 'var(--message-gap, 42px)'})`,
            }}>
              <div className={styles.conversationDate}>
                <span />
                {mode === 'demo' ? t("Today") : new Date(session.createdAt).toLocaleDateString()}
                <span />
              </div>
              <ChatHistoryStatus history={history} offline={offline}
                retry={() => void live?.loadHistory(session.id, history?.direction).catch(() => {})}
                loadEarlier={() => { viewport.current?.unpin(); viewport.current?.capture(); void live?.loadHistory(session.id, 'older').catch(() => {}); }} />
              {session.messages.length ? (
                <LazyBoundary><MessageList sessionId={session.id} messages={renderedMessages} disabled={disabled} pending={pending} answered={answeredIds}
                  running={running} agent={session.agent} simulated={mode === 'demo'} recapBusy={recapBusy} scroll={scroll} railHost={railHost}
                  pinned={pinned} viewport={viewport} onVirtualMode={setVirtualMode} onManaged={setManagedTranscript} onPinned={onTranscriptPinned}
                  onOption={chooseReply} onRecap={requestRecap} onUnpin={unpin} /></LazyBoundary>
              ) : !history?.loading && (!history?.error || offline) ? (
                <Empty title={offline ? t("No saved messages") : t("The start of something good")}>
                  {offline ? t("Open this chat online to save its messages on this device.") : t("Give your agent a task to work on.")}
                </Empty>
              ) : null}
              {running && !renderedMessages.length && <ActivityWaiting agent={session.agent} simulated={mode === 'demo'} />}
              {hasRequests && <LazyBoundary><Requests sessionId={session.id} /></LazyBoundary>}
              {mode === 'demo' && session.id === questionDemoId && <LazyBoundary><DemoQuestions /></LazyBoundary>}
              {mode === 'demo' && session.id === toolTimelineDemoId && <LazyBoundary><DemoToolTimeline session={session} /></LazyBoundary>}
              <div className={styles.conversationEnd}>
                <span className={styles.liveDot} />
                {disabled
                  ? session.archived
                    ? t("Session ended")
                    : mode === 'live'
                      ? offline ? t("Offline · your draft stays on this device")
                        : connection !== 'connected' ? t("Connect to Happy…")
                          : t("Agent offline · resume this session")
                      : t("Computer offline")
                  : session.terminalControl
                    ? t("The terminal controls this session")
                  : running
                    ? t("Working in your workspace")
                    : t("Ready when you are")}
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
                  aria-label={t("Scroll to latest messages")}
                  aria-controls={conversationId}
                  onClick={scrollToLatest}
                >{t("Latest messages")}</Button>
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
                  ? t("Wait for the agent to stop…")
                  : t("Wait for Happy to confirm this message…")}
              </p>
            )}
            {mode === 'live' && disabled && connection === 'connected' && (
              <ResumeSession session={session} />
            )}
            <div className={styles.composerRows}>
              {mode === 'live' && <TerminalControl session={session} disabled={disabled || pending} />}
              <div className={styles.taskDock}>
                <TaskDock goal={goal} todos={todos} disabled={mode !== 'live' || connection !== 'connected' || !!offline}
                  onGoalAction={goalAction} />
              </div>
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
                disabled={disabled} offline={!!offline} pending={pending} terminal={mode === 'live' && !!session.terminalControl}
                hasAttachments={attachments.length > 0} onSend={send} suggest={suggest}
              >
                <input
                  type="file"
                  accept={mode === 'live' ? "image/png,image/jpeg,image/gif,image/webp" : undefined}
                  aria-label={t("Choose chat images")}
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
                  aria-label={t("Attach files")}
                  disabled={disabled || pending || session.agent === 'Happy Agent'}
                  title={mode === 'live' ? t("Attach images (up to 20, smaller than 10 MB each)") : undefined}
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
                  <span>{t("Mode:")}{' '}{permissionName}</span>
                </Button>
                <button
                  type="button"
                  className={styles.recapPill}
                  aria-label={t("Recap the last reply")}
                  data-testid="recap-pill"
                  title={t("Ask the agent to recap its last reply")}
                  disabled={disabled || pending || running || !canRecap || recapBusy}
                  onClick={() => void requestRecap()}
                >
                  <Icon name="sparkles" size={13} />{t("Recap")}</button>
                <button
                  className={styles.model}
                  aria-label={t("Model and effort")}
                  disabled={pending}
                  onClick={() => setPicker('model')}
                >
                  <span>{modelLabel}{selectedEffort ? ` · ${t(effortLabel(selectedEffort))}` : ''}</span>
                  <Icon name="chevronDown" size={12} />
                </button>
                {running && (
                  <Button
                    className={styles.stop}
                    icon="stop"
                    aria-label={t("Stop response")}
                    title={t("Stop response")}
                    disabled={disabled || stopping}
                    onClick={() => void stop()}
                  />
                )}
              </DraftComposer>
            </div>
            <ContextWarning context={session.context} always={preferences.alwaysShowContextSize} />
          </div>
        </>
      ) : view === 'changes' ? (
        <LazyBoundary><GitChanges key={session.id} session={session} /></LazyBoundary>
      ) : mode === 'live' ? (
        <LazyBoundary><WorkspaceFiles key={session.id + view} session={session} /></LazyBoundary>
      ) : (
        <div className={styles.fileView}>
          <div className={styles.fileTitle}>
            <span>{t("Workspace files")}</span>
            <span className={styles.simulated}>{t("Sample files · read only")}</span>
          </div>
          <div className={styles.fileLayout}>
            <nav aria-label={t("Workspace files")}>
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
                  aria-label={t("Copy file contents")}
                  onClick={() => copyText(sampleFiles[selectedFile], notify)}
                >
                  <Icon name="copyOutline" size={14} />
                </button>
              </div>
              <pre>
                {sampleFiles[selectedFile]}
              </pre>
            </div>
          </div>
          <Button
            className={styles.chatReturn}
            icon="arrowBack"
            onClick={() => navigate(`/session/${session.id}`)}
          >{t("Back to chat")}</Button>
        </div>
      )}
      {picker && (
        <Dialog
          title={picker === 'model' ? t("Model & effort") : t("Permission mode")}
          onClose={() => setPicker(null)}
        >
          {picker === 'model' ? (
            <div className={styles.modelSettings}>
              <p>{mode === 'demo' ? t("Local demo. Applies to your next simulated reply.") : settingTiming}</p>
              {!canSelectModel(metadata) && <p>{t("This session locks model selection.")}</p>}
              <h3>{t("Model")}</h3>
              <div className={styles.pickerOptions} role="radiogroup" aria-label={t("Model")}>
                {models.map((option) => (
                  <button
                    key={option.value}
                    role="radio"
                    aria-checked={option.value === model}
                    disabled={option.disabled || !canSelectModel(metadata) || pending}
                    onClick={() => chooseModel(option.value)}
                  >
                    <span>{option.provider ? `${option.provider} · ` : ''}{option.label}{option.disabled ? t(" (unavailable)") : ''}</span>
                    {option.value === model && <Icon name="checkmark" size={16} />}
                  </button>
                ))}
              </div>
              <h3>{t("Effort")}</h3>
              {efforts.length ? (
                <div className={styles.pickerOptions} role="radiogroup" aria-label={t("Effort")}>
                  {efforts.map((value) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={selectedEffort === value}
                      disabled={pending}
                      onClick={() => chooseEffort(value)}
                    >
                      <span>{t(effortLabel(value))}</span>
                      {selectedEffort === value && <Icon name="checkmark" size={16} />}
                    </button>
                  ))}
                </div>
              ) : <p>{t("This model does not offer effort selection.")}</p>}
              <ContextMeter context={session.context} />
              <Button onClick={() => setPicker(null)}>{t("Done")}</Button>
            </div>
          ) : (
            <>
              <p>
                {mode === 'live'
                  ? `${settingTiming} Agent mode: ${permissionLabel(metadata, inheritedPermission)}${inheritedPermission ? ` (${inheritedPermission})` : ''}.`
                  : t("This preference applies to the demo session. No tools run on your computer.")}
              </p>
              {!permissionSelectable && <p>{t("This session locks permission mode selection.")}</p>}
              <div className={styles.pickerOptions} role="radiogroup" aria-label={t("Permission mode")}>
                {mode === 'live' && (
                  <button
                    role="radio"
                    aria-checked={selectedPermission === null}
                    disabled={pending}
                    onClick={() => { pickModes({ permission: null }); setPicker(null); }}
                  >
                    <span>{t("Use agent mode ·")}{' '}{permissionLabel(metadata, inheritedPermission)}</span>
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
              {preview.type || 'File'} · {(preview.size / 1024).toFixed(1)}{' '}{t("KB")}</p>
          )}
          <p>{mode === 'live' ? t("This image is encrypted before upload when you send.") : t("This file stays local. Only its name appears in the saved conversation.")}</p>
        </Dialog>
      )}
    </section>
  );
});
