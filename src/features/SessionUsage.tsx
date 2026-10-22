import { memo, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Icon, Spinner } from '../components/ui';
import { useMinuteNow } from '../components/useMinuteNow';
import { useDemo } from '../data/store';
import type { Agent, UsageReading, UsageWindow } from '../data/types';
import styles from './sessionUsage.module.css';

const agents: Agent[] = ['Claude', 'Codex'];
// The compact summary shows the weekly window. A provider without one shows its 5-hour window, as Happy's usage popup does.
const mainWindow = (reading: UsageReading) => reading.week ?? reading.fiveHour;
const mainLabel = (reading: UsageReading) => (reading.week ? 'weekly' : '5-hour');

export const SessionUsage = memo(function SessionUsage() {
  const location = useLocation();
  const sessionId = location.pathname.split('/')[2];
  const { mode, usage, live, usageLoading, usageErrors, connection, machines, agent, machineId, adapter } = useDemo((store) => {
    const session = store.state.sessions.find((item) => item.id === sessionId);
    return { mode: store.mode, usage: store.usage, live: store.live, usageLoading: store.snapshot?.usageLoading,
      usageErrors: store.snapshot?.usageErrors, connection: store.snapshot?.connection,
      machines: store.machines, agent: session?.agent, machineId: session?.machineId, adapter: store.adapter };
  });
  const navigate = useNavigate();
  const now = useMinuteNow();
  const [open, setOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const loading = usageLoading || demoLoading;
  const canRead = mode === 'demo' || (machines.some((machine) => machine.online) && connection === 'connected');

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  function stale(reading: UsageReading) {
    const resetAt = mainWindow(reading).resetAt;
    return reading.stale || (reading.capturedAt && now - reading.capturedAt > 15 * 60000) ||
      (resetAt && resetAt <= now) ||
      (reading.machineId && !machines.some((machine) => machine.id === reading.machineId && machine.online));
  }
  function tone(reading: UsageReading, window: UsageWindow = mainWindow(reading)) {
    if (stale(reading) || (window.resetAt && window.resetAt <= now)) return 'var(--muted)';
    const ahead = window.pacePercent === null ? 0 : window.usedPercent - window.pacePercent;
    return window.usedPercent >= 100 || ahead > 10 ? 'var(--red)' : ahead > 3 ? 'var(--orange)' : '';
  }
  function latest(agent: Agent) {
    return usage.filter((reading) => reading.agent === agent).sort((a, b) =>
      Number(b.machineId === machineId) - Number(a.machineId === machineId) ||
      Number(!!stale(a)) - Number(!!stale(b)) || (b.capturedAt || 0) - (a.capturedAt || 0),
    )[0];
  }
  function bar(reading: UsageReading, window: UsageWindow = mainWindow(reading), label = mainLabel(reading)) {
    return (
      <span className={styles.bar} role="meter" aria-label={`${reading.agent} ${label} usage`}
        aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100}>
        <span className={styles.track}><span style={{ width: `${window.usedPercent}%`, background: tone(reading, window) || undefined }} /></span>
        {window.pacePercent !== null && <i style={{ left: `${window.pacePercent}%` }} />}
      </span>
    );
  }
  function windowRow(reading: UsageReading, window: UsageWindow, name: string, label: string) {
    return (
      <div className={styles.window}>
        <div><span>{name}</span><b style={{ color: tone(reading, window) || undefined }}>{window.usedPercent}% used</b></div>
        {bar(reading, window, label)}
        <p>Resets {window.reset}</p>
      </div>
    );
  }
  async function refresh() {
    if (loading || !canRead) return;
    if (live) await live.refreshUsage();
    else {
      setDemoLoading(true);
      try { await adapter.refreshMonitor(); }
      finally { setDemoLoading(false); }
    }
  }

  return (
    <footer ref={root} className={styles.usage} aria-label="Agent usage">
      {open && (
        <section id={id} className={styles.details} aria-label="Usage details">
          <header>
            <div><h2>Agent usage</h2><p>{mode === 'demo' ? 'Sample plan readings' : '5-hour and weekly plan limits'}</p></div>
            <Button icon={loading ? undefined : 'refreshOutline'} aria-label="Refresh usage"
              disabled={loading || !canRead} onClick={() => void refresh()}>
              {loading && <Spinner />}
            </Button>
          </header>
          {agents.map((agent) => {
            const readings = usage.filter((reading) => reading.agent === agent);
            return readings.length ? readings.map((reading) => (
              <div className={styles.reading} key={`${agent}:${reading.machineId || ''}`}>
                <div><strong>{agent}</strong><span>{reading.machineName || (mode === 'demo' ? 'Demo' : 'Computer not reported')}</span></div>
                {reading.fiveHour && windowRow(reading, reading.fiveHour, '5-hour limit', '5-hour')}
                {reading.week && windowRow(reading, reading.week, 'Weekly limit', 'weekly')}
                <p>{stale(reading) ? 'Stale reading · ' : ''}{mode === 'demo' ? 'Simulated data' : reading.capturedAt ? `Read ${new Date(reading.capturedAt).toLocaleString()}` : 'Not read yet'}</p>
              </div>
            )) : <p className={styles.empty} key={agent}>{agent} · {loading ? 'Reading…' : 'No usage reported'}</p>;
          })}
          {usageErrors?.map((error, index) => <p className={styles.error} role="alert" key={index}>{error}</p>)}
          {!canRead && <p className={styles.empty}>Connect a computer to refresh usage.</p>}
          <p className={styles.note}>The white line marks an even pace over each window.</p>
          <Button variant="ghost" icon="pulseOutline" onClick={() => { setOpen(false); navigate('/monitor'); }}>Open Monitor</Button>
        </section>
      )}
      <button ref={trigger} className={styles.capsule} aria-label="Agent usage summary"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        {agents.map((currentAgent) => {
          const reading = latest(currentAgent);
          const main = reading && mainWindow(reading);
          const summary = reading && (reading.week
            ? `${reading.week.usedPercent}% of week used${reading.fiveHour ? ` · ${reading.fiveHour.usedPercent}% of 5 hours` : ''}`
            : `${reading.fiveHour.usedPercent}% of 5 hours used`);
          return (
            <span className={`${styles.agent} ${reading && stale(reading) ? styles.stale : ''} ${agent && agent !== currentAgent ? styles.secondary : ''}`}
              key={currentAgent} title={reading ? `${currentAgent} · ${reading.machineName || 'Demo'} · ${summary}${stale(reading) ? ' · stale' : ''}` : `${currentAgent} · No usage reported`}>
              <img className={styles.agentIcon} src={`/icons/${currentAgent === 'Claude' ? 'claude' : 'codex'}.png`} alt={currentAgent} />
              {reading ? bar(reading) : <span className={styles.bar}><span className={styles.track} /></span>}
              <b style={{ color: reading ? tone(reading) || undefined : undefined }}>{main ? `${main.usedPercent}%` : '—'}</b>
              {reading && !reading.week && <small className={styles.window5h} aria-hidden="true">5h</small>}
            </span>
          );
        })}
        {loading ? <Spinner /> : <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />}
      </button>
    </footer>
  );
});
