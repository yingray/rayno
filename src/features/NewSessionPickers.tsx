import { useState } from 'react';
import { Avatar, Button, Dialog, Empty, Icon, RelativeTime } from '../components/ui';
import type { Agent } from '../data/types';
import type { WorkspaceOption } from '../data/workspaces';
import { effortLabel, type ModelOption } from '../happy/modelOptions';
import styles from './new-session.module.css';
import { AgentChoices, descriptions } from './AgentChoices';

export function NewModelPicker({ agent, model, models, effort, efforts, onAgent, onModel, onEffort, onClose }: {
  agent: Agent; model: string; models: ModelOption[]; effort: string | null; efforts: string[];
  onAgent: (agent: Agent) => void; onModel: (model: string) => void;
  onEffort: (effort: string | null) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = models.filter((option) => `${option.label} ${option.provider || ''} ${option.value}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog title="Choose model" onClose={onClose} className={styles.pickerDialog}>
      <AgentChoices value={agent} onChange={(value) => { setQuery(''); onAgent(value); }} />
      <label className={styles.pickerSearch} data-focus-frame>
        <Icon name="searchOutline" size={16} />
        <input aria-label="Search models" placeholder={`Search ${agent} models`} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className={styles.modelChoices} role="radiogroup" aria-label="Model">
        {filtered.map((option) => (
          <button type="button" role="radio" key={option.value} aria-checked={model === option.value}
            aria-label={option.provider ? `${option.provider} · ${option.label}` : option.label}
            disabled={option.disabled} onClick={() => onModel(option.value)}>
            <Avatar agent={agent} size={30} />
            <span><strong>{option.label}</strong><small>{option.provider || descriptions[agent]}</small></span>
            <span className={styles.choiceCheck}>{model === option.value && <Icon name="checkmark" size={14} />}</span>
          </button>
        ))}
        {!filtered.length && <Empty title="No matching models">Try another model name or agent.</Empty>}
      </div>
      <div className={styles.effortSection}>
        <h3>Reasoning effort</h3>
        {efforts.length > 0 && <div className={styles.effortChoices} role="radiogroup" aria-label="Effort">
          {efforts.map((level) => (
            <button type="button" role="radio" key={level || 'default'} aria-checked={effort === level}
              onClick={() => onEffort(level)}>{effortLabel(level)}</button>
          ))}
        </div>}
        {!efforts.length && <p>This model does not support effort selection.</p>}
      </div>
      <footer><Button variant="accent" onClick={onClose}>Done</Button></footer>
    </Dialog>
  );
}

export function WorkspacePicker({ options, path, machineName, onSelect, onClose }: {
  options: WorkspaceOption[]; path: string; machineName: string;
  onSelect: (path: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState(path);
  const filtered = options.filter((option) => `${option.label} ${option.path}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog title="Choose workspace" onClose={onClose} className={styles.pickerDialog}>
      <p className={styles.dialogHint}>Recent workspaces · {machineName}</p>
      <label className={styles.pickerSearch} data-focus-frame>
        <Icon name="searchOutline" size={16} />
        <input aria-label="Search workspaces" placeholder="Search recent workspaces" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className={styles.workspaceChoices} role="group" aria-label="Recent workspaces">
        {filtered.map((option) => (
          <button type="button" key={option.path} aria-label={`Use workspace ${option.displayPath}`} onClick={() => onSelect(option.path)}>
            <Icon name={option.checkout ? 'gitBranchOutline' : 'folderOutline'} size={20} />
            <span><strong>{option.label}{option.checkout && <em>{option.checkout}</em>}</strong><small>{option.displayPath}</small></span>
            <RelativeTime time={option.usedAt} />
          </button>
        ))}
        {!filtered.length && <Empty icon="folderOutline" title={query ? 'No matching workspaces' : 'No recent workspaces'}>
          {query ? 'Try another folder name.' : 'Enter a folder below to start on this computer.'}
        </Empty>}
      </div>
      <div className={styles.customFolder}>
        <label htmlFor="workspace-folder">Another folder</label>
        <div><input id="workspace-folder" aria-label="Workspace folder" value={folder}
          placeholder="~/code/project" onChange={(event) => setFolder(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && folder.trim()) { event.preventDefault(); onSelect(folder.trim()); } }} />
          <Button disabled={!folder.trim()} onClick={() => onSelect(folder.trim())}>Use folder</Button></div>
      </div>
    </Dialog>
  );
}
