export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.hasOwn(b, key) && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

export function createExternalStore<T>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: T) {
      if (Object.is(snapshot, next)) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

// Each hook owns this cache. Repeated reads must return the same selection.
export function createSelection<S, T>(getSnapshot: () => S, selector: (value: S) => T, equal: (a: T, b: T) => boolean) {
  let initialized = false;
  let previousSnapshot: S;
  let previousSelection: T;
  return () => {
    const snapshot = getSnapshot();
    if (initialized && Object.is(snapshot, previousSnapshot)) return previousSelection;
    const selected = selector(snapshot);
    if (!initialized || !equal(previousSelection, selected)) previousSelection = selected;
    initialized = true;
    previousSnapshot = snapshot;
    return previousSelection;
  };
}
