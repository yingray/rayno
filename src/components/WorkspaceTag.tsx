import { memo } from 'react';
import { resolveWorkspaceTagColor } from '../data/workspaceColor';
import styles from '../features/sessions.module.css';

export const WorkspaceTag = memo(function WorkspaceTag({ name, small = false }: { name: string; small?: boolean }) {
  const color = resolveWorkspaceTagColor(name, true);
  return (
    <span
      className={`${styles.tag} ${small ? styles.smallTag : ''}`}
      style={{ color: color.text, background: color.background }}
    >
      {name}
    </span>
  );
});
