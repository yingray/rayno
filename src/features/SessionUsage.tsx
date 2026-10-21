import { memo, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Icon, Spinner } from '../components/ui';
import { useMinuteNow } from '../components/useMinuteNow';
import { useDemo } from '../data/store';
import type { Agent, UsageReading } from '../data/types';
import styles from './sessionUsage.module.css';

const agents: Agent[] = ['Claude', 'Codex'];

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
    return reading.stale || (reading.capturedAt && now - reading.capturedAt > 15 * 60000) ||
      (reading.resetAt && reading.resetAt <= now) ||
      (reading.machineId && !machines.some((machine) => machine.id === reading.machineId && machine.online));
  }
  function tone(reading: UsageReading) {
    if (stale(reading)) return 'var(--muted)';
    const ahead = reading.pacePercent === null ? 0 : reading.usedPercent - reading.pacePercent;
    return reading.usedPercent >= 100 || ahead > 10 ? 'var(--red)' : ahead > 3 ? 'var(--orange)' : '';
  }
  function latest(agent: Agent) {
    return usage.filter((reading) => reading.agent === agent).sort((a, b) =>
      Number(b.machineId === machineId) - Number(a.machineId === machineId) ||
      Number(!!stale(a)) - Number(!!stale(b)) || (b.capturedAt || 0) - (a.capturedAt || 0),
    )[0];
  }
  function bar(reading: UsageReading) {
    return (
      <span className={styles.bar} role="meter" aria-label={`${reading.agent} weekly usage`}
        aria-valuenow={reading.usedPercent} aria-valuemin={0} aria-valuemax={100}>
        <span className={styles.track}><span style={{ width: `${reading.usedPercent}%`, background: tone(reading) || undefined }} /></span>
        {reading.pacePercent !== null && <i style={{ left: `${reading.pacePercent}%` }} />}
      </span>
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
            <div><h2>Agent usage</h2><p>{mode === 'demo' ? 'Sample weekly readings' : 'Weekly plan limits'}</p></div>
            <Button icon={loading ? undefined : 'refreshOutline'} aria-label="Refresh usage"
              disabled={loading || !canRead} onClick={() => void refresh()}>
              {loading && <Spinner />}
            </Button>
          </header>
          {agents.map((agent) => {
            const readings = usage.filter((reading) => reading.agent === agent);
            return readings.length ? readings.map((reading) => (
              <div className={styles.reading} key={`${agent}:${reading.machineId || ''}`}>
                <div><strong>{agent}</strong><b style={{ color: tone(reading) || undefined }}>{reading.usedPercent}% used</b></div>
                {bar(reading)}
                <p>{reading.machineName || (mode === 'demo' ? 'Demo' : 'Computer not reported')}
                  {stale(reading) ? ' · Stale reading' : ''}</p>
                <p>Resets {reading.reset}</p>
                <p>{mode === 'demo' ? 'Simulated data' : reading.capturedAt ? `Read ${new Date(reading.capturedAt).toLocaleString()}` : 'Not read yet'}</p>
              </div>
            )) : <p className={styles.empty} key={agent}>{agent} · {loading ? 'Reading…' : 'No weekly usage reported'}</p>;
          })}
          {usageErrors?.map((error, index) => <p className={styles.error} role="alert" key={index}>{error}</p>)}
          {!canRead && <p className={styles.empty}>Connect a computer to refresh usage.</p>}
          <p className={styles.note}>The white line marks an even pace over 7 days.</p>
          <Button variant="ghost" icon="pulseOutline" onClick={() => { setOpen(false); navigate('/monitor'); }}>Open Monitor</Button>
        </section>
      )}
      <button ref={trigger} className={styles.capsule} aria-label="Agent usage summary"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        {agents.map((currentAgent) => {
          const reading = latest(currentAgent);
          return (
            <span className={`${styles.agent} ${reading && stale(reading) ? styles.stale : ''} ${agent && agent !== currentAgent ? styles.secondary : ''}`}
              key={currentAgent} title={reading ? `${currentAgent} · ${reading.machineName || 'Demo'} · ${reading.usedPercent}% of week used${stale(reading) ? ' · stale' : ''}` : `${currentAgent} · No weekly usage reported`}>
              <span>{currentAgent}</span>
              {reading ? bar(reading) : <span className={styles.bar}><span className={styles.track} /></span>}
              <b style={{ color: reading ? tone(reading) || undefined : undefined }}>{reading ? `${reading.usedPercent}%` : '—'}</b>
            </span>
          );
        })}
        {loading ? <Spinner /> : <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />}
      </button>
    </footer>
  );
});
