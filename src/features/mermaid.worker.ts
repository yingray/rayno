import { renderMermaidSVG } from 'beautiful-mermaid';

// ELK selects its internal fake worker by checking for a document global.
// Keep ELK in-process inside our outer worker; no DOM APIs run. Its setup also
// restores self by assignment, which needs a writable alias in a module worker.
Object.defineProperties(globalThis, {
  document: { value: {}, configurable: true },
  self: { value: globalThis, writable: true, configurable: true },
});

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; source: string }>) => void;
  postMessage: (result: { id: number; svg?: string; error?: string }) => void;
};

scope.onmessage = ({ data: { id, source } }) => {
  try {
    const svg = renderMermaidSVG(source, {
      bg: '#0c0c0e', fg: '#fafafa', accent: '#a78bfa',
      muted: '#a1a1aa', surface: '#1f1d26', border: '#55515f',
      font: 'Arial', padding: 24, transparent: true,
    });
    scope.postMessage({ id, svg });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : 'The diagram could not render.' });
  }
};
