import { useText } from '../i18n';
import styles from './workspaceSkeleton.module.css';

export function SessionListSkeleton() {
  const t = useText();
  return <div role="status" aria-label={t('Read your sessions…')} className={styles.sessions}>
    {Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.row} aria-hidden="true"><i /></div>)}
  </div>;
}

export function ConversationSkeleton() {
  const t = useText();
  return <div role="status" aria-label={t('Load conversation…')} className={styles.conversation}>
    <div className={styles.title} aria-hidden="true" />
    <div className={styles.message} aria-hidden="true" />
    <div className={styles.message} aria-hidden="true" />
  </div>;
}
