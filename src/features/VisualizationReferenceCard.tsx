import { lazy, Suspense, useState } from 'react';
import { Button, Dialog, Icon, Spinner } from '../components/ui';
import { useDemo } from '../data/store';
import { visualizationDemoId, visualizationDemoPath } from '../data/visualizationDemo';
import type { VisualizationReference } from '../data/visualizationReferences';
import { messageError } from '../happy/errors';
import type { ScatterChart } from '../happy/visualizations';
import { useText } from '../i18n';
import styles from './visualization.module.css';

const VisualizationCharts = lazy(() => import('./VisualizationCharts'));

export function VisualizationReferenceCard({ reference, sessionId, messageId }: {
  reference: VisualizationReference; sessionId: string; messageId: string;
}) {
  const t = useText();
  const { live, demo } = useDemo(store => ({
    live: store.live,
    demo: store.mode === 'demo' && sessionId === visualizationDemoId && reference.path === visualizationDemoPath,
  }));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [charts, setCharts] = useState<ScatterChart[]>();
  const [error, setError] = useState('');
  const title = reference.title || reference.path.split(/[\\/]/).at(-1) || t('Visualization');

  async function load() {
    if (loading || charts) return;
    setLoading(true);
    setError('');
    try {
      if (demo) {
        const [{ parseVisualizationDocument }, { loadDemoVisualization }] = await Promise.all([
          import('../happy/visualizations'), import('../data/visualizationDemoData'),
        ]);
        setCharts(parseVisualizationDocument(loadDemoVisualization()));
      } else if (live) setCharts(await live.loadVisualization(sessionId, messageId, reference.path));
      else setError('This visualization is available in its connected session.');
    } catch (error) { setError(messageError(error)); }
    finally { setLoading(false); }
  }

  return <>
    <div className={styles.reference}>
      <Icon name="pulseOutline" size={20} />
      <strong>{title}</strong>
      <Button aria-haspopup="dialog" onClick={() => { setOpen(true); void load(); }}>{t('Open visualization')}</Button>
    </div>
    {open && <Dialog title={title} className={`${styles.viewer} ${reference.mode === 'wide' ? styles.wide : ''}`} onClose={() => setOpen(false)}>
      {loading && <div className={styles.loading} role="status"><Spinner />{t('Loading visualization…')}</div>}
      {error && <div className={styles.failure}>
        <p role="alert">{t(error)}</p>
        <code>{reference.path}</code>
        {(demo || live) && <Button onClick={() => void load()}>{t('Retry')}</Button>}
      </div>}
      {charts && <Suspense fallback={<div className={styles.loading} role="status"><Spinner />{t('Loading visualization…')}</div>}>
        <VisualizationCharts charts={charts} />
      </Suspense>}
    </Dialog>}
  </>;
}
