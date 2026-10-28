import { useRef, useState } from 'react';
import { Button, copyText, Mark, Spinner } from '../components/ui';
import { loginWithKey, readLastServer, saveCredentials, serverOrigin } from './auth';
import { requestPersistentStorage } from './persistentStorage';
import type { Credentials } from './auth';
import { messageError } from './errors';
import styles from './login.module.css';

function InstallCommand({ command }: { command: string }) {
  const [status, setStatus] = useState('');
  return (
    <div className={styles.command}>
      <div className={styles.commandLine}>
        <code>{command}</code>
        <Button
          variant="ghost"
          icon="copyOutline"
          aria-label={`Copy ${command}`}
          onClick={() => void copyText(command, setStatus)}
        >
          Copy
        </Button>
      </div>
      <span className={styles.copyStatus} role="status">
        {status}
      </span>
    </div>
  );
}

const INSTALL_COMMAND = 'git clone https://github.com/yingray/happy.git ~/happy && ~/happy/.rayno/install.sh';

export function Login({
  onLogin,
  onDemo,
}: {
  onLogin: (credentials: Credentials) => void;
  onDemo: () => void;
}) {
  // The field follows typing. The address is checked and normalized on blur, Enter, or submit.
  const [serverDraft, setServerDraft] = useState(readLastServer);
  const [serverInvalid, setServerInvalid] = useState(false);
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function commitServer(): string | null {
    try {
      const origin = serverOrigin(serverDraft);
      setServerDraft(origin);
      if (serverInvalid) {
        setServerInvalid(false);
        setError('');
      }
      return origin;
    } catch (error) {
      setServerInvalid(true);
      setError(messageError(error));
      return null;
    }
  }
  // A remembered sign-in keeps account data on this device, so ask the browser to keep it. This runs in the click.
  const askedToKeep = useRef(false);
  function keepOfflineData() {
    if (!remember || askedToKeep.current) return;
    askedToKeep.current = true;
    requestPersistentStorage();
  }
  async function submit() {
    if (busy) return;
    keepOfflineData();
    const origin = commitServer();
    if (!origin) return;
    setBusy(true);
    setError('');
    try {
      const credentials = await loginWithKey(origin, secret);
      saveCredentials(credentials, remember);
      setSecret('');
      onLogin(credentials);
    } catch (error) {
      setError(messageError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-label="Sign in to Rayno">
        <div className={styles.brand}>
          <Mark size={48} />
          <span>Rayno</span>
        </div>
        <h1>Your agents, in a new space.</h1>
        <p>Run one command on your computer, then paste the two values that it prints.</p>
        <section className={styles.step} aria-labelledby="install-heading">
          <h2 id="install-heading">Install Happy on your Mac</h2>
          <InstallCommand command={INSTALL_COMMAND} />
          <p>
            It needs Node.js 24, pnpm, and Tailscale with HTTPS turned on. It starts your own Happy
            server and prints its address and your recovery key.
          </p>
        </section>
        <form
          className={styles.step}
          aria-labelledby="signin-heading"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 id="signin-heading">Sign in</h2>
          <label className={styles.field}>
            Happy server
            <input
              type="url"
              aria-label="Happy server"
              aria-invalid={serverInvalid || undefined}
              value={serverDraft}
              onChange={(event) => setServerDraft(event.target.value)}
              onBlur={() => commitServer()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitServer();
              }}
              placeholder="https://your-mac.your-tailnet.ts.net:3007"
              autoComplete="url"
              inputMode="url"
              spellCheck={false}
              required
            />
          </label>
          <label className={styles.field}>
            Recovery key
            <textarea
              aria-label="Happy recovery key"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              rows={3}
              placeholder="XXXXX-XXXXX-XXXXX-…"
              required
            />
          </label>
          <p className={styles.hint}>
            Already use Happy? Find your key in the Happy app under Settings → Account → Secret Key.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <label className={styles.remember} data-focus-frame>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember this login on this device
          </label>
          <Button variant="accent" type="submit" disabled={busy || !secret.trim() || !serverDraft.trim()}>
            {busy ? <Spinner /> : 'Connect account'}
          </Button>
        </form>
        <footer>
          <button onClick={onDemo}>Explore the demo</button>
        </footer>
      </section>
    </main>
  );
}
