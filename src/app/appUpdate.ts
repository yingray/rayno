// The release that runs on this page and the release that the server has now.

export type BuildInfo = { commit: string; builtAt: string };
export type UpdateCheck =
  | { status: 'current'; latest: BuildInfo }
  | { status: 'available'; latest: BuildInfo }
  | { status: 'offline' };

export const currentBuild: BuildInfo = __RAYNO_BUILD__;
const VERSION_URL = '/version.json';
// A new service worker usually installs in a few seconds. After this time, the update clears the shell cache.
const INSTALL_TIMEOUT = 15000;

export function parseBuild(value: unknown): BuildInfo | null {
  if (!value || typeof value !== 'object') return null;
  const { commit, builtAt } = value as Record<string, unknown>;
  return typeof commit === 'string' && commit && typeof builtAt === 'string' && builtAt
    ? { commit, builtAt }
    : null;
}

export function compareBuild(current: BuildInfo, latest: BuildInfo): UpdateCheck {
  return { status: latest.commit === current.commit ? 'current' : 'available', latest };
}

// A local date and time, such as "Oct 22, 2026, 17:17". An invalid date shows as given.
export function formatBuildTime(builtAt: string, locale?: string): string {
  const date = new Date(builtAt);
  if (Number.isNaN(date.getTime())) return builtAt;
  return date.toLocaleString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    const latest = response.ok ? parseBuild(await response.json()) : null;
    return latest ? compareBuild(currentBuild, latest) : { status: 'offline' };
  } catch {
    return { status: 'offline' };
  }
}

function settled(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), INSTALL_TIMEOUT);
    const done = () => {
      if (worker.state !== 'activated' && worker.state !== 'redundant') return;
      clearTimeout(timer);
      worker.removeEventListener('statechange', done);
      resolve(worker.state === 'activated');
    };
    worker.addEventListener('statechange', done);
    done();
  });
}

// Remove the service worker and its shell caches. IndexedDB and localStorage keep the account data.
async function clearShell(registration: ServiceWorkerRegistration | undefined) {
  await registration?.unregister();
  if (typeof caches === 'undefined') return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith('rayno') || name.startsWith('workbox'))
    .map((name) => caches.delete(name)));
}

// Browsers report a missing or non-JavaScript screen chunk with these messages.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|not a valid JavaScript MIME type|Failed to load module script/i;
export const isChunkError = (error: unknown) => error instanceof Error && CHUNK_ERROR.test(error.message);

// A screen chunk of the running release is not available. Clear the shell, so the reload uses the server's release.
// Without a connection, keep the shell for offline use and only reload.
export async function recoverShell(reload: () => void = () => window.location.reload()) {
  if (navigator.onLine) {
    const registration = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
      : undefined;
    await clearShell(registration).catch(() => undefined);
  }
  reload();
}

// Install the server's release, then reload. A failed install clears the shell, so the reload uses the network.
// Without a connection, nothing changes: the cached shell must stay for offline use.
export async function forceUpdate(reload: () => void = () => window.location.reload()): Promise<UpdateCheck> {
  const check = await checkForUpdate();
  if (check.status === 'offline') return check;
  const registration = 'serviceWorker' in navigator
    ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
    : undefined;
  if (registration) {
    try {
      await registration.update();
      const worker = registration.installing || registration.waiting;
      if (worker && !(await settled(worker))) await clearShell(registration);
    } catch {
      await clearShell(registration);
    }
  }
  reload();
  return check;
}
