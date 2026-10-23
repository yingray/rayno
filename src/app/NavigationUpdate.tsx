import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Icon } from '../components/ui';
import { useEventCallback } from '../components/useEventCallback';
import { useDemo } from '../data/store';
import { useText } from '../i18n';
import { checkForUpdate, forceUpdate, type BuildInfo, type UpdateCheck } from './appUpdate';
import styles from './app.module.css';

const CHECK_INTERVAL = 5 * 60 * 1000;
const DISMISSED_UPDATE = 'rayno.dismissedUpdate';
const OFFLINE = 'Cannot check for updates. Check your connection.';

export function useNavigationUpdate() {
  const t = useText();
  const notify = useDemo(store => store.notify);
  const [latest, setLatest] = useState<BuildInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const request = useRef<Promise<UpdateCheck> | null>(null);
  const updating = useRef(false);
  const alive = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  const dismissed = useRef('');
  useEffect(() => {
    try { dismissed.current = sessionStorage.getItem(DISMISSED_UPDATE) || ''; } catch { /* Use this visit's state. */ }
  }, []);
  const check = useEventCallback(async (manual = false) => {
    if (request.current || updating.current) return;
    setChecking(true);
    const pending = navigator.onLine ? checkForUpdate() : Promise.resolve<UpdateCheck>({ status: 'offline' });
    request.current = pending;
    try {
      const result = await pending;
      if (!alive.current) return;
      if (result.status === 'available') {
        setLatest(result.latest);
        if (dismissed.current !== result.latest.commit) setOpen(true);
      } else if (result.status === 'current') {
        setLatest(null); setOpen(false);
        if (manual) notify(t('This is the latest version'));
      } else if (manual) notify(t(OFFLINE));
    } finally {
      request.current = null;
      if (alive.current) setChecking(false);
    }
  });
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void check();
    };
    refresh();
    const timer = window.setInterval(refresh, CHECK_INTERVAL);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive.current = false; window.clearInterval(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [check]);
  const dismiss = () => {
    if (latest) {
      dismissed.current = latest.commit;
      try { sessionStorage.setItem(DISMISSED_UPDATE, latest.commit); } catch { /* Keep the in-memory dismissal. */ }
    }
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  const install = async () => {
    if (updating.current) return;
    updating.current = true; setInstalling(true);
    try {
      const result = await forceUpdate();
      if (alive.current && result.status === 'offline') notify(t(OFFLINE));
    } catch {
      if (alive.current) notify(t('Could not update Rayno. Try again.'));
    } finally {
      updating.current = false;
      if (alive.current) setInstalling(false);
    }
  };
  return { latest, open, checking, installing, button, dismiss, check, install };
}
export type NavigationUpdateState = ReturnType<typeof useNavigationUpdate>;

export function UpdateIcon({ update, mobile = false }: { update: NavigationUpdateState; mobile?: boolean }) {
  const t = useText();
  if (!update.latest) return null;
  return <button ref={update.button} type="button" className={mobile ? styles.tabUpdate : styles.navItem}
    aria-label={t('Update Rayno')} aria-busy={update.checking || update.installing}
    title={t('Update Rayno')}
    disabled={update.checking || update.installing} data-update-available
    onClick={() => void update.install()}>
    <Icon name="refreshOutline" size={mobile ? 20 : 21} />
    <span>{t('Updates')}</span>
    <span className={styles.navBadge} role="img" aria-label={t('Update available')} />
  </button>;
}

export function UpdateNotice({ update, expanded }: { update: NavigationUpdateState; expanded: boolean }) {
  const t = useText();
  if (!update.latest || !update.open) return null;
  const escape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); update.dismiss(); }
  };
  return <section className={styles.updateNotice} role="region" aria-label={t('Rayno update')} data-expanded={expanded || undefined} onKeyDown={escape}>
    <header><strong role="status">{t('A Rayno update is ready.')}</strong>
      <Button icon="close" aria-label={t('Dismiss update notification')} onClick={update.dismiss} />
    </header>
    <p>{t('Update now reloads Rayno. Drafts, sessions, and preferences stay on this device.')}</p>
    <Button variant="accent" disabled={update.installing || update.checking} onClick={() => void update.install()}>
      {t(update.installing ? 'Installing the latest version…' : 'Reload and update')}
    </Button>
  </section>;
}
