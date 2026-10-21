import { Button, Icon, Spinner } from '../components/ui';
import type { History } from '../happy/normalize';
import styles from './chat.module.css';

export function ChatHistoryStatus({ history, offline, retry, loadEarlier }: {
  history?: History; offline?: boolean; retry: () => void; loadEarlier: () => void;
}) {
  if (!history) return null;
  const failed = !!history.error && !offline && !history.loading;
  const older = history.direction === 'older';
  return <>
    {history.hasMore && <Button className={styles.historyEarlier} variant="ghost" icon="chevronUp"
      disabled={history.loading || offline} onClick={loadEarlier}>Load earlier messages</Button>}
    {history.loading && !offline && (
      <div className={styles.historyLoading} role="status" aria-label="Load messages">
        <span aria-hidden="true"><Spinner /></span>
        <span>{older ? 'Loading earlier messages…' : history.loaded ? 'Updating messages…' : 'Loading messages…'}</span>
      </div>
    )}
    {failed && (
      <section className={styles.historyNotice} role="alert" aria-label="Message history unavailable">
        <Icon name="cloudOfflineOutline" size={18} />
        <div className={styles.historyText}>
          <strong>{older ? 'Could not load earlier messages' : history.loaded ? 'Could not update messages' : 'Could not load messages'}</strong>
          <p>{history.loaded
            ? older ? 'Your loaded messages are still here. Try again to load the earlier messages.'
              : 'Your loaded messages are still here. Try again to get the latest replies.'
            : 'Try again to load this conversation. Your draft stays on this device.'}</p>
          <details>
            <summary>Technical details</summary>
            <pre>{history.error}</pre>
          </details>
        </div>
        <Button variant="ghost" icon="refreshOutline" aria-label="Retry messages" onClick={retry}>Try again</Button>
      </section>
    )}
  </>;
}
