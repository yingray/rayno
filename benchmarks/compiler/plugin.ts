import type { Plugin } from 'vite';

// Replace only the isolated benchmark entry. Normal builds retain the app entry and renderer.
export function compilerBenchmarkEntry(): Plugin {
  return { name: 'rayno-compiler-benchmark-entry', transformIndexHtml: {
    order: 'pre', handler: html => html.replace('/src/main.tsx', '/benchmarks/compiler/main.tsx'),
  } };
}
