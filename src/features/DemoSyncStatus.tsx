import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import { useText } from '../i18n';
import styles from './chat.module.css';

// Controls for the sync status demo. The status itself is the same component as in live mode.
export function DemoSyncStatus() {
  const t = useText();
  const { syncDemo, showUpdateDemo } = useDemo((store) => ({ syncDemo: store.syncDemo, showUpdateDemo: store.showUpdateDemo }));
  if (!syncDemo) return null;
  const offline = syncDemo.input.offline;
  return <div className={styles.activityDemo} role="group" aria-label={t('Sync status demo')}>
    <span>{t('Simulated sync states')}</span>
    <div>
      <Button icon="refreshOutline" disabled={offline} onClick={() => syncDemo.step('resume')}>{t('Return from background')}</Button>
      <Button icon={offline ? 'wifiOutline' : 'cloudOfflineOutline'} onClick={() => syncDemo.step(offline ? 'online' : 'offline')}>
        {offline ? t('Network returns') : t('Lose the network')}
      </Button>
      <Button icon="warningOutline" disabled={offline} onClick={() => syncDemo.step('failWorkspace')}>{t('Fail the sync')}</Button>
      <Button icon="chatbubblesOutline" disabled={offline} onClick={() => syncDemo.step('failMessages')}>{t('Fail a message update')}</Button>
      <Button icon="arrowUpCircleOutline" onClick={showUpdateDemo}>{t('Show a new version')}</Button>
      <Button variant="ghost" icon="refreshOutline" onClick={() => syncDemo.step('reset')}>{t('Reset example')}</Button>
    </div>
  </div>;
}
