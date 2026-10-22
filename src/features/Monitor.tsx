import { useText } from "../i18n";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Empty, Icon, Spinner } from '../components/ui';
import { useDemo } from '../data/store';
import type { Machine } from '../data/types';
import styles from './monitor.module.css';
import { MachineManagement } from './MachineManagement';

function ComputerCard({
  machine,
  primary = false,
  reading = false,
}: {
  machine: Machine;
  primary?: boolean;
  reading?: boolean;
}) {
  const t = useText();
  const navigate = useNavigate();
  const [latencyLoading, setLatencyLoading] = useState(false);
  const { adapter, notify, mode, connection } = useDemo((store) => ({
    adapter: store.adapter, notify: store.notify, mode: store.mode, connection: store.snapshot?.connection,
  }));
  const connected = mode === 'demo' || connection === 'connected';
  const low =
    machine.online &&
    machine.battery !== null &&
    machine.battery < 20 &&
    machine.charging === false;
  const critical = low && machine.battery !== null && machine.battery < 10;
  return (
    <article
      className={`${styles.computerCard} ${primary ? styles.primaryComputer : ''} ${!machine.online ? styles.offlineCard : ''}`}
    >
      <button className={styles.computerHeading} onClick={() => navigate(`/machine/${machine.id}`)}>
        <Icon name="desktopOutline" size={20} />
        <h2>{machine.name}</h2>
        <span>
          <i />
          {machine.online ? t("Online") : t("Offline")}
        </span>
        <Icon name="chevronForwardOutline" size={13} />
      </button>
      {reading ? (
        <div className={styles.reading}>
          <Spinner />{t("Reading the status…")}</div>
      ) : (
        <>
          {low && (
            <div className={styles.warning}>
              <span style={{ color: critical ? 'var(--red)' : undefined }}>
                <Icon name="warningOutline" size={17} />
              </span>
              <span>
                <strong style={{ color: critical ? 'var(--red)' : undefined }}>
                  {critical ? t("Battery critically low") : t("Battery low")}
                </strong>
                <small>
                  {mode === 'live'
                    ? t("Connect this computer to power.")
                    : critical
                      ? t("Plug in now. About 12 minutes remaining.")
                      : t("Plug in the computer. About 45 minutes remaining.")}
                </small>
              </span>
            </div>
          )}
          {machine.error && (
            <p role="alert" style={{ color: '#fca5a5', padding: '0 20px', fontSize: 12 }}>
              {machine.error}
            </p>
          )}
          <div className={styles.stats}>
            <div>
              <Icon
                name={machine.charging ? "batteryChargingOutline" : "batteryHalfOutline"}
                size={18}
              />
              <span>{t("Battery")}</span>
              <strong style={{ color: low ? 'var(--orange)' : undefined }}>
                {machine.battery === null ? '—' : `${machine.battery}%`}
              </strong>
              <small>
                {machine.battery === null
                  ? t("Not reported")
                  : machine.charging === null
                    ? t("Power not reported")
                    : machine.charging
                      ? t("Connected to power")
                      : t("On battery")}
              </small>
            </div>
            <div>
              <Icon
                name={
                  machine.online
                    ? machine.network === 'Wi-Fi'
                      ? "wifiOutline"
                      : "gitNetworkOutline"
                    : "cloudOfflineOutline"
                }
                size={18}
              />
              <span>{t("Network")}</span>
              <strong>{machine.online ? machine.network : t("Offline")}</strong>
              <small>
                {machine.online
                  ? [machine.ssid, machine.ip].filter(Boolean).join(' · ') || 'Refresh to read'
                  : mode === 'demo'
                    ? t("Last seen 6 hours ago")
                    : t("Computer unavailable")}
              </small>
            </div>
            <button
              disabled={!machine.online || !connected || latencyLoading}
              aria-label={`Refresh latency for ${machine.name}`}
              onClick={async () => {
                setLatencyLoading(true);
                try {
                  await adapter.refreshMonitor();
                } catch (error) {
                  notify(error instanceof Error ? error.message : 'Could not read the status.');
                } finally {
                  setLatencyLoading(false);
                }
              }}
            >
              {latencyLoading ? <Spinner /> : <Icon name="speedometerOutline" size={18} />}
              <span>{t("Latency")}</span>
              <strong>
                {machine.online && machine.latency !== null ? `${machine.latency} ms` : '—'}
              </strong>
              <small>{t("Round trip")}</small>
            </button>
          </div>
          {mode === 'live' && machine.capturedAt && (
            <p style={{ padding: '0 20px', color: '#a1a1aa', fontSize: 11 }}>{t("Last read")}{' '}{new Date(machine.capturedAt).toLocaleTimeString()}
              {machine.online ? '' : t(" · stale")}
            </p>
          )}
        </>
      )}
    </article>
  );
}

