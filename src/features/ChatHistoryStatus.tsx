import { useText } from "../i18n";
import { Button, Icon, Spinner } from '../components/ui';
import type { History } from '../happy/normalize';
import styles from './chat.module.css';

export function ChatHistoryStatus({ history, offline, retry, loadEarlier }: {
  history?: History; offline?: boolean; retry: () => void; loadEarlier: () => void;
}) {
  const t = useText();
  if (!history) return null;
  const older = history.direction === 'older';
  // A loaded chat shows its newer-message sync in the shared status area, so the messages do not move.
  const inline = !history.loaded || older;
  const failed = inline && !!history.error && !offline && !history.loading;
  return <>
    {history.hasMore && <Button className={styles.historyEarlier} variant="ghost" icon="chevronUp"
      disabled={history.loading || offline} onClick={loadEarlier}>{t("Load earlier messages")}</Button>}
    {inline && history.loading && !offline && (
      <div className={styles.historyLoading} role="status" aria-label={t("Load messages")}>
        <span aria-hidden="true"><Spinner /></span>
        <span>{older ? t("Loading earlier messages…") : t("Loading messages…")}</span>
      </div>
    )}
    {failed && (
      <section className={styles.historyNotice} role="alert" aria-label={t("Message history unavailable")}>
        <Icon name="cloudOfflineOutline" size={18} />
        <div className={styles.historyText}>
          <strong>{older ? t("Could not load earlier messages") : t("Could not load messages")}</strong>
          <p>{older ? t("Your loaded messages are still here. Try again to load the earlier messages.")
            : t("Try again to load this conversation. Your draft stays on this device.")}</p>
          <details>
            <summary>{t("Technical details")}</summary>
            <pre>{history.error}</pre>
          </details>
        </div>
        <Button variant="ghost" icon="refreshOutline" aria-label={t("Retry messages")} onClick={retry}>{t("Try again")}</Button>
      </section>
    )}
  </>;
}
