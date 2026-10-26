import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import type { Session } from '../data/types';
import { timelineDemoMessages } from '../data/toolTimelineDemo';
import { useText } from '../i18n';
import styles from './chat.module.css';

export function DemoToolTimeline({ session }: { session: Session }) {
  const { dispatch, ui } = useDemo(store => ({ dispatch: store.dispatch, ui: store.ui }));
  const t = useText();
  const count = session.messages.find(message => message.id === 'timeline-tools')?.tools?.length ?? 0;
  const started = session.status === 'running';
  const advance = (stage: number) => {
    const now = Date.now();
    // Reset only this example's expansion memory, preserving drafts and other sessions.
    if (stage === 0) ui.transcripts.get(session.id)?.groups.delete('tools:timeline-tools');
    dispatch({ type: 'demoActivity', id: session.id, now, status: stage === 4 ? 'idle' : 'running',
      messages: timelineDemoMessages(stage, now, stage === 0 ? [] : session.messages) });
  };
  return <section className={styles.activityDemo} aria-label={t('Timeline demo controls')}>
    <span>{t('Simulated tool execution · advance at your own pace')}</span>
    <div>
      {started ? <Button onClick={() => advance(count + 1)}>{t(count === 3 ? 'Finish demo' : 'Next step')}</Button>
        : <Button onClick={() => advance(0)}>{t(count ? 'Restart demo' : 'Start demo')}</Button>}
      {started && <Button onClick={() => advance(0)}>{t('Restart demo')}</Button>}
    </div>
  </section>;
}
