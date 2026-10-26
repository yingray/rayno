import { hasGitSide, parseGitPatch, parseGitStatus, sourcePatch, type GitFile, type GitPatch, type GitSide, type GitSnapshot } from './gitChanges';
import type { Session } from './types';

export const gitDiffDemoId = 'git-diff-demo';
export type GitDemoScenario = 'changes' | 'clean' | 'conflict' | 'error';
export const gitDemoStatus = '## demo/git-diff...origin/demo/git-diff [ahead 2, behind 1]\0MM src/app/App.tsx\0 M src/styles/tokens.css\0A  src/components/StatusBadge.tsx\0R  docs/Guide with spaces.md\0docs/old-guide.md\0 D src/legacy.ts\0 M assets/preview.png\0?? notes/試用 diff.md\0';
export function gitDemoSnapshot(scenario: GitDemoScenario): GitSnapshot {
  if (scenario === 'error') throw new Error('Demo: the Git read failed. Choose another repository state to retry.');
  const data = parseGitStatus(scenario === 'clean' ? '## demo/git-diff\0' : scenario === 'conflict' ? '## demo/git-diff\0UU src/app/App.tsx\0' : gitDemoStatus);
  return { ...data, root: '/demo/rayno', files: data.files.map(file => {
    const stats = (side: GitSide) => {
      const patch = gitDemoPatch(file, side);
      return { added: patch.lines.filter(line => line.kind === 'add').length, removed: patch.lines.filter(line => line.kind === 'remove').length, binary: patch.binary };
    };
    return { ...file, ...(hasGitSide(file, 'staged') ? { stagedStat: stats('staged') } : {}),
      ...(hasGitSide(file, 'working') && file.index !== '?' ? { workingStat: stats('working') } : {}) };
  }) };
}
export function gitDemoPatch(file: GitFile, side: GitSide): GitPatch {
  if (file.path.endsWith('.png')) return { text: 'Binary files a/assets/preview.png and b/assets/preview.png differ', metadata: [], lines: [], binary: true };
  if (file.index === '?') return sourcePatch('# Try the Git diff\n\nYour draft and demo preferences stay in this browser.\nSelect another file, then switch between Unified and Split.\n', true);
  if (file.conflict) return sourcePatch('<<<<<<< HEAD\nconst title = "Current branch";\n=======\nconst title = "Incoming change";\n>>>>>>> incoming\n', false);
  if (file.path.startsWith('docs/')) return parseGitPatch('diff --git a/docs/old-guide.md b/docs/Guide with spaces.md\nsimilarity index 100%\nrename from docs/old-guide.md\nrename to docs/Guide with spaces.md\n');
  if (file.path === 'src/legacy.ts') return parseGitPatch('diff --git a/src/legacy.ts b/src/legacy.ts\ndeleted file mode 100644\n--- a/src/legacy.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-export const legacy = true;\n-export const retired = true;\n');
  if (file.index === 'A') return parseGitPatch(`diff --git a/${file.path} b/${file.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${file.path}\n@@ -0,0 +1,4 @@\n+export function StatusBadge() {\n+  return <span>Ready</span>;\n+}\n+\n`);
  return parseGitPatch(`diff --git a/${file.path} b/${file.path}\nindex 8c4fe11..f151a42 100644\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,5 +1,7 @@\n import { Panel } from './Panel';\n \n-export const title = '${side === 'staged' ? 'Workspace' : 'My workspace'}';\n+export const title = '${side === 'staged' ? 'My workspace' : 'Rayno workspace'}';\n+export const description = 'A quiet place for your agents, with a readable diff for every changed file.';\n+\n export function App() {\n   return <Panel>{title}</Panel>;\n@@ -20,2 +22,3 @@\n export const theme = {\n-  accent: '#777',\n+  accent: '#8b5cf6',\n+  radius: 12,\n`);
}
export function createGitDiffDemo(now = Date.now()): Session {
  return { id: gitDiffDemoId, title: 'Git diff · Interactive demo', workspace: 'rayno', project: 'Rayno',
    path: '/demo/rayno', branch: 'demo/git-diff', machineId: 'mbp', agent: 'Claude', model: 'claude-opus-5', effort: 'high',
    status: 'idle', unread: false, archived: false, createdAt: now, updatedAt: now, additions: 20, deletions: 7,
    messages: [{ id: 'git-diff-intro', role: 'assistant', sentAt: now, content: '### Try the Git diff viewer\n\nOpen Session info, then View changes. Select files, compare working tree and staged changes, or switch to a split diff. The repository states are simulated. Your drafts and other demo sessions stay in place.' }],
  };
}
