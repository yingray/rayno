// Structural sharing for derived chat data. Memo checks compare identity, but each history pass builds new objects.
// `reuseEqual` returns the previous object for each part of `next` that has the same values, so unchanged
// messages, tool calls, and chat blocks keep their identity. A changed part gets a new object that reuses its
// unchanged children. Lists of objects with an `id` match by id, so older pages that load at the top still match.

const MAX_DEPTH = 10;

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

function ids(list: readonly unknown[]): Map<string, unknown> | undefined {
  const map = new Map<string, unknown>();
  for (const item of list) {
    const id = plain(item) ? item.id : undefined;
    if (typeof id !== 'string' || map.has(id)) return undefined;
    map.set(id, item);
  }
  return map;
}

function reuse(previous: unknown, next: unknown, depth: number): unknown {
  if (Object.is(previous, next) || depth === 0) return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const byId = previous.length && next.length ? ids(previous) : undefined;
    let same = previous.length === next.length;
    const result = next.map((item, index) => {
      const before = byId ? byId.get((item as { id?: string })?.id ?? '') : previous[index];
      const value = before === undefined ? item : reuse(before, item, depth - 1);
      if (value !== previous[index]) same = false;
      return value;
    });
    return same ? previous : result;
  }
  if (plain(previous) && plain(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = Object.hasOwn(previous, key) ? reuse(previous[key], next[key], depth - 1) : next[key];
      if (!Object.hasOwn(previous, key) || value !== previous[key]) same = false;
      result[key] = value;
    }
    return same ? previous : result;
  }
  return next;
}

export function reuseEqual<T>(previous: T | undefined, next: T): T {
  return previous === undefined ? next : reuse(previous, next, MAX_DEPTH) as T;
}
