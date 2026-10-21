import { useCallback, useLayoutEffect, useRef } from 'react';

// Event props retain their identity and read the latest committed handler.
export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
