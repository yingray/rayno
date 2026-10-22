import { useText } from "../i18n";
import { useEffect, useState } from 'react';
import { Button, Empty, Spinner } from '../components/ui';
import { useDemo } from '../data/store';
import { titleOf } from '../data/reducer';
import { messageError } from '../happy/errors';
import { usageTotals, type UsagePeriod, type UsagePoint } from '../happy/usageReport';
import styles from './management.module.css';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(value);
const count = (value: number) => value.toLocaleString('en-US');
export function UsageReport() {
  const t = useText();
  const { live, sessions, offline, mode } = useDemo(store => ({ live: store.live, sessions: store.state.sessions,
    offline: store.snapshot?.offline, mode: store.mode }));
  const [period, setPeriod] = useState<UsagePeriod>('7days');
  const [session, setSession] = useState('');
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens');
  const [points, setPoints] = useState<UsagePoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setPoints(null); setError(''); setLoading(!!live && !offline);
    if (live && !offline) live.queryUsage(period, session || undefined)
      .then(value => { if (current) setPoints(value); })
      .catch(error => { if (current) setError(messageError(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [live, period, session, retry, offline]);
  const totals = usageTotals(points || []);
  const rows = (points || []).map(point => ({ ...point, value: Object.values(point[metric]).reduce((a, b) => a + b, 0) }));
  const max = Math.max(1, ...rows.map(point => point.value));
  return <section className={styles.card} aria-label={t("Usage history")}>
    <header><div><h2>{t("Usage history")}</h2><p>{t("Reported tokens and cost in USD. Plan limits appear in Monitor.")}</p></div>
      <Button icon="refreshOutline" aria-label={t("Refresh usage history")} disabled={loading || !live || offline} onClick={() => setRetry(value => value + 1)} /></header>
    <div className={styles.fields}>
      <label>{t("Period")}<select aria-label={t("Usage period")} value={period} onChange={event => setPeriod(event.target.value as UsagePeriod)}>
        <option value="today">{t("Today")}</option><option value="7days">{t("Last 7 days")}</option><option value="30days">{t("Last 30 days")}</option>
      </select></label>
      <label>{t("Session")}<select aria-label={t("Usage session")} value={session} onChange={event => setSession(event.target.value)}>
        <option value="">{t("All sessions")}</option>{sessions.filter(item => !item.isSideChat).map(item => <option key={item.id} value={item.id}>{titleOf(item)}</option>)}
      </select></label>
    </div>
    {loading ? <div role="status" aria-label={t("Loading usage history")}><Spinner /></div> : error ? <p role="alert">{error}</p>
      : mode === 'demo' ? <Empty title={t("Connect to read usage history")}>{t("Demo mode does not contain account usage reports.")}</Empty>
      : offline ? <Empty title={t("Usage history is offline")}>{t("Reconnect to Happy to read the report.")}</Empty>
      : points && !points.length ? <Empty title={t("No usage reported")}>{t("Happy returned no usage for this period and session.")}</Empty>
      : points && <>
        <dl className={styles.totals}><div><dt>{t("Total tokens")}</dt><dd>{count(totals.totalTokens)}</dd></div><div><dt>{t("Reported cost")}</dt><dd>{money(totals.totalCost)}</dd></div></dl>
        <div className={styles.actions} role="group" aria-label={t("Chart metric")}>
          <Button aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>{t("Tokens")}</Button>
          <Button aria-pressed={metric === 'cost'} onClick={() => setMetric('cost')}>{t("Cost")}</Button>
        </div>
        <div className={styles.chart} role="img" aria-label={`${t(metric === 'tokens' ? 'Tokens' : 'Cost')} ${t(period === 'today' ? 'by hour' : 'by day')}. ${t('Details follow in the table.')}`}>
          {rows.map((point, index) => <span key={index} style={{ height: `${Math.max(point.value ? 1 : 0, point.value / max * 100)}%` }}
            title={`${new Date(point.timestamp * 1000).toLocaleString()}: ${metric === 'tokens' ? count(point.value) : money(point.value)}`} />)}
        </div>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("Usage by model")}>
          <table><caption>{t("Usage by model")}</caption><thead><tr><th scope="col">{t("Model")}</th><th scope="col">{t("Tokens")}</th><th scope="col">{t("Cost")}</th></tr></thead>
            <tbody>{totals.models.map(model => <tr key={model}><th scope="row">{model}</th><td>{count(totals.tokens[model] || 0)}</td><td>{money(totals.cost[model] || 0)}</td></tr>)}</tbody></table>
        </div>
        <details><summary>{t("Usage by date")}</summary><div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("Usage by date")}>
          <table><thead><tr><th scope="col">{t("Date")}</th><th scope="col">{t("Tokens")}</th><th scope="col">{t("Cost")}</th></tr></thead><tbody>
            {points.map((point, index) => <tr key={index}><th scope="row">{period === 'today' ? new Date(point.timestamp * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : new Date(point.timestamp * 1000).toLocaleDateString()}</th>
              <td>{count(Object.values(point.tokens).reduce((a,b) => a+b,0))}</td><td>{money(Object.values(point.cost).reduce((a,b) => a+b,0))}</td></tr>)}
          </tbody></table></div></details>
      </>}
  </section>;
}
