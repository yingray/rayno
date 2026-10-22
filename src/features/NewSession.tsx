import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Icon, Segment, Spinner } from '../components/ui';
import { useDemo } from '../data/store';
import { modelOptions, effortOptions, effortLabel } from '../happy/modelOptions';
import { validateDraft } from '../data/reducer';
import type { Agent } from '../data/types';
import styles from './new-session.module.css';
import { AgentChoices } from './AgentChoices';
import { LazyBoundary } from '../components/LazyBoundary';
import { draftInWorkspace, recentWorkspaceOptions } from '../data/workspaces';
import { modelChoiceKey, recentModelChoice, resolveModelChoice } from '../happy/modelPreferences';
import { permissionOptions, resolveNewSessionPermission } from '../happy/permissionOptions';
import type { ModelChoice } from '../data/types';
import { selectedImages } from '../happy/attachments';

const NewModelPicker = lazy(() => import('./NewSessionPickers').then((module) => ({ default: module.NewModelPicker })));
const WorkspacePicker = lazy(() => import('./NewSessionPickers').then((module) => ({ default: module.WorkspacePicker })));

export function NewSession() {
  const { draft, lastAgent, modelChoices, permissionChoices, sessions, recentWorkspaces, enterToSend, dispatch, adapter, machines, mode, live } = useDemo((store) => ({
    draft: store.state.newDraft, lastAgent: store.state.lastAgent, modelChoices: store.state.modelChoices,
    permissionChoices: store.state.permissionChoices,
    sessions: store.state.sessions, recentWorkspaces: store.state.recentWorkspaces,
    enterToSend: store.state.preferences.enterToSend, dispatch: store.dispatch, adapter: store.adapter,
    machines: store.machines, mode: store.mode, live: store.live,
  }));
  const navigate = useNavigate();
  const agent = draft.agent === 'Happy Agent' ? lastAgent || 'Claude' : draft.agent;
  const metadata = useMemo(() => ({ flavor: agent.toLowerCase() }), [agent]);
  const preferenceKey = modelChoiceKey(agent, draft.machineId);
  const selection = resolveModelChoice(metadata, [
    modelChoices?.[preferenceKey], draft,
    recentModelChoice(sessions, agent, draft.machineId),
  ]);
  const { model, effort } = selection;
  const permissions = permissionOptions(metadata);
  const permissionMode = resolveNewSessionPermission(metadata, [
    permissionChoices?.[preferenceKey],
  ]);
  const models = modelOptions(metadata);
  const machine = machines.find((item) => item.id === draft.machineId);
  const workspaces = useMemo(() => recentWorkspaceOptions(sessions, machines, recentWorkspaces || [], draft.machineId), [sessions, machines, recentWorkspaces, draft.machineId]);
  const efforts = effortOptions(metadata, model);
  const [picker, setPicker] = useState<'model' | 'workspace' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const input = taskInput.current;
    if (input?.value) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollTop = input.scrollHeight;
    }
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (draft.agent !== agent || draft.model !== model || draft.effort !== effort || draft.permissionMode !== permissionMode)
      dispatch({ type: 'newDraft', value: { agent, model, effort, permissionMode } });
  }, [agent, model, effort, permissionMode, draft.agent, draft.model, draft.effort, draft.permissionMode, dispatch]);
  async function start() {
    if (busy) return;
    const validation = validateDraft(
      { ...draft, permissionMode },
      !!machines.find((machine) => machine.id === draft.machineId)?.online,
    );
    if (validation && !(attachments.length && validation === 'Describe what the agent should do.')) {
      setError(validation);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const id = await adapter.createSession(
        { ...draft, agent, model, effort, permissionMode },
        attachments.map(file => ({ name: file.name, size: file.size, type: file.type, ...(mode === 'live' ? { file } : {}) })),
      );
      if (mounted.current) navigate(`/session/${id}`);
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : 'Could not start the session. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function rememberChoice(value: ModelChoice, nextAgent = agent) {
    if (value.model) dispatch({ type: 'rememberModel', key: modelChoiceKey(nextAgent, draft.machineId), value });
    dispatch({ type: 'newDraft', value: { agent: nextAgent, ...value } });
  }
  function chooseAgent(nextAgent: Agent) {
    if (nextAgent === agent || nextAgent === 'Happy Agent') return;
    rememberChoice(resolveModelChoice({ flavor: nextAgent.toLowerCase() }, [
      modelChoices?.[modelChoiceKey(nextAgent, draft.machineId)],
      recentModelChoice(sessions, nextAgent, draft.machineId),
    ]), nextAgent);
    dispatch({ type: 'newDraft', value: { permissionMode: resolveNewSessionPermission(
      { flavor: nextAgent.toLowerCase() }, [permissionChoices?.[modelChoiceKey(nextAgent, draft.machineId)]],
    ) } });
  }
  function chooseModel(value: string) {
    rememberChoice(resolveModelChoice(metadata, [{ model: value, effort }]));
  }
  function chooseWorkspace(path: string) {
    const selected = draftInWorkspace({ machineId: draft.machineId, path, homeDir: machine?.homeDir }, agent);
    if (!selected) return;
    dispatch({ type: 'newDraft', value: {
      machineId: selected.machineId, path: selected.path, type: selected.type, worktree: selected.worktree,
    } });
    setPicker(null);
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.nativeEvent.isComposing &&
      ((enterToSend && !event.shiftKey) || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void start();
    }
  }
  return (
    <section className={styles.screen} aria-label="Create session">
      <div className={styles.mobileHeader}>
        <h1>New session</h1>
        <Button
          icon="close"
          aria-label="Close new session"
          disabled={busy}
          onClick={() => navigate('/sessions')}
        />
      </div>
      <div className={styles.content}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>
            <Icon name="sparklesOutline" size={14} />A LITTLE SPACE TO BUILD
          </span>
          <h1>New session</h1>
          <p>Pick where the agent runs, then describe the task.</p>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <fieldset className={styles.card} disabled={busy}>
            <div className={styles.pickers}>
              <label className={`${styles.picker} ${styles.widePicker}`} data-focus-frame>
                <span className={styles.pickerIcon} style={{ color: 'var(--green)' }}>
                  <Icon name="desktopOutline" size={19} />
                </span>
                <span className={styles.pickerText}>
                  <span>COMPUTER</span>
                  <select
                    aria-label="Computer"
                    value={draft.machineId}
                    onChange={(event) =>
                      dispatch({ type: 'newDraft', value: {
                        machineId: event.target.value,
                      } })
                    }
                  >
                    {machines.map((machine) => (
                      <option key={machine.id} value={machine.id} disabled={!machine.online}>
                        {machine.name} · {machine.online ? 'online' : 'offline'}
                      </option>
                    ))}
                  </select>
                </span>
                <Icon name="chevronDown" size={14} />
              </label>
            </div>
            <div className={styles.agentSection}>
              <span className={styles.sectionLabel}>CHOOSE AN AGENT</span>
              <AgentChoices value={agent} onChange={chooseAgent} />
            </div>
            <div className={styles.pickers}>
              <button type="button" className={`${styles.picker} ${styles.pickerButton}`}
                aria-label="Choose model" onClick={() => setPicker('model')}>
                <Avatar agent={agent} size={34} />
                <span className={styles.pickerText}><span>MODEL · {agent.toUpperCase()}</span>
                  <strong>{models.find((option) => option.value === model)?.label || 'No model available'}</strong></span>
                <Icon name="chevronDown" size={14} />
              </button>
              <button type="button" className={`${styles.picker} ${styles.pickerButton}`}
                aria-label="Choose effort" disabled={!efforts.length} onClick={() => setPicker('model')}>
                <span className={styles.pickerIcon} style={{ color: 'var(--accent-soft)' }}><Icon name="sparklesOutline" size={19} /></span>
                <span className={styles.pickerText}><span>REASONING EFFORT</span><strong>{effortLabel(effort)}</strong></span>
                <Icon name="chevronDown" size={14} />
              </button>
              <label className={`${styles.picker} ${styles.widePicker} ${styles.permissionPicker}`} data-focus-frame>
                <span className={styles.pickerIcon} style={{ color: 'var(--accent-soft)' }}>
                  <Icon name="shieldCheckmarkOutline" size={19} />
                </span>
                <span className={styles.pickerText}>
                  <span>PERMISSION MODE</span>
                  <select aria-label="Permission mode" required value={permissionMode}
                    onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }} onChange={(event) => {
                    const value = event.target.value;
                    dispatch({ type: 'rememberPermission', key: preferenceKey, value });
                    dispatch({ type: 'newDraft', value: { permissionMode: value } });
                  }}>
                    {permissions.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
                  </select>
                </span>
                <Icon name="chevronDown" size={14} />
              </label>
              <div className={`${styles.picker} ${styles.workspacePicker} ${draft.type === 'Simple' ? styles.widePicker : ''}`} data-focus-frame>
                <span className={styles.pickerIcon} style={{ color: '#60a5fa' }}>
                  <Icon name="folderOutline" size={19} />
                </span>
                <span className={styles.pickerText}>
                  <span>WORKSPACE</span>
                  <input
                    aria-label="Folder"
                    value={draft.path}
                    onChange={(event) =>
                      dispatch({ type: 'newDraft', value: { path: event.target.value } })
                    }
                    placeholder="~/Developer/project"
                  />
                  <button type="button" className={styles.browseWorkspaces} aria-label="Choose workspace" onClick={() => setPicker('workspace')}>
                    {workspaces.length ? `${workspaces.length} recent workspace${workspaces.length === 1 ? '' : 's'}` : 'Choose a recent workspace'}
                    <Icon name="chevronDown" size={12} />
                  </button>
                </span>
                <button type="button" className={styles.workspaceIconButton} aria-label="Browse recent workspaces" onClick={() => setPicker('workspace')}>
                  <Icon name="folderOutline" size={17} />
                </button>
              </div>
              {draft.type === 'Worktree' && (
                <label className={styles.picker} data-focus-frame>
                  <span className={styles.pickerIcon} style={{ color: 'var(--accent-soft)' }}>
                    <Icon name="gitBranchOutline" size={19} />
                  </span>
                  <span className={styles.pickerText}>
                    <span>WORKTREE</span>
                    <input
                      aria-label="Worktree"
                      value={draft.worktree}
                      onChange={(event) =>
                        dispatch({ type: 'newDraft', value: { worktree: event.target.value } })
                      }
                      list="worktrees"
                      placeholder="Branch name or existing worktree path"
                    />
                    <datalist id="worktrees">
                      {mode === 'demo' && (
                        <>
                          <option value="main" />
                          <option value="feat/new-worktree" />
                        </>
                      )}
                    </datalist>
                  </span>
                  <Icon name="chevronDown" size={14} />
                </label>
              )}
            </div>
            <div className={styles.segments}>
              <Segment
                label="Session type"
                value={draft.type}
                options={[
                  { value: 'Simple', label: 'Simple' },
                  { value: 'Worktree', label: 'Worktree' },
                ]}
                onChange={(type) => dispatch({ type: 'newDraft', value: { type } })}
              />
            </div>
            <div className={styles.inputWell} data-focus-frame>
              <textarea
                ref={taskInput}
                aria-label="Task description"
                placeholder="What should the agent do?"
                value={draft.prompt}
                onChange={(event) =>
                  dispatch({ type: 'newDraft', value: { prompt: event.target.value } })
                }
                onKeyDown={keyDown}
                rows={4}
              />
              {attachments.length > 0 && (
                <div className={styles.attached}>
                  {attachments.map((file, index) => (
                    <button
                      type="button"
                      key={`${file.name}-${index}`}
                      onClick={() => setAttachments((files) => files.filter((_, i) => i !== index))}
                      aria-label={`Remove ${file.name}`}
                    >
                      <Icon name="documentTextOutline" size={12} />
                      {file.name}
                      <Icon name="close" size={12} />
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.inputActions}>
                <input
                  ref={fileInput}
                  type="file"
                  accept={mode === 'live' ? 'image/png,image/jpeg,image/gif,image/webp' : undefined}
                  aria-label="Choose new session images"
                  multiple
                  hidden
                  onChange={(event) => {
                    try {
                      const files = Array.from(event.target.files || []);
                      setAttachments(mode === 'live' ? selectedImages(files, attachments) : [...attachments, ...files].slice(0, 5));
                      setError('');
                    } catch (error) { setError(error instanceof Error ? error.message : 'Could not attach images.'); }
                    event.target.value = '';
                  }}
                />
                <Button
                  className={styles.attach}
                  icon="attachOutline"
                  variant="ghost"
                  aria-label="Attach files to new session"
                  title={mode === 'live' ? 'Attach images (up to 20, smaller than 10 MB each)' : undefined}
                  onClick={() => fileInput.current?.click()}
                />
                <span>{models.find((option) => option.value === model)?.label || 'No model available'}{effort ? ` · ${effortLabel(effort)}` : ''}</span>
                <button className={styles.start} type="submit" disabled={busy || !model}>
                  {busy ? (
                    <>
                      <Spinner />
                      Starting…
                    </>
                  ) : (
                    <>
                      Start
                      <Icon name="arrowForward" size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </fieldset>
          {error && (
            <p className={styles.error} role="alert">
              <Icon name="warningOutline" size={15} />
              {error}
            </p>
          )}
        </form>
        <p className={styles.footnote}>
          <Icon name="shieldCheckmarkOutline" size={13} />
          {mode === 'demo'
            ? 'Local demo. Sessions and messages stay in this browser.'
            : 'Starts a real agent on the selected computer. Images are encrypted before upload.'}
        </p>
      </div>
      {picker === 'model' && <LazyBoundary><NewModelPicker agent={agent} model={model} models={models}
        effort={effort} efforts={efforts} onAgent={chooseAgent} onModel={chooseModel}
        onEffort={(value) => rememberChoice(resolveModelChoice(metadata, [{ model, effort: value }]))} onClose={() => setPicker(null)} /></LazyBoundary>}
      {picker === 'workspace' && <LazyBoundary><WorkspacePicker options={workspaces} path={draft.path}
        machineName={machine?.name || 'Selected computer'} onSelect={chooseWorkspace} onClose={() => setPicker(null)} /></LazyBoundary>}
    </section>
  );
}
