export const FAB_SIZE = 36;
export const FAB_GAP = 8;
export const EDGE = 16;
export const MIN_PANEL_W = 280;
export const MIN_PANEL_H = 200;
export const DEFAULT_PANEL_W = 520;
export const DEFAULT_PANEL_H = 640;
export const DRAG_THRESHOLD = 4;
export const SIDE_HYSTERESIS = 40;

const LAYOUT_KEY = 'chrome-friend-layout';

export type OverlaySide = 'left' | 'right';

export type OverlayLayout = {
  fabX: number;
  fabY: number;
  width: number;
  height: number;
};

export type OverlayView = OverlayLayout & {
  side: OverlaySide;
  panelLeft: number;
  panelTop: number;
  panelWidth: number;
  panelHeight: number;
};

export function viewportSize(): { vw: number; vh: number } {
  return { vw: window.innerWidth, vh: window.innerHeight };
}

export function defaultLayout(vw: number, vh: number): OverlayLayout {
  return {
    fabX: vw - EDGE - FAB_SIZE,
    fabY: vh - EDGE - FAB_SIZE,
    width: Math.min(DEFAULT_PANEL_W, Math.max(MIN_PANEL_W, vw - EDGE * 2)),
    height: Math.min(DEFAULT_PANEL_H, Math.max(MIN_PANEL_H, vh - EDGE * 2 - FAB_SIZE - FAB_GAP)),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampFab(x: number, y: number, vw: number, vh: number): { fabX: number; fabY: number } {
  const maxX = Math.max(EDGE, vw - EDGE - FAB_SIZE);
  const maxY = Math.max(EDGE, vh - EDGE - FAB_SIZE);
  return {
    fabX: clamp(x, EDGE, maxX),
    fabY: clamp(y, EDGE, maxY),
  };
}

export function resolveSide(fabX: number, vw: number, current?: OverlaySide): OverlaySide {
  const center = fabX + FAB_SIZE / 2;
  const mid = vw / 2;
  if (current === 'right' && center < mid - SIDE_HYSTERESIS) return 'left';
  if (current === 'left' && center > mid + SIDE_HYSTERESIS) return 'right';
  if (current) return current;
  return center < mid ? 'left' : 'right';
}

export function computeView(layout: OverlayLayout, vw: number, vh: number, side: OverlaySide): OverlayView {
  const { fabX, fabY } = clampFab(layout.fabX, layout.fabY, vw, vh);
  const maxH = Math.max(80, fabY - FAB_GAP - EDGE);
  const maxW = side === 'right' ? Math.max(80, fabX + FAB_SIZE - EDGE) : Math.max(80, vw - EDGE - fabX);
  const panelWidth = clamp(layout.width, Math.min(MIN_PANEL_W, maxW), maxW);
  const panelHeight = clamp(layout.height, Math.min(MIN_PANEL_H, maxH), maxH);
  const panelTop = fabY - FAB_GAP - panelHeight;
  const panelLeft = side === 'right' ? fabX + FAB_SIZE - panelWidth : fabX;
  return {
    fabX,
    fabY,
    width: layout.width,
    height: layout.height,
    side,
    panelLeft,
    panelTop,
    panelWidth,
    panelHeight,
  };
}

export function readLayout(vw: number, vh: number): OverlayLayout {
  const fallback = defaultLayout(vw, vh);
  try {
    const raw = sessionStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 2) return fallback;
    if (!isFiniteNumber(record.fabX) || !isFiniteNumber(record.fabY)) return fallback;
    if (!isFiniteNumber(record.width) || !isFiniteNumber(record.height)) return fallback;
    return {
      ...clampFab(record.fabX, record.fabY, vw, vh),
      width: clamp(record.width, MIN_PANEL_W, Math.max(MIN_PANEL_W, vw - EDGE * 2)),
      height: clamp(record.height, MIN_PANEL_H, Math.max(MIN_PANEL_H, vh - EDGE * 2)),
    };
  } catch {
    return fallback;
  }
}

export function writeLayout(layout: OverlayLayout): void {
  try {
    sessionStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        v: 2,
        fabX: layout.fabX,
        fabY: layout.fabY,
        width: layout.width,
        height: layout.height,
      }),
    );
  } catch {
    // sessionStorage can be blocked in some frames.
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
