import { memo, useMemo } from 'react';
import { planetsAvatar } from './planetsAvatar';
import styles from './ui.module.css';

export default memo(function PlanetAvatar({ sessionId }: { sessionId: string }) {
  const source = useMemo(() => planetsAvatar(sessionId), [sessionId]);
  return <img src={source} className={styles.planetIcon} alt="" />;
});
