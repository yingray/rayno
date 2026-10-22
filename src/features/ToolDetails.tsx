import { useText } from "../i18n";
import { useEffect, useState } from 'react';
import { Button, Dialog } from '../components/ui';
import { imageMime } from '../happy/attachments';
import { TODO_MARK, type ToolSection } from '../data/toolResults';
import type { Answer, PermissionSummary } from '../happy/toolDecisions';
import styles from './chat.module.css';

export type ToolOutcome = { permission?: PermissionSummary; answers?: Answer[]; dismissed?: boolean };

const TODO_STATUS: Record<string, string> = { completed: 'Done', in_progress: 'In progress', pending: 'To do' };

function ToolDiff({ section }: {section: Extract<ToolSection,{kind:'diff'}>}) {
  const t=useText();
  const [count,setCount]=useState(400);
  const lines=[...section.lines,...section.remaining||[]];
  return <div><h4>{t(section.label)}</h4><pre aria-label={t('Tool diff')}>
    {lines.slice(0,count).map((line,index)=><span key={index} className={DIFF_CLASS[line.kind]}>{line.text}{'\n'}</span>)}
  </pre>{lines.length>count&&<Button className={styles.resultAction} onClick={()=>setCount(value=>value+400)}>{t('Show more lines')} ({lines.length-count})</Button>}
    {count>400&&<Button className={styles.resultAction} onClick={()=>setCount(400)}>{t('Show fewer lines')}</Button>}</div>;
}

function ToolImage({data,label}:{data:string;label:string}) {
  const t=useText();
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false);
  useEffect(()=>{
    let url='';
    try {
      if(data.length>14*1024*1024)throw new Error('This tool image is too large to preview.');
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
      url=URL.createObjectURL(new Blob([bytes],{type:imageMime(bytes)}));setUrl(url);setError('');
    } catch { setError('This tool image is not a supported PNG, JPEG, GIF, or WebP image.'); }
    return()=>{if(url)URL.revokeObjectURL(url);};
  },[data]);
  return <div className={styles.receivedImage}>{error?<p role="status">{t(error)}</p>:url&&<button type="button" aria-label={t('Open tool image')} onClick={()=>setOpen(true)}><img loading="lazy" src={url} alt={label}/></button>}
    {open&&url&&<Dialog className={styles.imageDialog} title={t(label)} onClose={()=>setOpen(false)}><img src={url} className={styles.attachmentPreview} alt={label}/><a className={styles.imageDownload} href={url} download="tool-image">{t('Download image')}</a></Dialog>}</div>;
}
const DIFF_CLASS = { add: styles.diffAdded, remove: styles.diffRemoved, hunk: styles.diffHunk, context: undefined };

export function ToolAnswers({ items }: { items: Answer[] }) {
  return <dl className={styles.toolAnswers}>
    {items.map((item, index) => <div key={index}><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}
  </dl>;
}

export function ToolDecision({ value }: { value: PermissionSummary }) {
  const t=useText();
  return <span className={styles.toolDecision} data-tone={value.tone}>{t(value.label)}</span>;
}

// Notes and lists use div elements, so recap jumps target the whole tool row.
export function ToolSections({ sections }: { sections: ToolSection[] }) {
  const t = useText();
  return <>{sections.map((section, index) => {
    if (section.kind === 'note') return <div key={index} className={styles.toolNote} data-tone={section.error ? "error" : undefined}>{section.text}</div>;
    if (section.kind === 'text') return <div key={index}>
      <h4>{t(section.label)}</h4><pre data-tone={section.error ? "error" : undefined}>{section.text}</pre>
    </div>;
    if (section.kind === 'source') return <details key={index}><summary>{t(section.label)}</summary><pre>{section.text}</pre></details>;
    if (section.kind === 'image') return <ToolImage key={index} data={section.data} label={section.label}/>;
    if (section.kind === 'diff') return <ToolDiff key={index} section={section}/>;
    if (section.kind === 'todos') return <div key={index}>
      <h4>{t("Todo list")}</h4>
      <div role="list" aria-label={t("Todo list")} className={styles.toolTodos}>
        {section.items.map((todo, todoIndex) => <div role="listitem" key={todoIndex} data-status={todo.status}
          aria-label={`${todo.content}, ${TODO_STATUS[todo.status] || todo.status}`}>
          <span aria-hidden="true">{TODO_MARK[todo.status] || '☐'}</span>{todo.content}
        </div>)}
      </div>
    </div>;
    return <div key={index}><h4>{t("Answers")}</h4><ToolAnswers items={section.items} /></div>;
  })}</>;
}
