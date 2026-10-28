import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { StoreProvider } from '../data/store';
import { defaultNewDraft, defaultPreferences } from '../data/defaults';
import { restoreState } from '../data/reducer';
import type { DemoAdapter, DemoState } from '../data/types';
import { HappyClient } from './client';
import { messageError } from './errors';
import { modelChoiceKey } from './modelPreferences';
import { loginWithKey, saveCredentials, serverOrigin } from './auth';
import type { Credentials } from './auth';
import { formatRecoveryKey } from './crypto';
import { unbase64 } from './encoding';
import { Button, Mark, Spinner } from '../components/ui';
import styles from './login.module.css';
import { useUIState } from '../data/useUIState';
import { CREDENTIALS_KEY } from './credentials';
import { RecapAudioCache, activateRecapAudioCache } from './recapAudioCache';
import { requestPersistentStorageOnFirstInput } from './persistentStorage';

const emptyState = (): DemoState => ({
  version: 1,
  sessions: [],
  preferences: { ...defaultPreferences },
  drafts: {},
  newDraft: {
    machineId: '',
    path: '',
    worktree: '',
    model: '',
    permissionMode: defaultNewDraft.permissionMode,
    agent: 'Claude',
    type: 'Simple',
    prompt: '',
  },
  recentPaths: [],
});
export function LiveProvider({
  credentials,
  login,
  logout,
  switchMode,
  children,
}: PropsWithChildren<{
  credentials: Credentials;
  login: (value: Credentials) => void;
  logout: () => void;
  switchMode: () => void;
}>) {
  const [client, setClient] = useState<HappyClient | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let connection: HappyClient | null = null;
    HappyClient.create(credentials)
      .then((value) => {
        if (cancelled) {
          value.dispose();
          return;
        }
        connection = value;
        setClient(value);
        value.start();
      })
      .catch((error) => {
        if (!cancelled) setError(messageError(error));
      });
    return () => {
      cancelled = true;
      connection?.dispose();
    };
  }, [credentials]);
  if (!client)
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <Mark />
          <h1>{error ? 'Could not open Rayno' : 'Open your workspace'}</h1>
          {error ? <p role="alert">{error}</p> : <Spinner />}
          <Button onClick={logout}>Back to sign in</Button>
        </div>
      </div>
    );
  return (
    <Connected client={client} login={login} logout={logout} switchMode={switchMode}>
      {children}
    </Connected>
  );
}
function Connected({
  client,
  login,
  logout,
  switchMode,
  children,
}: PropsWithChildren<{
  client: HappyClient;
  login: (value: Credentials) => void;
  logout: () => void;
  switchMode: () => void;
}>) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const recapCache = useMemo(() => new RecapAudioCache(client.storageKey, client.encryption), [client]);
  useLayoutEffect(() => activateRecapAudioCache(recapCache), [recapCache]);
  // A remembered sign-in from an earlier visit: ask the browser to keep the offline data on the first click.
  useEffect(() => {
    let remembered = false;
    try { remembered = !!localStorage.getItem(CREDENTIALS_KEY); } catch { /* Storage is unavailable. */ }
    return remembered ? requestPersistentStorageOnFirstInput() : undefined;
  }, []);
  const onlineIds = snapshot.machines.filter((machine) => machine.online).map((machine) => machine.id).join(',');
  useEffect(() => {
    if (!onlineIds || snapshot.connection !== 'connected') return;
    let timer: number | undefined;
    const active = () => document.visibilityState === 'visible' && document.hasFocus();
    const refresh = (scheduled = false) => {
      if (!active()) return;
      const current = client.getSnapshot();
      if (!current.usageLoading && (scheduled || !current.usageReadAt || Date.now() - current.usageReadAt >= 60000))
        void client.refreshUsage().catch(() => { /* The snapshot retains errors and stale readings. */ });
    };
    const update = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (!active()) return;
      refresh();
      timer = window.setInterval(() => refresh(true), 60000);
    };
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [client, onlineIds, snapshot.connection]);
  const [toast, notify] = useState('');
  const save = useCallback((local: DemoState) => {
    try {
      client.writeLocal('ui', JSON.stringify({ ...local, sessions: [] }));
    } catch {
      notify('Browser storage is unavailable. Drafts last for this visit.');
    }
  }, [client]);
  const [local, dispatch, ui] = useUIState(() => {
    const fallback = emptyState();
    const restored = restoreState(client.readLocal('ui'), fallback);
    return {
      ...restored,
      sessions: [],
      newDraft: client.readLocal('ui') ? restored.newDraft : fallback.newDraft,
    };
  }, save);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => notify(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (local.newDraft.machineId || !snapshot.machines.length) return;
    const machine = snapshot.machines.find((machine) => machine.online) || snapshot.machines[0];
    dispatch({ type: 'newDraft', value: { machineId: machine.id, path: local.newDraft.path || machine.homeDir || '' } });
  }, [snapshot.machines, local.newDraft.machineId, local.newDraft.path]);
  const adapter = useMemo<DemoAdapter>(
    () => ({
      async createSession(draft, attachments, options) {
        const id = await client.createSession(draft, attachments, { ...options,
          recapMode: ui.getState().preferences.recap, recapStyle: ui.getState().preferences.recapStyle });
        dispatch({ type: 'rememberModel', key: modelChoiceKey(draft.agent, draft.machineId),
          value: { model: draft.model, effort: draft.effort || null } });
        dispatch({ type: 'rememberPermission', key: modelChoiceKey(draft.agent, draft.machineId), value: draft.permissionMode });
        dispatch({ type: 'rememberWorkspace', value: {
          machineId: draft.machineId, path: client.getMetadata(id).path || draft.path, usedAt: Date.now(),
        } });
        dispatch({ type: 'newDraft', value: { prompt: '', handoff: null } });
        return id;
      },
      async sendMessage(id, content, attachments, options) {
        const { preserveDraft, ...sendOptions } = options || {};
        await client.sendMessage(id, content, attachments, { ...sendOptions, recapMode: ui.getState().preferences.recap, recapStyle: ui.getState().preferences.recapStyle });
        if (!preserveDraft && ui.getDraft(id) === content)
          dispatch({ type: 'draft', id, value: '' });
      },
      sendRecapRequest: (id, options) =>
        client.sendRecapRequest(id, { ...options, recapMode: ui.getState().preferences.recap, recapStyle: ui.getState().preferences.recapStyle }),
      renameSession: (id, name) => client.renameSession(id, name),
      archiveSession: (id) => client.archiveSession(id),
      deleteSession: (id) => client.deleteSession(id),
      stopSession: (id) => client.stopSession(id),
      killSession: (id) => client.killSession(id),
      refreshMonitor: () => client.refreshMonitor(),
    }),
    [client, ui],
  );
  const signOut = useCallback(async () => {
    client.dispose();
    await recapCache.clear();
    await client.clearLocal();
    logout();
  }, [client, logout, recapCache]);
  const recoveryKey = useMemo(() => formatRecoveryKey(unbase64(client.credentials.secret)), [client]);
  // The new server must accept the account before Rayno leaves the current one.
  // The preferences move to the new server. The cached sessions of the old server are cleared, as on sign-out.
  const changeServer = useCallback(async (value: string) => {
    const server = serverOrigin(value);
    if (server === client.credentials.server) return;
    const next = await loginWithKey(server, client.credentials.secret);
    let remember = false;
    try { remember = !!localStorage.getItem(CREDENTIALS_KEY); } catch { /* Storage is unavailable. */ }
    const nextKey = await HappyClient.storageKeyFor(next);
    const preferences = ui.getState().preferences;
    client.dispose();
    await recapCache.clear();
    await client.clearLocal();
    saveCredentials(next, remember);
    try {
      (remember ? localStorage : sessionStorage).setItem(`${nextKey}ui`, JSON.stringify({ ...emptyState(), preferences }));
    } catch { /* The new server starts with the default preferences. */ }
    login(next);
  }, [client, login, recapCache, ui]);
  const reset = useCallback(() => dispatch({ type: 'reset', state: emptyState() }), []);
  return (
    <StoreProvider
      value={{
        mode: 'live',
        state: { ...local, sessions: snapshot.sessions },
        ui,
        dispatch,
        adapter,
        machines: snapshot.machines,
        usage: snapshot.usage,
        live: client,
        snapshot,
        server: client.credentials.server,
        recoveryKey,
        changeServer,
        toast,
        notify,
        logout: signOut,
        switchMode,
        reset,
      }}
    >
      {children}
    </StoreProvider>
  );
}
