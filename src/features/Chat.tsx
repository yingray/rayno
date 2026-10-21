import { lazy, memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, copyText, Dialog, Empty, Icon, Spinner } from '../components/ui';
import { WorkspaceTag } from '../components/WorkspaceTag';
import { useDemo } from '../data/store';
import { modelOptions, effortOptions, effortLabel, canSelectModel } from '../happy/modelOptions';
import { currentPermission, pendingPermissions, record, type Json } from '../happy/normalize';
import { permissionOptions, permissionLabel, canSelectPermission } from '../happy/permissionOptions';
import { messageError } from '../happy/errors';
import { titleOf } from '../data/reducer';
import { modelChoiceKey, resolveModelChoice } from '../happy/modelPreferences';
import { OfflineStatus } from '../components/OfflineStatus';
import type { Attachment, Session } from '../data/types';
import styles from './chat.module.css';
import { LazyBoundary } from '../components/LazyBoundary';
import { useEventCallback } from '../components/useEventCallback';
import { DraftComposer } from './DraftComposer';

const MessageList = lazy(() => import('./MessageList').then((module) => ({ default: module.MessageList })));
const Requests = lazy(() => import('../happy/Requests').then((module) => ({ default: module.Requests })));
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
  return pendingPermissions(state).length > 0 || Object.keys(record(state.communications))
    .some((id) => !record(state.completedCommunications)[id]);
}

