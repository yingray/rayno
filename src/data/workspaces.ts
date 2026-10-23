import type { Agent, Machine, NewSessionDraft, RecentWorkspace, Session } from './types';
import { sessionActivityAt } from './sessionList';
import { resolveNewSessionPermission } from '../happy/permissionOptions';

type WorkspaceSource = { machineId?: string | null; path?: string | null; homeDir?: string | null };
const marker = '/.dev/worktree/';

export function displayWorkspacePath(path: string, homeDir?: string | null): string {
  const home = homeDir?.replace(/\/+$/, '');
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}

export function draftInWorkspace(source: WorkspaceSource, agent: Agent): NewSessionDraft | null {
  const checkout = source.path?.trim();
  if (!source.machineId || !checkout) return null;
  const index = checkout.indexOf(marker);
  return {
    machineId: source.machineId,
    path: displayWorkspacePath(index < 0 ? checkout : checkout.slice(0, index), source.homeDir),
    type: index < 0 ? 'Simple' : 'Worktree',
    worktree: index < 0 ? '' : checkout,
    agent, model: '', effort: null,
    permissionMode: resolveNewSessionPermission({ flavor: agent.toLowerCase() }, []), prompt: '', handoff: null,
  };
}

export function rememberWorkspace(recent: RecentWorkspace[] = [], value: RecentWorkspace): RecentWorkspace[] {
  return [value, ...recent.filter((item) => item.machineId !== value.machineId || item.path !== value.path)].slice(0, 30);
}

export type WorkspaceOption = RecentWorkspace & { label: string; checkout: string; displayPath: string };

export function recentWorkspaceOptions(
  sessions: Session[], machines: Machine[], recent: RecentWorkspace[], machineId: string,
): WorkspaceOption[] {
  const home = machines.find((machine) => machine.id === machineId)?.homeDir;
  const options = new Map<string, WorkspaceOption>();
  const sources = [
    ...recent,
    ...sessions.filter((session) => !session.isSideChat).map((session) => ({
      machineId: session.machineId, path: session.path, usedAt: sessionActivityAt(session),
    })),
  ];
  for (const source of sources) {
    if (source.machineId !== machineId || !source.path.trim()) continue;
    const path = source.path.trim().replace(/^~(?=\/|$)/, home || '~').replace(/\/+$/, '') || '/';
    const previous = options.get(path);
    if (previous && previous.usedAt >= source.usedAt) continue;
    const index = path.indexOf(marker);
    const root = index < 0 ? path : path.slice(0, index);
    options.set(path, {
      ...source, path,
      label: root.split('/').filter(Boolean).pop() || root,
      checkout: index < 0 ? '' : path.slice(index + marker.length),
      displayPath: displayWorkspacePath(path, home),
    });
  }
  return [...options.values()].sort((a, b) => b.usedAt - a.usedAt || a.path.localeCompare(b.path)).slice(0, 30);
}
