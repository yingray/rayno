import { useText } from "../i18n";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import styles from './settings.module.css';

export function Inbox() {
  const t = useText();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const mode = useDemo((store) => store.mode);
  return (
    <section className={styles.inbox}>
      <header>
        <h1>{t("Inbox")}</h1>
        <p>{t("A few things worth a look.")}</p>
      </header>
      {dismissed || mode === 'live' ? (
        <Empty
          icon="mailOutline"
          title={mode === 'live' ? t("Notifications in the Happy app") : t("You’re all caught up")}
        >{t("New updates will have a place here. Use the Happy app for account notifications.")}</Empty>
      ) : (
        <>
          <span className={styles.inboxLabel}>{t("UPDATES · SAMPLE DATA")}</span>
          <div className={styles.inboxCard}>
            <span>
              <Icon name="sparklesOutline" size={22} />
            </span>
            <div>
              <h2>{t("Your workspace, a little lighter")}</h2>
              <p>{t("Explore the new Floating Panels layout. Every panel has its own space, from your first session to the last detail.")}</p>
              <Button
                variant="ghost"
                icon="arrowForward"
                onClick={() => navigate('/session/floating-panels')}
              >{t("Explore the conversation")}</Button>
            </div>
            <small>{t("Today")}</small>
          </div>
          <div className={styles.inboxCard}>
            <span>
              <Icon name="desktopOutline" size={22} />
            </span>
            <div>
              <h2>{t("A clear view of your agents")}</h2>
              <p>{t("Monitor brings weekly usage and computer health together in one quiet view.")}</p>
              <Button variant="ghost" icon="arrowForward" onClick={() => navigate('/monitor')}>{t("Open Monitor")}</Button>
            </div>
          </div>
          <Button className={styles.dismiss} icon="checkmark" onClick={() => setDismissed(true)}>{t("Mark all as read")}</Button>
        </>
      )}
    </section>
  );
}
