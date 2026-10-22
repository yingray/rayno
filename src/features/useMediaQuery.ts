import { useEffect, useState } from 'react';

// The chat shows the pin rail and the composer pill from this width.
export const DESKTOP_QUERY = '(min-width: 768px)';
// Touch screens give the rail pins larger hit areas.
export const COARSE_QUERY = '(hover: none) and (pointer: coarse)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
