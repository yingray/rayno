import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, copyText, Mark, Spinner } from '../components/ui';
import { loginWithKey, readLastServer, saveCredentials, serverOrigin, startPairing } from './auth';
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

function InstallGuide({ onContinue }: { onContinue: () => void }) {
  return (
    <section className={styles.install} aria-label="How to install">
      <p>Set up Happy on your computer, then connect your agents to Rayno.</p>
      <ol className={styles.steps} role="list">
        <li>
          <h2>Create a Happy account</h2>
          <p>
            Open the Happy app and select <strong>Create account</strong>.
          </p>
          <div className={styles.appLinks}>
            <a href="https://app.happy.engineering" target="_blank" rel="noopener noreferrer">
              Web app
            </a>
            <a
              href="https://apps.apple.com/us/app/happy-claude-code-client/id6748571505"
              target="_blank"
              rel="noopener noreferrer"
            >
              iOS
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.ex3ndr.happy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Android
            </a>
          </div>
        </li>
        <li>
          <h2>Install the Happy CLI</h2>
          <p>
            Use a computer with Node.js and npm. Install Claude Code or Codex, and sign in to that agent.
          </p>
          <InstallCommand command="npm install -g happy" />
        </li>
        <li>
          <h2>Connect your computer</h2>
          <p>Open a terminal in your project folder. Start one agent:</p>
          <InstallCommand command="happy claude" />
          <p className={styles.alternative}>Or use Codex:</p>
          <InstallCommand command="happy codex" />
          <p>On first use, scan the terminal QR code with the Happy app and approve the request.</p>
        </li>
      </ol>
      <p>Then sign in to Rayno with the same Happy account. Your sessions will appear here.</p>
      <Button variant="accent" onClick={onContinue}>
        Continue to sign in
      </Button>
    </section>
  );
}

export function Login({
  onLogin,
  onDemo,
}: {
  onLogin: (credentials: Credentials) => void;
  onDemo: () => void;
}) {
  // `server` drives pairing; `serverDraft` follows typing and commits on blur, Enter, or submit.
  const [server, setServer] = useState(readLastServer);
  const [serverDraft, setServerDraft] = useState(server);
  const [serverInvalid, setServerInvalid] = useState(false);
  const [view, setView] = useState<'install' | 'signin'>('install');
  const [method, setMethod] = useState<'qr' | 'key'>('qr');
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState<{ uri: string; approval: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (view !== 'signin' || method !== 'qr') return;
    const controller = new AbortController();
    setCode(null);
    setError('');
    let origin: string;
    try {
      origin = serverOrigin(server);
    } catch (error) {
      setError(messageError(error));
      return;
    }
    startPairing(origin, controller.signal, (uri, approval) => setCode({ uri, approval }))
      .then((credentials) => {
        if (controller.signal.aborted) return;
        saveCredentials(credentials, remember);
        onLogin(credentials);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(messageError(error));
      });
    return () => controller.abort();
  }, [view, method, server, revision, remember, onLogin]);
  function commitServer(): string | null {
    try {
      const origin = serverOrigin(serverDraft);
      setServerDraft(origin);
      setServer(origin);
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
  async function submit() {
    if (busy) return;
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
        <p>Connect this independent client to your Happy account.</p>
        <div className={styles.tabs} role="group" aria-label="Setup and sign in">
          <Button
            variant={view === 'install' ? 'accent' : 'ghost'}
            aria-pressed={view === 'install'}
            onClick={() => setView('install')}
          >
            How to install
          </Button>
          <Button
            variant={view === 'signin' ? 'accent' : 'ghost'}
            aria-pressed={view === 'signin'}
            onClick={() => setView('signin')}
          >
            Sign in
          </Button>
        </div>
        {view === 'install' ? (
          <InstallGuide onContinue={() => setView('signin')} />
        ) : (
          <section className={styles.signIn} aria-label="Sign in">
            <h2>Choose a sign-in method</h2>
            <div className={styles.methods} role="group" aria-label="Sign-in method">
              <Button
                variant={method === 'qr' ? 'default' : 'ghost'}
                aria-pressed={method === 'qr'}
                onClick={() => setMethod('qr')}
              >
                Scan QR code
              </Button>
              <Button
                variant={method === 'key' ? 'default' : 'ghost'}
                aria-pressed={method === 'key'}
                onClick={() => setMethod('key')}
              >
                Recovery key
              </Button>
            </div>
            {method === 'qr' ? (
              <div className={styles.pairing}>
                <div className={styles.qr}>
                  {code ? (
                    <QRCodeSVG
                      value={code.uri}
                      size={200}
                      level="M"
                      title="Authorize Rayno in Happy"
                    />
                  ) : error ? (
                    <span>Code unavailable</span>
                  ) : (
                    <Spinner />
                  )}
                </div>
                <p>
                  In your signed-in Happy app, open Settings → Account → Link New Device.
                  Scan this code and approve this browser.
                </p>
                <Button
                  variant="ghost"
                  icon="refreshOutline"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  New QR code
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <p>
                  In the Happy app, open Settings → Account → Secret Key. Copy the key and paste it below.
                </p>
                <label className={styles.field}>
                  Happy recovery key
                  <textarea
                    aria-label="Happy recovery key"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    rows={3}
                    placeholder="Paste your account recovery key"
                    required
                  />
                </label>
                <Button variant="accent" type="submit" disabled={busy || !secret.trim()}>
                  {busy ? <Spinner /> : 'Connect account'}
                </Button>
              </form>
            )}
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
            <details>
              <summary>Happy server</summary>
              <label className={styles.field}>
                Server address
                <input
                  type="url"
                  aria-label="Happy server"
                  value={serverDraft}
                  onChange={(event) => setServerDraft(event.target.value)}
                  onBlur={() => {
                    if (serverDraft !== server || serverInvalid) commitServer();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    commitServer();
                  }}
                />
              </label>
            </details>
          </section>
        )}
        <footer>
          <button onClick={onDemo}>Explore the demo</button>
        </footer>
      </section>
    </main>
  );
}
