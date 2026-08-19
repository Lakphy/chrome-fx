import '@xterm/xterm/css/xterm.css';
import '../panel/style.css';
import {
  clamp,
  clampFab,
  computeView,
  DRAG_THRESHOLD,
  EDGE,
  FAB_SIZE,
  MIN_PANEL_H,
  MIN_PANEL_W,
  readLayout,
  resolveSide,
  viewportSize,
  writeLayout,
  type OverlayLayout,
  type OverlaySide,
} from './layout.ts';
import { mountPanel } from './mount-panel.tsx';
import './style.css';

const OPEN_FLAG = 'chrome-friend-open';
const FRONT = '2147483647';

type DragKind = 'fab' | 'resize';

type DragState = {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  originFabX: number;
  originFabY: number;
  originW: number;
  originH: number;
  moved: boolean;
  target: HTMLElement;
};

export default defineContentScript({
  matches: ['*://*/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    let open = false;
    let panelRoot: HTMLElement | undefined;
    let fabButton: HTMLButtonElement | undefined;
    const initialView = viewportSize();
    let layout: OverlayLayout = readLayout(initialView.vw, initialView.vh);
    let side: OverlaySide = resolveSide(layout.fabX, initialView.vw);
    let drag: DragState | null = null;
    let dragListeners = false;

    const panel = await createShadowRootUi(ctx, {
      name: 'chrome-friend-panel',
      position: 'modal',
      zIndex: 2147483647,
      isolateEvents: true,
      onMount(container, _shadow, shadowHost) {
        liftToTopLayer(shadowHost);
        fillOverlay(container);
        const rootEl = document.createElement('div');
        rootEl.className = 'cf-panel-root';
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'cf-resize';
        handle.title = 'Resize';
        handle.setAttribute('aria-label', 'Resize panel');
        handle.addEventListener('pointerdown', onResizePointerDown);
        const mountEl = document.createElement('div');
        mountEl.className = 'cf-panel-mount';
        rootEl.append(handle, mountEl);
        container.append(rootEl);
        panelRoot = rootEl;
        applyLayout();
        return mountPanel(mountEl);
      },
      onRemove(root) {
        panelRoot = undefined;
        root?.unmount();
      },
    });

    const fab = await createShadowRootUi(ctx, {
      name: 'chrome-friend-fab',
      position: 'modal',
      zIndex: 2147483647,
      isolateEvents: true,
      onMount(container, _shadow, shadowHost) {
        liftToTopLayer(shadowHost);
        fillOverlay(container);
        const button = document.createElement('button');
        button.className = 'cf-fab';
        button.type = 'button';
        button.textContent = 'fx';
        button.title = 'Open chrome-fx';
        button.addEventListener('pointerdown', onFabPointerDown);
        button.addEventListener('click', onFabClick);
        fabButton = button;
        applyLayout();
        container.append(button);
        return button;
      },
    });

    function applyLayout() {
      const { vw, vh } = viewportSize();
      side = resolveSide(layout.fabX, vw, side);
      const view = computeView(layout, vw, vh, side);
      layout = { ...layout, fabX: view.fabX, fabY: view.fabY };

      if (fabButton) {
        fabButton.style.left = `${view.fabX}px`;
        fabButton.style.top = `${view.fabY}px`;
        fabButton.classList.toggle('is-dragging', drag?.kind === 'fab' && drag.moved);
      }

      if (!panelRoot) return;
      panelRoot.dataset.side = view.side;
      panelRoot.style.left = `${view.panelLeft}px`;
      panelRoot.style.top = `${view.panelTop}px`;
      panelRoot.style.width = `${view.panelWidth}px`;
      panelRoot.style.height = `${view.panelHeight}px`;
    }

    function persistLayout() {
      writeLayout(layout);
    }

    function setOpen(next: boolean) {
      if (next === open) return;
      open = next;
      try {
        sessionStorage.setItem(OPEN_FLAG, next ? '1' : '0');
      } catch {
        // sessionStorage can be blocked in some frames.
      }
      if (open) {
        void browser.runtime.sendMessage({ type: 'controller:claim' }).catch(() => undefined);
        panel.mount();
      } else {
        panel.remove();
      }
    }

    function onFabPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      beginDrag('fab', event);
    }

    function onResizePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      beginDrag('resize', event);
    }

    function beginDrag(kind: DragKind, event: PointerEvent) {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;
      const { vw, vh } = viewportSize();
      const view = computeView(layout, vw, vh, side);
      drag = {
        kind,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originFabX: view.fabX,
        originFabY: view.fabY,
        originW: view.panelWidth,
        originH: view.panelHeight,
        moved: false,
        target,
      };
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort; element + window listeners still track the gesture.
      }
      target.addEventListener('pointermove', onDragPointerMove);
      target.addEventListener('pointerup', onDragPointerUp);
      target.addEventListener('pointercancel', onDragPointerUp);
      attachDragListeners();
    }

    function onDragPointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const { vw, vh } = viewportSize();

      if (drag.kind === 'fab') {
        Object.assign(layout, clampFab(drag.originFabX + dx, drag.originFabY + dy, vw, vh));
        applyLayout();
        return;
      }

      const growingRight = side === 'left';
      const nextW = drag.originW + (growingRight ? dx : -dx);
      const nextH = drag.originH - dy;
      layout.width = clamp(nextW, MIN_PANEL_W, Math.max(MIN_PANEL_W, vw - EDGE * 2));
      layout.height = clamp(nextH, MIN_PANEL_H, Math.max(MIN_PANEL_H, vh - EDGE * 2 - FAB_SIZE));
      applyLayout();
    }

    function onDragPointerUp(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const shouldToggle = drag.kind === 'fab' && !drag.moved;
      endDrag();
      persistLayout();
      if (shouldToggle) setOpen(!open);
    }

    function onFabClick(event: MouseEvent) {
      if (event.detail !== 0) return;
      setOpen(!open);
    }

    function attachDragListeners() {
      if (dragListeners) return;
      dragListeners = true;
      window.addEventListener('pointermove', onDragPointerMove, true);
      window.addEventListener('pointerup', onDragPointerUp, true);
      window.addEventListener('pointercancel', onDragPointerUp, true);
      window.addEventListener('selectstart', preventSelect, true);
    }

    function detachDragListeners() {
      if (!dragListeners) return;
      dragListeners = false;
      window.removeEventListener('pointermove', onDragPointerMove, true);
      window.removeEventListener('pointerup', onDragPointerUp, true);
      window.removeEventListener('pointercancel', onDragPointerUp, true);
      window.removeEventListener('selectstart', preventSelect, true);
    }

    function endDrag() {
      if (drag) {
        drag.target.removeEventListener('pointermove', onDragPointerMove);
        drag.target.removeEventListener('pointerup', onDragPointerUp);
        drag.target.removeEventListener('pointercancel', onDragPointerUp);
        try {
          if (drag.target.hasPointerCapture(drag.pointerId)) {
            drag.target.releasePointerCapture(drag.pointerId);
          }
        } catch {
          // Element may already have been removed.
        }
      }
      drag = null;
      detachDragListeners();
      fabButton?.classList.remove('is-dragging');
    }

    function onViewportChange() {
      const { vw, vh } = viewportSize();
      Object.assign(layout, clampFab(layout.fabX, layout.fabY, vw, vh));
      applyLayout();
    }

    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if (message.type === 'overlay:open') setOpen(true);
      if (message.type === 'overlay:toggle') setOpen(!open);
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.addEventListener(window, 'chrome-friend-open' as keyof WindowEventMap, () => setOpen(true));
    ctx.addEventListener(window, 'resize', onViewportChange);
    ctx.onInvalidated(() => {
      endDrag();
      browser.runtime.onMessage.removeListener(onMessage);
    });

    fab.mount();
    try {
      if (sessionStorage.getItem(OPEN_FLAG) === '1') setOpen(true);
    } catch {
      // Ignore blocked storage.
    }
  },
});

function preventSelect(event: Event) {
  event.preventDefault();
}

function fillOverlay(el: HTMLElement) {
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.pointerEvents = 'none';
}

function liftToTopLayer(host: HTMLElement) {
  host.setAttribute('popover', 'manual');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('width', 'auto', 'important');
  host.style.setProperty('height', 'auto', 'important');
  host.style.setProperty('margin', '0', 'important');
  host.style.setProperty('border', 'none', 'important');
  host.style.setProperty('padding', '0', 'important');
  host.style.setProperty('overflow', 'visible', 'important');
  host.style.setProperty('background', 'transparent', 'important');
  host.style.setProperty('color', 'inherit', 'important');
  host.style.setProperty('z-index', FRONT, 'important');
  host.style.pointerEvents = 'none';
  document.documentElement.append(host);
  try {
    if (!host.matches(':popover-open')) host.showPopover();
  } catch {
    // Top layer is best-effort; z-index on <html> is the fallback.
  }
}
