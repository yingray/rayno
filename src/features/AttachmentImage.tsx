import { useText } from "../i18n";
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../components/ui';
import { useDemo } from '../data/store';
import type { Attachment } from '../data/types';
import { messageError } from '../happy/errors';
import styles from './chat.module.css';

export function AttachmentImage({ sessionId, file }: { sessionId: string; file: Attachment }) {
  const t = useText();
  const live = useDemo(store => store.live);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !live || !file.ref) return;
    let active = true, objectUrl = '';
    setError('');
    live.loadImage(sessionId, file.ref).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(error => { if (active) setError(messageError(error)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, live, sessionId, file.ref, attempt]);
  return <div ref={frame} className={styles.receivedImage}>
    {url ? <button aria-label={`Open image ${file.name}`} onClick={() => setOpen(true)}>
      <img src={url} alt={file.name} loading="lazy" />
    </button> : error ? <><p role="alert">{error}</p><Button onClick={() => setAttempt(value => value + 1)}>{t("Retry image")}</Button></> : <span>{t("Load image…")}</span>}
    <small>{file.name}</small>
    {open && url && <Dialog className={styles.imageDialog} title={file.name} onClose={() => setOpen(false)}>
      <img className={styles.attachmentPreview} src={url} alt={file.name} />
      <a className={styles.imageDownload} href={url} download={file.name}>{t("Download image")}</a>
    </Dialog>}
  </div>;
}
