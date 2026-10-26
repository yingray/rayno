import { memo, useCallback, useSyncExternalStore } from 'react';
import { Icon } from '../components/ui';
import { useDemo } from '../data/store';
import { sessionGitSummary } from '../data/sessionGit';
import type { Session } from '../data/types';
import { useText } from '../i18n';
import styles from './chat.module.css';

const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export function useSessionGitSummary(session: Session) {
  const { ui, demo } = useDemo(store => ({ ui: store.ui, demo: store.mode === 'demo' }));
  const subscribe = useCallback((listener: () => void) => ui.git.subscribe(session.id, listener), [ui, session.id]);
  const get = useCallback(() => ui.git.get(session.id), [ui, session.id]);
  const read = useSyncExternalStore(subscribe, get);
  return sessionGitSummary(session, read, demo);
}
export const SessionGitInfo = memo(function SessionGitInfo({ session }: { session: Session }) {
  const t = useText(), summary = useSessionGitSummary(session);
  const branch = summary.branch && summary.branch !== '—' ? summary.branch : t('Branch not reported');
  const description = summary.known ? `+${summary.additions} −${summary.deletions}${summary.readAt ? ` · ${t('Last read')} ${new Date(summary.readAt).toLocaleTimeString()}` : ''}`
    : t('Git status has not been reported. Open Session info → View changes to read it.');
  return <span className={styles.gitSummaryLine} data-session-git>
    <span className={styles.branch} title={branch}><Icon name="gitBranchOutline" size={12} />
      <span className={styles.branchName} data-session-branch>{branch}</span></span>
    {summary.known ? <span className={styles.diff} title={description} data-session-changes>
      {summary.files && !summary.additions && !summary.deletions ? <span>{summary.files} {t(summary.files === 1 ? 'file' : 'files')}</span>
        : <><i>+{number.format(summary.additions)}</i><b>−{number.format(summary.deletions)}</b></>}
    </span> : <span className={styles.gitUnknown} title={description} data-session-changes>{t('Git not read')}</span>}
  </span>;
});
