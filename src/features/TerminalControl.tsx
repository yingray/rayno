import { useText } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import type { Session } from '../data/types';
import { messageError } from '../happy/errors';
import styles from './chat.module.css';

// Happy Web ChatFooter.tsx: a local-mode CLI shows its permission prompts in the terminal only.
export function TerminalControl({ session, disabled }: { session: Session; disabled: boolean }) {
  const t = useText();
  const { live } = useDemo((store) => ({ live: store.live }));
  const [state, setState] = useState<'sending' | 'waiting' | null>(null);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const controlled = !!session.terminalControl;
  useEffect(() => { if (!controlled) { setState(null); setError(''); } }, [controlled]);
  useEffect(() => {
    if (state !== 'waiting') return;
    const timer = window.setTimeout(() => setState(null), 15000);
    return () => clearTimeout(timer);
  }, [state]);
  if (!live || !controlled) return null;
  async function take() {
    if (sending.current || state) return;
    sending.current = true;
    setState('sending');
    setError('');
    try {
      await live!.takeControl(session.id);
      setState('waiting');
    } catch (error) {
      setError(messageError(error));
      setState(null);
    } finally { sending.current = false; }
  }
  return <div className={styles.terminalControl} role="group" aria-label={t("Terminal control")}>
    <Icon name="terminalOutline" size={16} />
    <p role="status">
      {state === 'waiting' ? t("Waiting for the terminal…") : t("The terminal controls this session")}
      <small>{t("Permission requests show in the terminal. Send a message or take control to continue here.")}</small>
    </p>
    <Button className={styles.takeControl} disabled={disabled || !!state} onClick={() => void take()}>
      {state === 'sending' ? t("Taking control…") : t("Take control")}
    </Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
