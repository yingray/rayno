import { useText } from "../i18n";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog } from '../components/ui';
import { useDemo } from '../data/store';
import type { Machine } from '../data/types';
import { messageError } from '../happy/errors';
import styles from './management.module.css';

export function MachineManagement({ machine }: { machine: Machine }) {
  const t = useText();
  const { live, connection, offline, notify } = useDemo(store => ({ live: store.live, connection: store.snapshot?.connection, offline: store.snapshot?.offline, notify: store.notify }));
  const navigate = useNavigate();
  const [action, setAction] = useState<'rename' | 'stop' | 'delete' | null>(null);
  const [name, setName] = useState(machine.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!live) return null;
  const unavailable = connection !== 'connected' || !!offline;
  const close = () => { if (!busy) { setAction(null); setError(''); } };
  const title = action === 'rename' ? 'Rename computer' : action === 'stop' ? 'Stop daemon?' : 'Remove computer?';
  async function submit() {
    if (busy || !action || unavailable) return;
    setBusy(true); setError('');
    try {
      if (action === 'rename') await live!.renameMachine(machine.id, name);
      if (action === 'stop') await live!.stopDaemon(machine.id);
      if (action === 'delete') await live!.deleteMachine(machine.id);
      notify(action === 'rename' ? 'Computer renamed.' : action === 'stop' ? 'Daemon stopped.' : 'Computer removed.');
      setAction(null);
      if (action === 'delete') navigate('/monitor');
    } catch (error) { setError(messageError(error)); }
    finally { setBusy(false); }
  }
  return <section className={styles.card} aria-label={t("Computer management")}>
    <h2>{t("Computer management")}</h2><div className={styles.actions}>
      <Button disabled={unavailable} icon="pencilOutline" onClick={() => { setName(machine.name); setAction('rename'); }}>{t("Rename computer")}</Button>
      <Button disabled={unavailable || !machine.online} icon="stopCircleOutline" onClick={() => setAction('stop')}>{t("Stop daemon")}</Button>
      <Button disabled={unavailable} icon="trashOutline" onClick={() => setAction('delete')}>{t("Remove computer")}</Button>
    </div>
    {action && <Dialog title={t(title)} onClose={close}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {action === 'rename' ? <label>{t("Computer name")}<input autoFocus aria-label={t("Computer name")} maxLength={200} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
          : <p>{action === 'stop' ? t('Stop the Happy daemon on {name}? You must start it on that computer before remote computer actions work again.', {name:machine.name})
            : t('Remove {name} from your Happy account? Session history stays available. This action does not delete files on the computer.', {name:machine.name})}</p>}
        {error && <p role="alert">{error}</p>}
        <footer><Button disabled={busy} onClick={close}>{t("Cancel")}</Button><Button type="submit" variant="accent" disabled={busy || unavailable || (action === 'rename' && !name.trim())}>
          {busy ? t("Wait…") : action === 'rename' ? t("Save") : action === 'stop' ? t("Stop daemon") : t("Remove computer")}</Button></footer>
      </form>
    </Dialog>}
  </section>;
}
