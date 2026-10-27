export type PanelKind = 'info' | 'side' | 'sessions';
export const MIN_MAIN_CHAT_WIDTH = 520;
export const PANEL_WIDTHS = {
  info: { min: 320, max: 560 },
  sessions: { min: 280, max: 520 },
} as const;
export const SIDE_CHAT_SHARE = { min: 0.3, max: 0.7 } as const;
export function panelWidthBounds(kind: PanelKind, available: number) {
  if (kind === 'side') return { min: Math.round(available * SIDE_CHAT_SHARE.min), max: Math.round(available * SIDE_CHAT_SHARE.max) };
  const { min, max } = PANEL_WIDTHS[kind];
  return { min, max: Math.max(min, Math.min(max, Math.floor(available - MIN_MAIN_CHAT_WIDTH))) };
}
export function defaultPanelWidth(kind: PanelKind, viewport: number) {
  if (kind === 'sessions') return viewport < 1280 ? 320 : 360;
  return kind === 'info' ? 380 : Math.round(Math.max(400, Math.min(520, viewport * 0.34)));
}
export function clampPanelWidth(width: number, bounds: { min: number; max: number }) {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(width)));
}
export function savedPanelWidth(raw: string | null, kind: PanelKind): number | null {
  const width = Number(raw);
  if (kind === 'side') return raw && Number.isFinite(width) && width > 0 ? width : null;
  const bounds = PANEL_WIDTHS[kind];
  return raw && Number.isFinite(width) && width >= bounds.min && width <= bounds.max ? width : null;
}
