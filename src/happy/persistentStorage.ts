// Offline data is best-effort until the browser marks it persistent. Under storage pressure, the browser deletes
// all data of a best-effort site at once, and Safari deletes it after 7 days without a visit (PERFORMANCE-PLAN.md 6.1).
// Call this in a click: Safari and Firefox accept the request only in a user gesture. Do not call it on page load.
// A browser can decline. The app then works as before, so nothing shows to the user.
export function requestPersistentStorage(): void {
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persist !== 'function') return;
  // Do not wait for `persisted()` first: the request must start inside the gesture.
  void storage.persist().catch(() => { /* A refusal leaves the storage best-effort. */ });
}

/**
 * For a session that was signed in before: ask once, on the first click or key press of this page load.
 * Skip the request when the data is already persistent. Returns a function that removes the listeners.
 */
export function requestPersistentStorageOnFirstInput(): () => void {
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persist !== 'function') return () => {};
  let ask = true;
  const input = () => { remove(); if (ask) requestPersistentStorage(); };
  const remove = () => {
    window.removeEventListener('pointerdown', input, true);
    window.removeEventListener('keydown', input, true);
  };
  window.addEventListener('pointerdown', input, true);
  window.addEventListener('keydown', input, true);
  void storage.persisted?.().then((persisted) => { if (persisted) { ask = false; remove(); } }).catch(() => {});
  return remove;
}
