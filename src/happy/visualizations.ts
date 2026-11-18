import { unbase64 } from './crypto';
import type { Json } from './normalize';

export const MAX_VISUALIZATION_BYTES = 1024 * 1024;

export type ScatterPoint = { name: string; series: string; x: number; y: number };
export type ScatterChart = {
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  xLog: boolean;
  yLog: boolean;
  xDomain: [number, number] | null;
  yDomain: [number, number] | null;
  points: ScatterPoint[];
};

const label = (value: unknown, size = 180) => typeof value === 'string' ? value.slice(0, size) : '';
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const coordinate = (value: unknown, log: boolean): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e100 && (!log || value >= 1e-100);
const domain = (value: unknown, log: boolean): [number, number] | null =>
  Array.isArray(value) && value.length === 2 && coordinate(value[0], log) && coordinate(value[1], log) && value[0] < value[1]
    ? [value[0], value[1]] : null;
const unsupported = () => new Error('This visualization does not contain supported scatter chart data.');

function scatterChart(value: unknown): ScatterChart {
  const chart = object(value), spec = object(chart.spec);
  const x = label(spec.x), y = label(spec.y), series = label(spec.series);
  if (spec.type !== 'scatter' || !x || !y || !Array.isArray(chart.rows) || !chart.rows.length || chart.rows.length > 2000)
    throw unsupported();
  const xLog = spec.xScale === 'log', yLog = spec.yScale === 'log';
  const columns = Array.isArray(chart.columns) ? chart.columns : null;
  const index = columns?.map(column => label(column));
  const points = chart.rows.map((row, rowIndex): ScatterPoint => {
    const read = (field: string): unknown => Array.isArray(row)
      ? (index ? row[index.indexOf(field)] : undefined)
      : Object.hasOwn(object(row), field) ? object(row)[field] : undefined;
    const px = read(x), py = read(y);
    if (!coordinate(px, xLog) || !coordinate(py, yLog)) throw unsupported();
    const group = series ? label(read(series)) : '';
    return { name: label(read('name')) || String(rowIndex + 1), series: group, x: px, y: py };
  });
  return { title: label(chart.title), description: label(chart.description, 600),
    xLabel: label(spec.xLabel) || x, yLabel: label(spec.yLabel) || y, xLog, yLog,
    xDomain: domain(spec.xDomain, xLog), yDomain: domain(spec.yDomain, yLog), points };
}

export function parseVisualizationDocument(source: string): ScatterChart[] {
  if (source.length > MAX_VISUALIZATION_BYTES) throw new Error('Visualization files must be 1 MB or smaller.');
  // The template stays detached. Extract JSON only and never mount markup or execute scripts from the file.
  const template = document.createElement('template');
  template.innerHTML = source;
  const blocks = [...template.content.querySelectorAll('script[type="application/json"][data-viz-chart]')];
  let configurations: unknown[];
  try {
    configurations = blocks.flatMap(block => {
      const value: unknown = JSON.parse(block.textContent || '');
      const charts = object(value).charts;
      return Array.isArray(charts) ? charts : [value];
    });
  } catch { throw unsupported(); }
  if (!configurations.length || configurations.length > 6) throw unsupported();
  return configurations.map(scatterChart);
}

function workspaceLocation(source: string, workspace: string) {
  const windows = /^[a-z]:[\\/]/i.test(workspace);
  const normalize = (path: string) => windows ? path.replaceAll('\\', '/') : path;
  const root = normalize(workspace).replace(/\/+$/, '') + '/';
  const path = normalize(source);
  const absolute = /^(\/|[a-z]:\/)/i.test(path);
  const fold = (path: string) => windows ? path.toLowerCase() : path;
  if (!(workspace.startsWith('/') || windows) || root === '/' ||
    /[\x00-\x1f\x7f\\]/.test(path) || !/\.html$/i.test(path) ||
    (absolute && !fold(path).startsWith(fold(root)))) {
    throw new Error('The visualization must be an HTML file in this session’s workspace.');
  }
  const segments = (absolute ? path.slice(root.length) : path).split('/');
  if (segments.length > 16 || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes(':')))
    throw new Error('The visualization must be an HTML file in this session’s workspace.');
  return { root, segments };
}

export async function readWorkspaceVisualization(source: string, workspace: string,
  rpc: (method: string, params: { path: string }) => Promise<Json>): Promise<ScatterChart[]> {
  const { root, segments } = workspaceLocation(source, workspace);
  let directory = root;
  for (const [index, name] of segments.entries()) {
    const last = index === segments.length - 1;
    const parentPath = /^[a-z]:\/$/i.test(directory) ? directory : directory.slice(0, -1);
    const listing = await rpc('listDirectory', { path: parentPath });
    const entry = Array.isArray(listing.entries) && listing.entries.find((item: Json) => item?.name === name);
    // The daemon lists symbolic links as "other". Check the directories as well as the file.
    if (!listing.success || !entry || entry.type !== (last ? 'file' : 'directory'))
      throw new Error('The computer cannot find this visualization file.');
    if (last && (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > MAX_VISUALIZATION_BYTES))
      throw new Error('Visualization files must be 1 MB or smaller.');
    directory += name + '/';
  }
  const result = await rpc('readFile', { path: directory.slice(0, -1) });
  if (!result.success || typeof result.content !== 'string') throw new Error('The computer cannot read this visualization file.');
  if (result.content.length > Math.ceil(MAX_VISUALIZATION_BYTES / 3) * 4)
    throw new Error('Visualization files must be 1 MB or smaller.');
  const bytes = unbase64(result.content);
  if (bytes.length > MAX_VISUALIZATION_BYTES) throw new Error('Visualization files must be 1 MB or smaller.');
  return parseVisualizationDocument(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
