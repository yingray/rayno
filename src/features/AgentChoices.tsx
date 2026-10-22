import { useText } from "../i18n";
import { memo } from 'react';
import { Avatar, Icon } from '../components/ui';
import type { Agent } from '../data/types';
import styles from './new-session.module.css';

export const descriptions: Record<Agent, string> = {
  Claude: 'Claude Code', Codex: 'OpenAI Codex', 'Happy Agent': 'Computer catalog',
};

export const AgentChoices = memo(function AgentChoices({ value, onChange }: { value: Agent; onChange: (agent: Agent) => void }) {
  const t = useText();
  return (
    <div className={styles.agentChoices} role="group" aria-label={t("Agent")}>
      {(['Claude', 'Codex'] as Agent[]).map((agent) => (
        <button type="button" key={agent} aria-label={agent} aria-pressed={value === agent}
          onClick={() => onChange(agent)}>
          <Avatar agent={agent} size={28} />
          <span><strong>{agent}</strong><small>{descriptions[agent]}</small></span>
          {value === agent && <Icon name="checkmark" size={13} />}
        </button>
      ))}
    </div>
  );
});
