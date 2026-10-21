import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Mark, Spinner } from '../components/ui';
import { loginWithKey, readLastServer, saveCredentials, serverOrigin, startPairing } from './auth';
import type { Credentials } from './auth';
import { messageError } from './errors';
import styles from './login.module.css';

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
  const [method, setMethod] = useState<'qr' | 'key'>('qr');
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState<{ uri: string; approval: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (method !== 'qr') return;
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
  }, [method, server, revision, remember, onLogin]);
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
      <section className={styles.card} aria-label="Sign in to Rayno v2">
        <div className={styles.brand}>
          <Mark size={48} />
          <span>
            Rayno <small>v2 · Floating Panels</small>
          </span>
        </div>
        <h1>Your agents, in a new space.</h1>
        <p>Connect this independent client to your Happy account.</p>
        <div className={styles.tabs} role="group" aria-label="Sign in method">
          <Button variant={method === 'qr' ? 'accent' : 'ghost'} onClick={() => setMethod('qr')}>
            Scan QR code
          </Button>
          <Button variant={method === 'key' ? 'accent' : 'ghost'} onClick={() => setMethod('key')}>
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
                  title="Authorize Rayno v2 in Happy"
                />
              ) : error ? (
                <span>Code unavailable</span>
              ) : (
                <Spinner />
              )}
            </div>
            <p>Scan with your signed-in Happy app, then approve this browser.</p>
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
          Remember this v2 login on this device
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
        <footer>
          <button onClick={onDemo}>Explore the demo</button>
        </footer>
      </section>
    </main>
  );
}
