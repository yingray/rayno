import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Keep each parent's open panel and selected chat until this account workspace unmounts. */
export function useSideChatNavigation(parentId: string | undefined, sideOpen: boolean) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const views = useRef(new Map<string, { open: boolean; selected?: string }>());
  const previousPath = useRef(pathname);
  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (!parentId) return;
    const base = `/session/${parentId}`;
    const view = views.current.get(parentId) || { open: false };
    if (sideOpen) views.current.set(parentId, { ...view, open: true });
    else if (pathname === base) {
      // A direct return from /side closes the panel, including the header toggle and Escape.
      if (previous === `${base}/side`) views.current.set(parentId, { ...view, open: false });
      else if (view.open) navigate(`${base}/side`, { replace: true });
    }
  }, [pathname, parentId, sideOpen, navigate]);
  const select = useCallback((id: string) => {
    if (!parentId) return;
    const view = views.current.get(parentId) || { open: true };
    views.current.set(parentId, { ...view, selected: id });
  }, [parentId]);
  return { selected: parentId ? views.current.get(parentId)?.selected : undefined, select };
}
