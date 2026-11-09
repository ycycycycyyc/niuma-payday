export const PET_RESTORE_TARGET_MS = 650;

export type PetRestoreRect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

type RestoreTargetOptions = {
  enabled?: () => boolean;
  onChange?: (rect: PetRestoreRect | null) => void;
  onPress?: (offset: Point) => void;
  onDrag?: (center: Point, first: boolean) => void;
  onRelease?: (clientPoint?: Point) => void;
};

// Keep the same transparent event target under the first click while the dog
// keeps moving. Only the hit target waits for the second click, not the artwork.
export function createPetRestoreTarget(button: HTMLButtonElement, options: RestoreTargetOptions = {}) {
  const target = document.createElement('span');
  target.className = 'pet-restore-target';
  target.setAttribute('data-pet-restore-target', '');
  target.setAttribute('aria-hidden', 'true');
  Object.assign(target.style, {
    position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'inherit',
  });
  button.append(target);

  let anchor: PetRestoreRect | null = null;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let press: { id: number; start: Point; offset: Point; target: Element; dragging: boolean } | null = null;
  let clicksSinceDrag = 2;

  function enabled() {
    return !destroyed && button.isConnected && !button.hidden && !button.disabled && (options.enabled?.() ?? true);
  }

  function clear() {
    const wasActive = anchor !== null;
    anchor = null;
    expiresAt = 0;
    clearTimeout(timer);
    timer = undefined;
    target.style.transform = '';
    target.style.width = '';
    target.style.height = '';
    if (wasActive) options.onChange?.(null);
  }

  function sync() {
    if (!anchor) return;
    if (!enabled() || performance.now() >= expiresAt) { clear(); return; }
    const current = button.getBoundingClientRect();
    if (!current.width || !current.height) { clear(); return; }
    target.style.width = `${anchor.width}px`;
    target.style.height = `${anchor.height}px`;
    target.style.transform = `translate3d(${anchor.x - current.x}px, ${anchor.y - current.y}px, 0)`;
  }

  function arm(event: PointerEvent) {
    if (!enabled() || !event.isPrimary || event.button !== 0) return;
    // A second press may hit only the retained target as the dog walks away.
    // It still counts towards a fresh double-click after a drag.
    clicksSinceDrag = Math.min(2, clicksSinceDrag + 1);
    sync();
    const rect = button.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!anchor) {
      anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      expiresAt = performance.now() + PET_RESTORE_TARGET_MS;
      timer = setTimeout(clear, PET_RESTORE_TARGET_MS);
      sync();
      if (anchor) options.onChange?.({ ...anchor });
    }
    if (!options.onDrag || press || event.clientX < rect.left || event.clientX >= rect.right ||
        event.clientY < rect.top || event.clientY >= rect.bottom) return;
    const offset = { x: rect.x + rect.width / 2 - event.clientX, y: rect.y + rect.height / 2 - event.clientY };
    const capture = event.target instanceof Element ? event.target : button;
    press = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, offset, target: capture, dragging: false };
    // Keep down/up on the same element for Chromium's native double-click.
    if (event.isTrusted) capture.setPointerCapture(event.pointerId);
    options.onPress?.(offset);
  }

  function move(event: PointerEvent) {
    if (!press || press.id !== event.pointerId) return;
    if (event.type === 'pointermove' && !(event.buttons & 1)) { release(); return; }
    const first = !press.dragging;
    if (first && Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y) < 5) return;
    if (first) {
      press.dragging = true;
      clicksSinceDrag = 0;
      button.dataset.dragging = 'true';
      clear();
    }
    options.onDrag?.({ x: event.clientX + press.offset.x, y: event.clientY + press.offset.y }, first);
  }

  function release(clientPoint?: Point) {
    if (!press) return;
    const held = press;
    press = null;
    delete button.dataset.dragging;
    if (held.target.hasPointerCapture(held.id)) held.target.releasePointerCapture(held.id);
    options.onRelease?.(clientPoint);
  }

  function finish(event: PointerEvent) {
    if (press?.id !== event.pointerId) return;
    if (event.type === 'pointerup') {
      move(event);
      release({ x: event.clientX, y: event.clientY });
    } else release();
  }

  function suppressDraggedClick(event: MouseEvent) {
    if (clicksSinceDrag < 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  button.addEventListener('pointerdown', arm);
  button.addEventListener('pointermove', move);
  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', finish);
  button.addEventListener('lostpointercapture', finish);
  button.addEventListener('dblclick', suppressDraggedClick, true);

  return {
    sync,
    clear,
    release,
    get dragging() { return Boolean(press?.dragging); },
    destroy() {
      if (destroyed) return;
      release();
      clear();
      destroyed = true;
      button.removeEventListener('pointerdown', arm);
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerup', finish);
      button.removeEventListener('pointercancel', finish);
      button.removeEventListener('lostpointercapture', finish);
      button.removeEventListener('dblclick', suppressDraggedClick, true);
      target.remove();
    },
  };
}
