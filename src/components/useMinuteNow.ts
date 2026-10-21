import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  timer = setTimeout(() => {
    now = Date.now();
    listeners.forEach((listener) => listener());
    schedule();
  }, 60000 - (Date.now() % 60000));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;
export const useMinuteNow = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