export const Chat = memo(function Chat({
  session,
  onInfo,
  onList,
}: {
  session: Session;
  onInfo: () => void;
  onList: () => void;
}) {
  const { preferences, savedChoice, liveMetadata, agentState, dispatch, adapter, notify, mode, machines, live, history, connection, offline, usage } = useDemo((store) => ({
    preferences: store.state.preferences,
    savedChoice: store.state.modelChoices?.[modelChoiceKey(session.agent, session.machineId)],
    liveMetadata: store.snapshot?.sessionData[session.id]?.metadata,
    agentState: store.snapshot?.sessionData[session.id]?.agentState,
    dispatch: store.dispatch, adapter: store.adapter, notify: store.notify,
    mode: store.mode, machines: store.machines, live: store.live, history: store.snapshot?.histories[session.id],
    connection: store.snapshot?.connection, offline: store.snapshot?.offline, usage: store.usage,
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
  const metadata: Json = useMemo(() => mode === 'live' ? liveMetadata || {}
    : { flavor: session.agent === 'Happy Agent' ? 'rig' : session.agent.toLowerCase() }, [mode, liveMetadata, session.agent]);
  const week = usage.find(
    (item) =>
      item.agent === session.agent && (!item.machineId || item.machineId === session.machineId),
  );
  const location = useLocation();
  const navigate = useNavigate();
  const modesKey = `composerModes.${session.id}`;
  const [savedModes] = useState(() => {
    try {
      return JSON.parse((live ? live.readLocal(modesKey) : localStorage.getItem(`rayno.v2.demo.${modesKey}`)) || 'null');
    } catch { return null; }
  });
  const preferenceKey = modelChoiceKey(session.agent, session.machineId);
  const sessionChoice = { model: session.model, effort: session.effort || session.model.split(' · ')[1]?.toLowerCase() || null };
  const [modelSelection, setModelSelection] = useState(() => resolveModelChoice(metadata, [
    savedModes, sessionChoice, savedChoice,
  ]));
  const selection = useMemo(() => resolveModelChoice(metadata, [modelSelection, sessionChoice, savedChoice]), [metadata, modelSelection, session.model, session.effort, savedChoice]);
  const { model, effort: selectedEffort } = selection;
  const models = useMemo(() => modelOptions(metadata), [metadata]);
  const efforts = useMemo(() => effortOptions(metadata, model), [metadata, model]);
  const modelLabel = models.find((option) => option.value === model)?.label || model || 'No model available';
  const [permission, setPermission] = useState<string | null>(() =>
    typeof savedModes?.permission === 'string' ? savedModes.permission : mode === 'demo' ? 'default' : null);
  const permissionSelectable = canSelectPermission(metadata);
  const selectedPermission = permissionSelectable ? permission : null;
  const inheritedPermission = currentPermission(metadata);
  const effectivePermission = selectedPermission || inheritedPermission;
  const permissionName = permissionLabel(metadata, effectivePermission);
  const permissions = useMemo(() => permissionOptions(metadata, effectivePermission), [metadata, effectivePermission]);
  const [picker, setPicker] = useState<'model' | 'permission' | 'usage' | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [composerHeight, setComposerHeight] = useState(160);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(files[0]);
  const scroll = useRef<HTMLDivElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const conversationId = useId();
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  const view = location.pathname.endsWith('/changes')
    ? 'changes'
    : location.pathname.endsWith('/files')
      ? 'files'
      : 'chat';
  const running = session.status === 'running';
  const disabled =
    !model || session.archived ||
    session.status === 'offline' ||
    (mode === 'live' && connection !== 'connected');
  const lastUserIndex = useMemo(() => session.messages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  ), [session.messages]);
  const unansweredMessages = useMemo(() => new Set(
    session.messages.slice(lastUserIndex + 1).map((message) => message.id),
  ), [session.messages, lastUserIndex]);
  const messageSettings = useMemo(() => mode === 'live'
    ? {
        model,
        effort: efforts.length ? selectedEffort : undefined,
        permissionMode: selectedPermission || undefined,
      }
    : {}, [mode, model, efforts.length, selectedEffort, selectedPermission]);

  useEffect(() => {
    try {
      const value = JSON.stringify({ model, effort: selectedEffort, permission: selectedPermission });
      if (live) live.writeLocal(modesKey, value);
      else localStorage.setItem(`rayno.v2.demo.${modesKey}`, value);
    } catch { /* Keep the selection for this visit if storage is unavailable. */ }
  }, [live, modesKey, model, selectedEffort, selectedPermission]);

  function rememberChoice(value: typeof selection) {
    setModelSelection(value);
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
    if (!preview || !preview.type.startsWith('image/')) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  async function send(value: string) {
    if (pendingRef.current || disabled || (!value.trim() && !attachments.length)) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      pinned.current = true;
      await adapter.sendMessage(
        session.id,
        value,
        attachments.map(({ name, size, type }): Attachment => ({ name, size, type })),
        messageSettings,
      );
      setAttachments([]);
      input.current?.focus();
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
    } catch (error) {
      setError(messageError(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [adapter, disabled, session.id, messageSettings, unansweredMessages]);
  const chooseReply = useEventCallback(sendOption);

  return (
    <section
      className={styles.chat}
      data-view={view}
      data-keyboard-open={keyboardOpen}
      aria-label="Chat session"
    >
      <header className={styles.header}>
        <Button
          className={styles.back}
          icon="arrowBack"
          aria-label="Back to sessions"
          onClick={() => navigate('/sessions')}
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
            <strong>{titleOf(session)}</strong>
            <span className={styles.subtitle}>
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
        <Button
          className={styles.mobileOverflow}
          icon="ellipsisHorizontal"
          aria-label="Open session info"
          onClick={onInfo}
        />
      </header>
      <OfflineStatus label="Conversation availability" />
      {view === 'chat' ? (
        <>
          <div
            id={conversationId}
            role="region"
            aria-label="Conversation messages"
            className={styles.messageScroll}
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
              {history?.hasMore && (
                <Button
                  disabled={history.loading || offline}
                  onClick={() =>
                    void live
                      ?.loadHistory(session.id, 'older')
                      .catch((error) => setError(messageError(error)))
                  }
                >
                  Load earlier messages
                </Button>
              )}
              {history?.loading && <p role="status">Read messages…</p>}
              {offline && !history?.loaded && <p role="status">Open this chat online to save its messages on this device.</p>}
              {history?.error && (
                <p role="alert">
                  {history.error}{' '}
                  <button onClick={() => void live?.loadHistory(session.id).catch(() => {})}>
                    Retry history
                  </button>
                </p>
              )}
              {session.messages.length ? (
                <LazyBoundary><MessageList messages={renderedMessages} disabled={disabled} pending={pending} onOption={chooseReply} /></LazyBoundary>
              ) : (
                <Empty title={offline ? 'No saved messages' : 'The start of something good'}>
                  {offline ? 'Open this chat online to save its messages on this device.' : 'Give your agent a task to work on.'}
                </Empty>
              )}
              {running && (
                <div className={styles.thinking} role="status">
                  <Spinner />
                  {session.agent} is working
                  {mode === 'demo' && <span className={styles.simulated}>Simulated</span>}
                </div>
              )}
              {hasRequests && <LazyBoundary><Requests sessionId={session.id} /></LazyBoundary>}
              <div className={styles.conversationEnd}>
                <span className={styles.liveDot} />
                {disabled
                  ? session.archived
                    ? 'Archived session'
                    : mode === 'live'
                      ? offline ? 'Offline · your draft stays on this device'
                        : connection !== 'connected' ? 'Connect to Happy…'
                          : 'Agent offline · resume it in the Happy app'
                      : 'Computer offline'
                  : running
                    ? 'Working in your workspace'
                    : 'Ready when you are'}
              </div>
            </div>
          </div>
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
              <p className={styles.resumeLink}>
                Resume or manage this agent in the Happy app.
              </p>
            )}
            <div className={styles.composer} data-focus-frame>
              {attachments.length > 0 && (
                <div className={styles.attachments}>
                  {attachments.map((file, index) => (
                    <span key={`${file.name}-${index}`}>
                      <button onClick={() => setPreview(file)}>
                        <Icon name="documentTextOutline" size={13} />
                        {file.name}
                      </button>
                      <button
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setAttachments((items) => items.filter((_, i) => i !== index))
                        }
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <DraftComposer
                sessionId={session.id} input={input} archived={session.archived}
                needsResume={mode === 'live' && session.archived && session.agent !== 'Happy Agent' && session.status === 'offline'}
                disabled={disabled} offline={!!offline} pending={pending}
                hasAttachments={attachments.length > 0} onSend={send}
              >
                <input
                  type="file"
                  multiple
                  hidden
                  ref={fileInput}
                  onChange={(event) => {
                    setAttachments((items) =>
                      [...items, ...Array.from(event.target.files || [])].slice(0, 5),
                    );
                    event.target.value = '';
                  }}
                />
                <Button
                  className={styles.attach}
                  variant="ghost"
                  icon="add"
                  aria-label="Attach files"
                  disabled={disabled || mode === 'live'}
                  title={mode === 'live' ? 'File uploads are available in the Happy app' : undefined}
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
            <div className={styles.usageRow}>
              <span className={styles.demoLabel}>
                {mode === 'demo'
                  ? 'Local demo · simulated replies'
                  : `Happy · ${connection}`}
              </span>
              {preferences.showUsage && mode === 'demo' && (
                <>
                  <button onClick={() => setPicker('usage')}>38% week</button>
                  <button
                    onClick={() => setShowTokens((value) => !value)}
                    aria-label="Toggle context token count"
                  >
                    <span className={styles.contextRing} />
                    {showTokens ? '48k / 200k tokens' : '24% context'}
                  </button>
                </>
              )}
              {preferences.showUsage && mode === 'live' && week && (
                <button onClick={() => setPicker('usage')}>
                  {week.usedPercent}% week{week.stale ? ' · stale' : ''}
                </button>
              )}
            </div>
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
          title={
            picker === 'model'
              ? 'Model & effort'
              : picker === 'permission'
                ? 'Permission mode'
                : 'Usage overview'
          }
          onClose={() => setPicker(null)}
        >
          {picker === 'usage' && mode === 'live' ? (
            <>
              <p>
                {week
                  ? `${week.usedPercent}% of week used · resets ${week.reset}${week.stale ? ' · stale reading' : ''}`
                  : 'No usage reading yet. Refresh Monitor to read usage from the computer.'}
              </p>
              <Button
                onClick={() => {
                  setPicker(null);
                  navigate('/monitor');
                }}
              >
                Open Monitor
              </Button>
            </>
          ) : picker === 'usage' ? (
            <>
              <p>
                Sample usage for{' '}
                {machines.find((machine) => machine.id === session.machineId)?.name}.
              </p>
              <div className={styles.usageDetail}>
                <strong>38%</strong>
                <span>of this week used</span>
                <div>
                  <i />
                </div>
                <span>Resets in 3d 18h · On pace</span>
              </div>
              <Button
                icon="pulseOutline"
                onClick={() => {
                  setPicker(null);
                  navigate('/monitor');
                }}
              >
                Open Monitor
              </Button>
            </>
          ) : picker === 'model' ? (
            <div className={styles.modelSettings}>
              <p>{mode === 'demo' ? 'Local demo. Applies to your next simulated reply.' : 'Applies to your next message.'}</p>
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
              <Button onClick={() => setPicker(null)}>Done</Button>
            </div>
          ) : (
            <>
              <p>
                {mode === 'live'
                  ? `Applies to your next message. Agent mode: ${permissionLabel(metadata, inheritedPermission)}${inheritedPermission ? ` (${inheritedPermission})` : ''}.`
                  : 'This preference applies to the demo session. No tools run on your computer.'}
              </p>
              {!permissionSelectable && <p>This session locks permission mode selection.</p>}
              <div className={styles.pickerOptions} role="radiogroup" aria-label="Permission mode">
                {mode === 'live' && (
                  <button
                    role="radio"
                    aria-checked={selectedPermission === null}
                    disabled={pending}
                    onClick={() => { setPermission(null); setPicker(null); }}
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
                      setPermission(option.value);
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
        <Dialog title={preview.name} onClose={() => setPreview(null)}>
          {previewUrl ? (
            <img className={styles.attachmentPreview} src={previewUrl} alt={preview.name} />
          ) : (
            <p>
              {preview.type || 'File'} · {(preview.size / 1024).toFixed(1)} KB
            </p>
          )}
          <p>This file stays local. Only its name appears in the saved conversation.</p>
        </Dialog>
      )}
    </section>
  );
});
