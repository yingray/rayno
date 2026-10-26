import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, copyText, Icon, Segment, Spinner } from '../components/ui';
import { useText } from '../i18n';
import { useDemo } from '../data/store';
import type { Session } from '../data/types';
import { gitStatusLabel, hasGitSide, isUntracked, preferredGitSide, type GitFile, type GitPatch, type GitSide, type GitSnapshot } from '../data/gitChanges';
import { gitDemoPatch, gitDemoSnapshot, type GitDemoScenario } from '../data/gitDiffDemo';
import { readGitPatch, readGitSnapshot } from '../happy/gitChanges';
import { messageError } from '../happy/errors';
import { GitDiffViewer } from './GitDiffViewer';
import styles from './gitChanges.module.css';

type Filter = 'all' | 'working' | 'staged' | 'untracked' | 'conflicts';
const matchesFilter = (file: GitFile, filter: Filter) => filter === 'all' || filter === 'conflicts' && file.conflict
  || filter === 'untracked' && isUntracked(file) || (filter === 'working' || filter === 'staged') && hasGitSide(file, filter);
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
function Counts({ added, removed }: { added: number; removed: number }) {
  return <span className={styles.counts}><span>+{added}</span><span>−{removed}</span></span>;
}

export function GitChanges({ session }: { session: Session }) {
  const t = useText(), navigate = useNavigate();
  const { live, mode, connected, offline, notify } = useDemo(store => ({ live: store.live, mode: store.mode,
    connected: store.snapshot?.connection === 'connected', offline: store.snapshot?.offline, notify: store.notify }));
  const available = mode === 'demo' || connected && !offline;
  const [snapshot, setSnapshot] = useState<GitSnapshot>();
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [scenario, setScenario] = useState<GitDemoScenario>('changes');
  const [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState(''), [side, setSide] = useState<GitSide>('working');
  const [filesOpen, setFilesOpen] = useState(false), [split, setSplit] = useState(false), [wrap, setWrap] = useState(true);
  const fileButton = useRef<HTMLButtonElement>(null);
  const [patchState, setPatchState] = useState<{ key: string; patch?: GitPatch; error?: string }>();
  useEffect(() => {
    if (!available) { setBusy(false); return; }
    let current = true;
    setBusy(true); setError('');
    const read = mode === 'demo' ? Promise.resolve().then(() => gitDemoSnapshot(scenario)) : readGitSnapshot(live!, session.id, session.path);
    void read.then(data => { if (current) setSnapshot(data); }).catch(reason => {
      if (current) { setError(messageError(reason)); setSnapshot(undefined); }
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [available, live, mode, session.id, session.path, revision, scenario]);
  const files = snapshot?.files ?? [];
  const matching = files.filter(file => matchesFilter(file, filter) && `${file.path}\n${file.oldPath ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = matching.find(file => file.path === selectedPath) ?? matching[0];
  const currentSide = selected && hasGitSide(selected, side) ? side : selected ? preferredGitSide(selected) : side;
  const patchKey = `${revision}:${scenario}:${selected?.path}:${currentSide}`;
  const patch = patchState?.key === patchKey ? patchState : undefined;
  useEffect(() => {
    if (!snapshot || !selected || !available || busy) return;
    let current = true;
    setPatchState({ key: patchKey });
    const read = mode === 'demo' ? Promise.resolve().then(() => gitDemoPatch(selected, currentSide))
      : readGitPatch(live!, session.id, snapshot.root, selected, currentSide, session.path);
    void read.then(data => { if (current) setPatchState({ key: patchKey, patch: data }); })
      .catch(reason => { if (current) setPatchState({ key: patchKey, error: messageError(reason) }); });
    return () => { current = false; };
  }, [snapshot, selected, available, busy, patchKey, live, mode, session.id, session.path, currentSide]);
  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All changes' }, { value: 'working', label: 'Working tree' }, { value: 'staged', label: 'Staged' },
    { value: 'untracked', label: 'Untracked' }, ...(files.some(file => file.conflict) ? [{ value: 'conflicts' as const, label: 'Conflicts' }] : []),
  ];
  const totals = files.filter(file => matchesFilter(file, filter)).reduce((sum, file) => {
    const stats = filter === 'staged' ? [file.stagedStat] : filter === 'working' ? [file.workingStat] : [file.stagedStat, file.workingStat];
    stats.forEach(stat => { sum.added += stat?.added ?? 0; sum.removed += stat?.removed ?? 0; }); return sum;
  }, { added: 0, removed: 0 });
  function choose(file: GitFile) {
    setSelectedPath(file.path); setSide(filter === 'staged' ? 'staged' : preferredGitSide(file));
    setFilesOpen(false);
    if (window.innerWidth < 768) fileButton.current?.focus();
  }
  function download() {
    if (!patch?.patch || !selected) return;
    const url = URL.createObjectURL(new Blob([patch.patch.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = fileName(selected.path) + (patch.patch.source ? '.txt' : '.patch'); link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={styles.screen} aria-label={t('Git changes')}>
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.eyebrow}><Icon name="gitCompareOutline" size={15} />{t('WORKSPACE')}</span>
        <h1>{t('Git changes')} <small>{t('Read only')}</small></h1></div>
      <div className={styles.actions}><Button icon="arrowBack" onClick={() => navigate(`/session/${session.id}`)}>{t('Back to chat')}</Button>
        <Button icon="refreshOutline" disabled={busy || !available} onClick={() => setRevision(value => value + 1)}>{t('Refresh')}</Button></div>
    </header>
    <div className={styles.repository}>
      <span><Icon name="gitBranchOutline" size={14} /><strong>{snapshot?.branch || session.branch || t('Branch not reported')}</strong></span>
      {snapshot?.ahead ? <span>↑ {snapshot.ahead} {t('ahead')}</span> : null}{snapshot?.behind ? <span>↓ {snapshot.behind} {t('behind')}</span> : null}
      <code title={snapshot?.root || session.path}>{snapshot?.root || session.path}</code>
      {snapshot && filter !== 'untracked' && <span title={t('Line changes in tracked files')}><Counts {...totals} /></span>}
    </div>
    {mode === 'demo' && <div className={styles.demo}>
      <span>{t('Simulated repository')}</span>
      <label><span>{t('Demo repository state')}</span><select value={scenario} onChange={event => { setScenario(event.target.value as GitDemoScenario); setFilter('all'); setQuery(''); setSelectedPath(''); }}>
        {([['changes', 'Sample changes'], ['clean', 'Clean repository'], ['conflict', 'Merge conflict'], ['error', 'Read error']] as const).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
      </select></label>
    </div>}
    {!available && <p className={styles.notice} role="status">{t(snapshot ? 'Offline · showing the last loaded changes' : 'Connect to read Git changes from this workspace.')}</p>}
    {busy && <div className={styles.loading} role="status"><Spinner />{t('Reading Git changes…')}</div>}
    {error && <div className={styles.error} role="alert"><strong>{t('Cannot read Git changes')}</strong><p>{error}</p>
      <Button disabled={!available} onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button></div>}
    {snapshot && <>
      <div className={styles.filters} role="group" aria-label={t('Change filters')}>
        {filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); if (item.value === 'working' || item.value === 'staged') setSide(item.value); }}>
          {t(item.label)}<span>{files.filter(file => matchesFilter(file, item.value)).length}</span>
        </button>)}
      </div>
      {!files.length ? <div className={styles.empty}><Icon name="checkmarkCircleOutline" size={28} /><h2>{t('Working tree clean')}</h2><p>{t('There are no staged, unstaged, or untracked changes.')}</p></div>
        : <div className={styles.layout}>
          <aside className={styles.filePane} data-open={filesOpen}>
            <button ref={fileButton} className={styles.fileToggle} type="button" aria-expanded={filesOpen} aria-controls="git-change-file-list" onClick={() => setFilesOpen(value => !value)}>
              <Icon name="documentTextOutline" size={16} /><span>{selected ? fileName(selected.path) : t('Changed files')}</span><small>{matching.length} {t('files')}</small><Icon name={filesOpen ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
            <div className={styles.fileBrowser} id="git-change-file-list">
              <label className={styles.search}><Icon name="searchOutline" size={16} /><input type="search" aria-label={t('Filter changed files')} placeholder={t('Filter files…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
              <nav className={styles.fileList} aria-label={t('Changed files')}>
                {matching.map(file => {
                  const stat = filter === 'staged' ? file.stagedStat : filter === 'working' ? file.workingStat : file.workingStat ?? file.stagedStat;
                  const status = gitStatusLabel(file);
                  return <button key={file.path} type="button" aria-current={selected?.path === file.path ? 'true' : undefined} disabled={busy || !available} onClick={() => choose(file)} title={file.path}>
                    <span className={styles.statusBadge} data-status={status}>{status === 'Untracked' ? '?' : status[0]}</span>
                    <span className={styles.fileName}><strong>{fileName(file.path)}</strong><small>{file.path.slice(0, file.path.lastIndexOf('/')) || '/'}</small>
                      {file.oldPath && <small>← {file.oldPath}</small>}</span>
                    <span className={styles.fileStats}>{stat?.binary ? t('Binary') : stat ? <Counts {...stat} /> : t(status)}</span>
                  </button>;
                })}
                {!matching.length && <p className={styles.noFiles}>{t('No files match this filter.')}</p>}
              </nav>
            </div>
          </aside>
          <div className={styles.viewer}>
            {!selected ? <div className={styles.empty}><strong>{t('No matching changes')}</strong><Button onClick={() => { setQuery(''); setFilter('all'); }}>{t('Clear filters')}</Button></div> : <>
              <div className={styles.fileHeader}><div><h2>{selected.path}</h2><span>{t(gitStatusLabel(selected, currentSide))}{selected.oldPath && <> · {t('Previously')} {selected.oldPath}</>}</span></div>
                <div className={styles.actions}>
                  <Button icon="chevronBackOutline" aria-label={t('Previous changed file')} disabled={matching.indexOf(selected) === 0 || !available} onClick={() => choose(matching[matching.indexOf(selected) - 1])} />
                  <Button icon="chevronForwardOutline" aria-label={t('Next changed file')} disabled={matching.indexOf(selected) === matching.length - 1 || !available} onClick={() => choose(matching[matching.indexOf(selected) + 1])} />
                </div>
              </div>
              <div className={styles.toolbar}>
                <Segment label={t('Diff source')} value={currentSide} onChange={setSide} className={styles.segment}
                  options={(['working', 'staged'] as const).filter(value => hasGitSide(selected, value)).map(value => ({ value, label: t(value === 'staged' ? 'Staged' : 'Working tree') }))} />
                <Segment label={t('Diff layout')} value={split ? 'split' : 'unified'} onChange={value => setSplit(value === 'split')} className={styles.segment}
                  options={[{ value: 'unified', label: t('Unified') }, { value: 'split', label: t('Split') }]} />
                <button className={styles.wrap} type="button" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>{t('Wrap lines')}</button>
                <Button icon="copyOutline" aria-label={t(patch?.patch?.source ? 'Copy content' : 'Copy diff')} disabled={!patch?.patch?.text} onClick={() => void copyText(patch?.patch?.text || '', notify)} />
                <Button icon="arrowDown" aria-label={t(patch?.patch?.source ? 'Download file' : 'Download diff')} disabled={!patch?.patch?.text || patch.patch.truncated} onClick={download} />
              </div>
              {selected.conflict && <p className={styles.notice}>{t('This file has a merge conflict. The working file shows its conflict markers.')}</p>}
              {isUntracked(selected) && <p className={styles.hint}>{t('New file · all lines are additions')}</p>}
              {patch?.error ? <div className={styles.error} role="alert"><p>{patch.error}</p><Button disabled={!available} onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button></div>
                : patch?.patch ? <GitDiffViewer key={patchKey} patch={patch.patch} split={split} wrap={wrap} />
                  : available ? <div className={styles.loading} role="status"><Spinner />{t('Loading file diff…')}</div> : <p className={styles.notice}>{t('This diff is not available offline.')}</p>}
            </>}
          </div>
        </div>}
    </>}
  </section>;
}
