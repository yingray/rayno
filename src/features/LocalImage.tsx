import { useState } from 'react';
import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import { useText } from '../i18n';
import { messageError } from '../happy/errors';
import { savedLocalImage } from '../happy/localImages';
import { AttachmentImage } from './AttachmentImage';
import { imageDemoId, imageDemoPath } from '../data/imageDemo';
import type { Attachment } from '../data/types';
import styles from './chat.module.css';

// A path in agent output never starts a read or an upload without a user action.
export function LocalImage({ sessionId, messageId, source, alt }: {
  sessionId: string; messageId: string; source: string; alt?: string;
}) {
  const t = useText();
  const { live, metadata, connected, active, demo } = useDemo(store => ({
    live: store.live,
    metadata: store.snapshot?.sessionData[sessionId]?.metadata,
    connected: store.snapshot?.connection === 'connected' && !store.snapshot?.offline,
    active: store.state.sessions.find(session => session.id === sessionId)?.status !== 'offline',
    demo: store.mode === 'demo' && sessionId === imageDemoId && source === imageDemoPath,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoImage, setDemoImage] = useState<{ file: Attachment; load: () => Promise<Blob> }>();
  const file = savedLocalImage(metadata, messageId, source);
  if (demoImage) return <AttachmentImage sessionId={sessionId} file={demoImage.file} loadImage={demoImage.load} />;
  if (file) return <AttachmentImage sessionId={sessionId} file={file} />;
  async function load() {
    if ((!live && !demo) || busy) return;
    setBusy(true); setError('');
    try {
      if (demo) {
        const { loadDemoImage } = await import('../data/imageDemo');
        setDemoImage(await loadDemoImage());
      } else await live!.importLocalImage(sessionId, messageId, source);
    }
    catch (error) { setError(messageError(error)); }
    finally { setBusy(false); }
  }
  return <span className={styles.localImage}>
    <strong>{alt || t('Local image')}</strong>
    <code>{source}</code>
    <span>{t(demo ? 'Demo: load a public sample image. No computer files are read or uploaded.'
      : 'Load this image from the session computer and save an encrypted attachment. No public link is created.')}</span>
    <Button disabled={busy || (!demo && (!live || !connected || !active))} onClick={() => void load()}>
      {busy ? t('Load image…') : t('Load private image')}
    </Button>
    {demo ? null : !live ? <span>{t('Local images are available in connected sessions.')}</span>
      : !connected ? <span>{t('Connect to load this image from the computer.')}</span>
      : !active ? <span>{t('Resume this session to load an image from its computer.')}</span> : null}
    {error && <span role="alert">{t(error)}</span>}
  </span>;
}
