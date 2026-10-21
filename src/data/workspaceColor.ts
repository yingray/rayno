/**
 * A fixed colour for each workspace name, taken from the shadcn / Tailwind
 * palette. The same name always gets the same colour, on every device and in
 * every build, so the colour works as a tag that you learn to recognise.
 *
 * Do not reorder or extend WORKSPACE_HUES: the index of a hue is part of the
 * algorithm, and a change moves the colour of most workspaces.
 */

export type WorkspaceHue =
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose';

type Shades = { 100: string; 300: string; 500: string; 700: string };

// Tailwind v3 hex values, the palette that shadcn themes are built from.
const PALETTE: Record<WorkspaceHue | 'zinc', Shades> = {
  red: { 100: '#fee2e2', 300: '#fca5a5', 500: '#ef4444', 700: '#b91c1c' },
  orange: { 100: '#ffedd5', 300: '#fdba74', 500: '#f97316', 700: '#c2410c' },
  amber: { 100: '#fef3c7', 300: '#fcd34d', 500: '#f59e0b', 700: '#b45309' },
  yellow: { 100: '#fef9c3', 300: '#fde047', 500: '#eab308', 700: '#a16207' },
  lime: { 100: '#ecfccb', 300: '#bef264', 500: '#84cc16', 700: '#4d7c0f' },
  green: { 100: '#dcfce7', 300: '#86efac', 500: '#22c55e', 700: '#15803d' },
  emerald: { 100: '#d1fae5', 300: '#6ee7b7', 500: '#10b981', 700: '#047857' },
  teal: { 100: '#ccfbf1', 300: '#5eead4', 500: '#14b8a6', 700: '#0f766e' },
  cyan: { 100: '#cffafe', 300: '#67e8f9', 500: '#06b6d4', 700: '#0e7490' },
  sky: { 100: '#e0f2fe', 300: '#7dd3fc', 500: '#0ea5e9', 700: '#0369a1' },
  blue: { 100: '#dbeafe', 300: '#93c5fd', 500: '#3b82f6', 700: '#1d4ed8' },
  indigo: { 100: '#e0e7ff', 300: '#a5b4fc', 500: '#6366f1', 700: '#4338ca' },
  violet: { 100: '#ede9fe', 300: '#c4b5fd', 500: '#8b5cf6', 700: '#6d28d9' },
  purple: { 100: '#f3e8ff', 300: '#d8b4fe', 500: '#a855f7', 700: '#7e22ce' },
  fuchsia: { 100: '#fae8ff', 300: '#f0abfc', 500: '#d946ef', 700: '#a21caf' },
  pink: { 100: '#fce7f3', 300: '#f9a8d4', 500: '#ec4899', 700: '#be185d' },
  rose: { 100: '#ffe4e6', 300: '#fda4af', 500: '#f43f5e', 700: '#be123c' },
  zinc: { 100: '#f4f4f5', 300: '#d4d4d8', 500: '#71717a', 700: '#3f3f46' },
};

export const WORKSPACE_HUES: readonly WorkspaceHue[] = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

export type WorkspaceTagColor = {
  /** Null for an empty name, which gets the neutral zinc tag. */
  hue: WorkspaceHue | null;
  background: string;
  text: string;
};

/**
 * 32-bit FNV-1a over the UTF-16 code units. It is small, fast, and spreads
 * short similar names (`api`, `app`, `feat-a`, `feat-b`) over the hues.
 */
export function hashWorkspaceName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Case and outer spaces do not change the colour. */
export function resolveWorkspaceHue(name: string): WorkspaceHue | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return WORKSPACE_HUES[hashWorkspaceName(key) % WORKSPACE_HUES.length];
}

/**
 * The tag colours in the shadcn badge style: a light tint with dark text in
 * the light theme, and a translucent 500 with 300 text in the dark theme.
 */
export function resolveWorkspaceTagColor(name: string, dark: boolean): WorkspaceTagColor {
  const hue = resolveWorkspaceHue(name);
  const shades = PALETTE[hue ?? 'zinc'];
  return dark
    ? { hue, background: `${shades[500]}2e`, text: shades[300] }
    : { hue, background: shades[100], text: shades[700] };
}
