import { memo } from 'react';
import { useDemo } from '../data/store';
import { Icon } from './ui';
import styles from './offlineStatus.module.css';
import { useText } from '../i18n';

export const OfflineStatus = memo(function OfflineStatus({ label }: { label: string }) {
  const t=useText();
  const { present, offline, saved, loading } = useDemo((store) => ({
    present: !!store.snapshot, offline: !!store.snapshot?.offline || store.snapshot?.connection === 'disconnected',
    saved: !!store.snapshot?.cachedAt, loading: !!store.snapshot?.loading,
  }));
  if (!present || (!offline && !(saved && loading))) return null;
  return (
    <span className={styles.status} role="status" aria-label={label} data-offline-status>
      <Icon name={offline ? 'cloudOfflineOutline' : 'refreshOutline'} size={14} />
      <span>{offline
        ? saved ? t('Offline · saved on this device') : t('Offline · no saved data yet')
        : t('Saved on this device · updating…')}</span>
    </span>
  );
});
