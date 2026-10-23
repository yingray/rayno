export type PanelKind = 'info' | 'side';
export const MIN_MAIN_CHAT_WIDTH = 520;
export const PANEL_WIDTHS = {
  info: { min: 320, max: 560 },
  side: { min: 360, max: 720 },
} as const;
export function panelWidthBounds(kind: PanelKind, available: number) {
  const { min, max } = PANEL_WIDTHS[kind];
  return { min, max: Math.max(min, Math.min(max, Math.floor(available - MIN_MAIN_CHAT_WIDTH))) };
}
export function defaultPanelWidth(kind: PanelKind, viewport: number) {
  return kind === 'info' ? 380 : Math.round(Math.max(400, Math.min(520, viewport * 0.34)));
}
export function clampPanelWidth(width: number, bounds: { min: number; max: number }) {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(width)));
}
export function savedPanelWidth(raw: string | null, kind: PanelKind): number | null {
  const width = Number(raw), bounds = PANEL_WIDTHS[kind];
  return raw && Number.isFinite(width) && width >= bounds.min && width <= bounds.max ? width : null;
}
