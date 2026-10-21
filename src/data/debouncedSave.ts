export function createDebouncedSave<T>(save: (value: T) => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let latest: T;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    pending = false;
    save(latest);
  };
  return {
    schedule(value: T) {
      latest = value;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
  };
}
