/**
 * Run `run` for each item with at most `limit` calls at the same time. The results keep the order of `items`.
 * After a failure, no new call starts, and the result rejects with the first error when the running calls end.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0, failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await run(items[index], index); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  if (failure) throw failure.error;
  return results;
}
