import { memo, useMemo, useState } from 'react';
import { Button } from '../components/ui';
import { useText } from '../i18n';
import { splitGitLines, type GitPatch, type PatchLine } from '../data/gitChanges';
import styles from './gitChanges.module.css';

const prefix = (line?: PatchLine) => line?.kind === 'add' ? '+' : line?.kind === 'remove' ? '−' : ' ';
export const GitDiffViewer = memo(function GitDiffViewer({ patch, split, wrap }: { patch: GitPatch; split: boolean; wrap: boolean }) {
  const t = useText();
  const [count, setCount] = useState(400);
  const paired = useMemo(() => split ? splitGitLines(patch.lines) : [], [patch.lines, split]);
  const total = split ? paired.length : patch.lines.length;
  if (patch.binary) return <div className={styles.empty}><strong>{t('Binary file')}</strong><p>{t('A text diff is not available for this file.')}</p></div>;
  return <>
    {patch.truncated && <p className={styles.notice} role="status">{t('This preview contains the first 512 KB of the diff.')}</p>}
    {!patch.lines.length ? <div className={styles.empty}><strong>{t(patch.source ? 'Empty file' : 'No text changes')}</strong>
      <p>{t(patch.source ? 'This file has no content.' : 'This change may only affect file metadata or permissions.')}</p>
      {patch.metadata.length > 0 && <pre>{patch.metadata.join('\n')}</pre>}</div>
      : <div className={styles.diffScroll} role="region" aria-label={t('File diff')} tabIndex={0} data-wrap={wrap} data-layout={split ? 'split' : 'unified'}>
        <table className={styles.diffTable}>
          <caption className={styles.srOnly}>{t(split ? 'Side-by-side diff' : 'Unified diff')}</caption>
          <colgroup>{(split ? [32, 16, undefined, 32, 16, undefined] : [32, 32, 16, undefined]).map((width, index) => <col key={index} style={width ? { width } : undefined} />)}</colgroup>
          {split ? <thead className={styles.splitHead}><tr><th colSpan={3}>{t('Before')}</th><th colSpan={3}>{t('After')}</th></tr></thead>
            : <thead className={styles.srOnly}><tr>{['Old line', 'New line', 'Change', 'Content'].map((label, index) => <th key={index}>{t(label)}</th>)}</tr></thead>}
          <tbody>{split ? paired.slice(0, count).map((row, index) => row.marker
            ? <tr key={index} data-kind={row.marker.kind}><td colSpan={6} className={styles.marker}>{row.marker.text}</td></tr>
            : <tr key={index}>
              <td className={styles.lineNumber} data-kind={row.old?.kind}>{row.old?.old}</td><td className={styles.prefix} data-kind={row.old?.kind} aria-hidden="true">{prefix(row.old)}</td>
              <td className={styles.code} data-kind={row.old?.kind}><code>{row.old?.text ?? ''}</code></td>
              <td className={styles.lineNumber} data-kind={row.next?.kind}>{row.next?.next}</td><td className={styles.prefix} data-kind={row.next?.kind} aria-hidden="true">{prefix(row.next)}</td>
              <td className={styles.code} data-kind={row.next?.kind}><code>{row.next?.text ?? ''}</code></td>
            </tr>) : patch.lines.slice(0, count).map((line, index) => line.kind === 'hunk' || line.kind === 'note'
              ? <tr key={index} data-kind={line.kind}><td colSpan={4} className={styles.marker}>{line.text}</td></tr>
              : <tr key={index} data-kind={line.kind}>
                <td className={styles.lineNumber}>{line.old}</td><td className={styles.lineNumber}>{line.next}</td>
                <td className={styles.prefix} aria-hidden="true">{prefix(line)}</td><td className={styles.code}><code>{line.text || ' '}</code></td>
              </tr>)}</tbody>
        </table>
      </div>}
    {total > 400 && <div className={styles.more}>
      {count < total && <Button onClick={() => setCount(value => value + 400)}>{t('Show more lines')} ({total - count})</Button>}
      {count > 400 && <Button onClick={() => setCount(400)}>{t('Show fewer lines')}</Button>}
    </div>}
  </>;
});
