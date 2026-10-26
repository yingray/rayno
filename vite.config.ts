import { execSync } from 'node:child_process';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { compilerBenchmarkEntry } from './benchmarks/compiler/plugin.ts';
import { reactCompilerReport } from './benchmarks/reactCompilerReport.ts';

// Cloudflare Pages sets CF_PAGES_COMMIT_SHA. A local build reads the commit from git.
function buildCommit(): string {
  const commit = process.env.CF_PAGES_COMMIT_SHA;
  if (commit) return commit.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'dev';
  }
}

// The page compares its own build with /version.json to find a new release.
function versionFile(build: { commit: string; builtAt: string }): Plugin {
  return {
    name: 'rayno-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(build)}\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const build = { commit: buildCommit(), builtAt: new Date().toISOString() };
  // Keep an uncompiled build available for performance comparisons.
  const benchmark = process.env.RAYNO_COMPILER_BENCHMARK;
  if (benchmark && !['profiled', 'production'].includes(benchmark)) throw new Error('Use profiled or production for RAYNO_COMPILER_BENCHMARK.');
  const profiling = benchmark === 'profiled';
  const compilerEnabled = !!benchmark || process.env.RAYNO_REACT_COMPILER !== '0';
  // Extra host names for `pnpm dev` and `pnpm preview`, such as a Tailscale name.
  // Set RAYNO_ALLOWED_HOSTS in `.env.local` as a comma-separated list.
  const allowedHosts = (loadEnv(mode, '.', 'RAYNO_').RAYNO_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    define: { __RAYNO_BUILD__: JSON.stringify(build), __RAYNO_COMPILER_PROFILE__: profiling },
    build: benchmark ? { outDir: `.performance/compiler-${benchmark}` } : undefined,
    resolve: benchmark ? { alias: [
      { find: '@rayno/compiler-benchmark-gate', replacement: resolve('benchmarks/compiler/gate.ts') },
      ...(profiling ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : []),
    ] } : undefined,
    server: { allowedHosts },
    preview: { allowedHosts },
    plugins: [
      react(),
      compilerEnabled && babel({ presets: [reactCompilerPreset({ target: '19',
        ...(benchmark ? { gating: { source: '@rayno/compiler-benchmark-gate', importSpecifierName: 'isCompilerEnabled' } } : {}),
      })] }),
      versionFile(build),
      !benchmark && reactCompilerReport(),
      !!benchmark && compilerBenchmarkEntry(),
      !benchmark && VitePWA({
        registerType: 'prompt',
        includeAssets: ['fonts/*', 'icons/*'],
        manifest: {
          id: '/rayno',
          name: 'Rayno',
          short_name: 'Rayno',
          description: 'An independent, encrypted client for your Happy agents.',
          start_url: '/sessions',
          scope: '/',
          display: 'standalone',
          background_color: '#09090b',
          theme_color: '#09090b',
          icons: [192, 512].map((size) => ({
            src: `/icons/icon-${size}.png`,
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'any',
          })),
        },
        workbox: {
          cacheId: 'rayno',
          importScripts: ['/recap-audio-cache-store.js', '/recap-audio-cache-worker.js'],
          // Activate the new shell cache without a reload or a missing update prompt.
          // The open page stays intact; its next navigation uses the current release.
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,ttf}'],
          globIgnores: ['**/mermaid.worker-*.js', '**/demo-chat-*.png', 'assets/404.html'],
          runtimeCaching: [{
            urlPattern: /\/assets\/mermaid\.worker-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rayno-diagrams',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          }, {
            // Load the public demo screenshot only when the user opens it. Keep it for offline demo use.
            urlPattern: /\/assets\/demo-chat-[\w-]+\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'rayno-demo-images',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          }],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    test: { include: ['src/**/*.test.ts'], testTimeout: 1000 },
  };
});
