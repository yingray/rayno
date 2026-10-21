import { describe, expect, it, vi } from 'vitest';
import { createExternalStore, createSelection, shallowEqual } from './subscriptions';

describe('workspace subscriptions', () => {
  it('should retain the selection when another session or a draft changes', () => {
    // Arrange
    const session = { title: 'Current conversation' };
    const store = createExternalStore({ session, draft: '', usage: 10 });
    const select = vi.fn((value: ReturnType<typeof store.getSnapshot>) => ({ session: value.session }));
    const read = createSelection(store.getSnapshot, select, shallowEqual);
    const first = read();
    // Act
    store.set({ session, draft: 'New draft', usage: 20 });
    const second = read();
    const repeated = read();
    // Assert
    expect(second).toBe(first);
    expect(repeated).toBe(first);
    expect(select).toHaveBeenCalledTimes(2);
    // Act
    store.set({ ...store.getSnapshot(), session: { title: 'Renamed conversation' } });
    // Assert
    expect(read()).not.toBe(first);
    expect(read().session.title).toBe('Renamed conversation');
  });

  it('should isolate selector caches and stop notifications after unsubscribe', () => {
    // Arrange
    const store = createExternalStore({ a: 1, b: 2 });
    const readA = createSelection(store.getSnapshot, (value) => ({ value: value.a }), shallowEqual);
    const readB = createSelection(store.getSnapshot, (value) => ({ value: value.b }), shallowEqual);
    const firstA = readA(), firstB = readB();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    // Act
    store.set({ a: 1, b: 3 });
    unsubscribe();
    store.set({ a: 1, b: 4 });
    // Assert
    expect(readA()).toBe(firstA);
    expect(readB()).not.toBe(firstB);
    expect(readB().value).toBe(4);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
