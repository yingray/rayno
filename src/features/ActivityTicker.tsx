import { memo, useEffect, useState } from 'react';
import { useText } from '../i18n';
import { Icon } from '../components/ui';
import { activitySteps, activityTiming, callEnded, elapsedClock, elapsedDuration } from '../data/toolActivity';
import type { ToolActivityBlock } from '../data/chatBlocks';
import styles from './chat.module.css';

// Only this small clock ticks. The transcript and expanded tool results stay untouched.
const ActivityClock = memo(function ActivityClock({ start }: { start: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span data-activity-clock>{elapsedClock(now - start)}</span>;
});

export function ActivityMark({ state }: { state: 'running' | 'done' | 'error' | 'unknown' | 'thinking' }) {
  return <span className={styles.activityMark} data-state={state} aria-hidden="true">
    {state === 'running' ? <span className={styles.activitySpinner} />
      : <Icon name={state === 'done' ? 'checkmarkCircle' : state === 'error' ? 'warningOutline' : state === 'thinking' ? 'sparklesOutline' : 'ellipseOutline'} size={14} />}
  </span>;
}

export function ActivityTicker({ block, active, expanded }: { block: ToolActivityBlock; active: boolean; expanded: boolean }) {
  const t = useText();
  const steps = activitySteps(block), timing = activityTiming(block);
  const current = steps.findLast(step => !callEnded(step.call)) ?? steps.at(-1);
  const position = current ? steps.indexOf(current) : -1, previous = steps[position - 1];
  const duration = block.duration ?? (timing.start !== undefined && timing.end !== undefined
    ? elapsedDuration(timing.end - timing.start) : undefined);
  const chevron = <Icon name={expanded ? 'chevronDown' : 'chevronForwardOutline'} size={13} />;
  return active && current ? <>
    <ActivityMark state={current.call?.isError ? 'error' : callEnded(current.call) ? 'done' : 'running'} />
    <span className={styles.activityLines} key={current.call?.id ?? current.index}>
      {previous && <span className={styles.activityPrevious} title={previous.label}>{previous.label}</span>}
      <span className={styles.activityCurrent}>{current.label}</span>
    </span>
    <span className={styles.activityStep}>{t('Step {step}', { step: String(position + 1) })}
      {timing.start !== undefined && <> · <ActivityClock start={timing.start} /></>}
    </span>{chevron}
  </> : <>{chevron}<span>{duration ? t('Worked for {duration}', { duration }) : t('Tool activity')}
    {' · '}{steps.length} {steps.length === 1 ? t('tool') : t('tools')}</span></>;
}

export function ActivityWaiting({ agent, simulated = false }: { agent: string; simulated?: boolean }) {
  const t = useText();
  return <div className={styles.activityWaiting} role="status" data-activity-waiting>
    <ActivityMark state="running" /><span><span>{agent} {t('is working')}</span>
      <small>{t('Waiting for the first step')}</small></span>
    {simulated && <span className={styles.simulated}>{t('Simulated')}</span>}
  </div>;
}