export function Monitor() {
  const t = useText();
  const { adapter, machines, usageReadings, mode, connection, monitorErrors, usageErrors, notify } = useDemo((store) => ({
    adapter: store.adapter, machines: store.machines, usageReadings: store.usage, mode: store.mode,
    connection: store.snapshot?.connection, monitorErrors: store.snapshot?.monitorErrors,
    usageErrors: store.snapshot?.usageErrors, notify: store.notify,
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [scenario, setScenario] = useState('normal');
  const [updated, setUpdated] = useState(false);
  const list =
    scenario === 'empty'
      ? []
      : machines.map((machine) =>
          scenario === 'offline'
            ? { ...machine, online: false }
            : scenario === 'critical' && machine.id === 'mini'
              ? { ...machine, battery: 6 }
              : machine,
        );
  const online = list.some((machine) => machine.online) && (mode === 'demo' || connection === 'connected');
  async function refresh() {
    if (refreshing || !online) return;
    setRefreshing(true);
    try {
      await adapter.refreshMonitor();
      setUpdated(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read the status.');
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (mode === 'live') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && online) void refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [online, refreshing, mode]);
  return (
    <section className={styles.monitor} aria-label={t("Monitor")}>
      <header className={styles.header}>
        <div>
          <h1>{t("Monitor")}</h1>
          <p>
            <span />
            {mode === 'demo'
              ? t("Read every minute while open")
              : t("Read computer health and usage on refresh")}
          </p>
        </div>
        <Button
          className={styles.refresh}
          aria-label={t("Refresh")}
          icon={refreshing ? undefined : "refreshOutline"}
          disabled={!online || refreshing}
          onClick={refresh}
        >
          {refreshing && <Spinner />}
          <span>{refreshing ? t("Reading…") : t("Refresh")}</span>
        </Button>
      </header>
      {mode === 'demo' && (
        <div className={styles.demoToolbar}>
          <span>{t("Sample readings")}<span className={styles.demoBadge}>{t("DEMO")}</span>
          </span>
          <label>{t("Preview state")}<select
              aria-label={t("Monitor preview state")}
              value={scenario}
              onChange={(event) => {
                setScenario(event.target.value);
                setUpdated(false);
              }}
            >
              <option value="normal">{t("Normal")}</option>
              <option value="stale">{t("Stale data")}</option>
              <option value="hot">{t("Over pace")}</option>
              <option value="critical">{t("Critical battery")}</option>
              <option value="reading">{t("Reading status")}</option>
              <option value="error">{t("Read error")}</option>
              <option value="offline">{t("All offline")}</option>
              <option value="empty">{t("Empty")}</option>
            </select>
          </label>
        </div>
      )}
      {[...(monitorErrors || []), ...(usageErrors || [])].map((error, index) => (
        <p key={index} role="alert" style={{ color: '#fca5a5', fontSize: 12 }}>
          {error}
        </p>
      ))}
      <div className={styles.grid}>
        {scenario === 'empty' || !usageReadings.length ? (
          <div className={styles.emptyUsage}>
            <Empty icon="pulseOutline" title={t("No usage reported yet")}>{t("Usage appears here when an agent reports a reading.")}</Empty>
          </div>
        ) : (
          usageReadings.map((usage) => {
            // A provider without a weekly window shows its 5-hour window as the main reading.
            const main = usage.week ?? usage.fiveHour;
            const usedPercent = scenario === 'hot' ? 86 : main.usedPercent;
            const ahead = main.pacePercent !== null && usedPercent - main.pacePercent > 3;
            const hot =
              usedPercent >= 100 ||
              (main.pacePercent !== null && usedPercent - main.pacePercent > 10);
            const tone = hot ? '#f87171' : ahead ? '#fb923c' : '#4ade80';
            return (
              <article
                key={usage.agent + (usage.machineId || '')}
                className={`${styles.usageCard} ${scenario === 'stale' || usage.stale ? styles.stale : ''}`}
                style={{ '--pace-color': tone } as React.CSSProperties}
              >
                <header>
                  <Avatar agent={usage.agent} size={32} />
                  <h2>{usage.agent}</h2>
                  <span className={styles.paceChip}>
                    {usage.stale
                      ? t("Stale reading")
                      : main.pacePercent === null
                        ? t("Pace unavailable")
                        : hot
                          ? t("Over pace")
                          : ahead
                            ? t("Ahead of pace")
                            : t("On pace")}
                  </span>
                </header>
                <div className={styles.percent}>
                  {usedPercent}
                  <span>%</span>
                </div>
                <p className={styles.usedLabel}>
                  {usage.week ? t("of week used") : t("of 5 hours used")}{usage.machineName ? ` · ${usage.machineName}` : ''}
                </p>
                <div className={styles.weekBar} role="meter" aria-label={`${usage.agent} ${usage.week ? 'weekly' : '5-hour'} usage`}
                  aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100}>
                  <div className={styles.fill} style={{ width: `${usedPercent}%` }} />
                  {usage.week && [1, 2, 3, 4, 5, 6].map((tick) => (
                    <span
                      className={styles.tick}
                      style={{ left: `${(tick * 100) / 7}%` }}
                      key={tick}
                    />
                  ))}
                  {main.pacePercent !== null && (
                    <span className={styles.paceMarker} style={{ left: `${main.pacePercent}%` }} />
                  )}
                </div>
                {usage.week && <div className={styles.weekdays}>
                  {(mode === 'demo'
                    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                    : ['Day 1', '2', '3', '4', '5', '6', '7']
                  ).map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>}
                {usage.week && usage.fiveHour && (
                  <div className={styles.fiveHour} role="meter" aria-label={`${usage.agent} 5-hour usage`}
                    aria-valuenow={usage.fiveHour.usedPercent} aria-valuemin={0} aria-valuemax={100}>
                    <div><span>{t("5-hour limit")}</span><b>{usage.fiveHour.usedPercent}%</b></div>
                    <span className={styles.fiveHourBar}><span style={{ width: `${usage.fiveHour.usedPercent}%` }} /></span>
                    <p>{mode === 'demo' ? t("Resets in") : t("Resets")} {usage.fiveHour.reset}</p>
                  </div>
                )}
                <footer>
                  <span>
                    {usage.week && usage.fiveHour ? t("Week resets") : t("Resets")}{mode === 'demo' ? t(" in") : ''} {main.reset}
                  </span>
                  <span>
                    {mode === 'live'
                      ? usage.capturedAt
                        ? `Read ${new Date(usage.capturedAt).toLocaleTimeString()}`
                        : t("Not read")
                      : scenario === 'stale'
                        ? t("Updated 2h ago")
                        : updated
                          ? t("Updated just now")
                          : t("Updated 1m ago")}
                  </span>
                </footer>
              </article>
            );
          })
        )}
        <div className={styles.sectionDivider}>
          <span>{t("COMPUTERS")}</span>
          <span>
            {list.filter((machine) => machine.online).length}{' '}{t("online ·")}{' '}{list.length}{' '}{t("total")}</span>
        </div>
        {scenario === 'error' ? (
          <div className={styles.healthError}>
            <Icon name="warningOutline" size={24} />
            <h2>{t("Could not read the status")}</h2>
            <p>{t("The sample computer did not respond. Try another reading.")}</p>
            <Button
              icon="refreshOutline"
              onClick={() => {
                setScenario('normal');
                void refresh();
              }}
            >{t("Try again")}</Button>
          </div>
        ) : list.length ? (
          list.map((machine, index) => (
            <ComputerCard
              key={machine.id}
              machine={machine}
              primary={index === 0}
              reading={scenario === 'reading'}
            />
          ))
        ) : (
          <div className={styles.emptyUsage}>
            <Empty icon="desktopOutline" title={t("No computers yet")}>{t("Your connected computers will appear here.")}</Empty>
          </div>
        )}
      </div>
      <footer className={styles.footnote}>
        <Icon name="informationCircleOutline" size={13} />
        <span>{t("The white line marks an even pace over 7 days.")}</span>
        <span>
          {mode === 'demo' ? t("Local demo · simulated readings") : t("Happy · real computer readings")}
        </span>
      </footer>
    </section>
  );
}

export function MachineDetail({ id }: { id: string }) {
  const t = useText();
  const navigate = useNavigate();
  const { machines, mode } = useDemo((store) => ({ machines: store.machines, mode: store.mode }));
  const machine = machines.find((item) => item.id === id);
  return (
    <section className={styles.monitor}>
      <header className={styles.header}>
        <Button
          icon="arrowBack"
          aria-label={t("Back to Monitor")}
          onClick={() => navigate('/monitor')}
        />
        <div>
          <h1>{machine?.name || 'Computer not found'}</h1>
          <p>{t("Computer details ·")}{' '}{mode === 'demo' ? t("local demo") : t("Happy")}</p>
        </div>
      </header>
      {machine ? (
        <>
          <div className={styles.machineIdentity}>
            <span>
              <Icon name="desktopOutline" size={42} />
            </span>
            <h2>{machine.name}</h2>
            <p>{machine.os}</p>
            <span className={styles.machineStatus}>
              {machine.online ? t("Online and available") : t("Offline")}
            </span>
          </div>
          <ComputerCard machine={machine} primary />
          <MachineManagement machine={machine} />
          <p className={styles.machineNote}>
            {mode === 'demo'
              ? t("This computer is sample data. The demo does not access or control a real machine.")
              : t("Health reads use the connected Happy daemon. Unavailable readings remain blank.")}
          </p>
        </>
      ) : (
        <Empty title={t("Computer not found")}>{t("Return to Monitor to choose a computer.")}</Empty>
      )}
    </section>
  );
}
